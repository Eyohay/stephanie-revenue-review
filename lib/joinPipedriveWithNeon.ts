/**
 * Joins PipeDrive org data with Neon payment data for the "Pilots ending this
 * month" tab.
 *
 * PipeDrive is authoritative for: client list, pilot dates, account status,
 * account manager, labels.
 *
 * Neon (ChargeOver-synced) is the source for: last/next payment, monthly
 * amount, paid-upfront detection.
 *
 * Join keys: Primary — PipeDrive "Chargeover Customer #" ↔ Neon chargeoverCustomerId.
 * Secondary — pipedriveOrgId (for Stripe-only clients that have no ChargeOver ID).
 */

import { prisma } from './prisma';
import {
  isActive,
  isPaidUpfront,
  isLikelyPaidUpfront,
  isRolledOver,
  nextScheduledPayment,
  deriveTier,
  type SubRaw,
  type PayRaw,
} from './query';
import { getMonthlyAmount } from './billing/monthly-amount';
import { getOrgsWithPilotEndingThisMonth } from './pipedrive/queries';
import {
  DEAD_LT_30_LABEL_ID,
  DEAD_OFFBOARDED_LABEL_ID,
  ROLLED_OVER_LABEL_ID,
  POTENTIAL_ROLLOVER_LABEL_ID,
} from './pipedrive/client';

// Stripe upfront flat amounts by tier (when reading from invoice line items isn't available).
const PLATINUM_UPFRONT_AMOUNT = 9700;
const GOLD_UPFRONT_AMOUNT = 7800;

// Returns "YYYY-MM" for the current month in America/New_York. Used to match
// against Subscription.lineItems.upfrontBillingDate (stored as "YYYY-MM-DD").
function currentEtYearMonth(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const y = parts.find(p => p.type === 'year')?.value ?? '';
  const m = parts.find(p => p.type === 'month')?.value ?? '';
  return `${y}-${m}`;
}

// ---------------------------------------------------------------------------
// Joined row type
// ---------------------------------------------------------------------------
export type JoinedPilotRow = {
  // PipeDrive-authoritative
  pipedriveOrgId: number;
  organizationName: string;
  accountStatus: string;
  accountManager: string | null;
  pilotRolloverEndDate: string | null;   // "YYYY-MM-DD"
  labels: { id: number; name: string; color: string }[];

  // Neon-derived (null if no ChargeOver match)
  chargeoverCustomerId: string | null;
  hasNeonMatch: boolean;
  isStripe: boolean;

  // Payments
  lastPaymentDate: string | null;       // ISO string
  lastPaymentAmount: number | null;
  lastPaymentPending: boolean;
  // Monthly recurring amount (sub.amount from largest active sub — null if paid-upfront)
  monthlyAmount: number | null;
  nextPaymentDate: string | null;       // ISO string
  nextPaymentAmount: number | null;

  // Paid-upfront detection
  paidUpfront: boolean;
  likelyPaidUpfront: boolean;
  // Computed from payment data: has at least one ok-successful payment after pilot end date
  rolledOver: boolean;

  // ---- Tab 2 tile inputs (per-row) -------------------------------------------
  // True when the org has the "Dead <30 days" or "Dead/offboarded" label —
  // excluded from the pilots tile / rollover-% denominator / forecast total.
  excludedFromCount: boolean;
  // Forecast contribution in dollars for this org (0 when no bucket applies).
  forecastContribution: number;
  // Which forecast bucket this row falls into (null = excluded / no contribution):
  //   'A' — past pilot + active recurring sub        → 100% of monthly amount
  //   'B' — Potential Rollover label (not in A)      → 50%  of monthly amount
  //   'C' — Stripe upfront billed this calendar mo.  → full upfront amount
  forecastBucket: 'A' | 'B' | 'C' | null;
};

export type PilotMonthSummary = {
  pilotsThisMonth: number;        // post-exclusion denominator
  rolloverNumerator: number;      // Rolled Over + Potential Rollover (post-exclusion)
  rolloverPercent: number;        // 0-100 rounded; 0 when denominator is 0
  forecastTotal: number;          // sum of forecastContribution across non-excluded rows
};

export type JoinedPilotResult = {
  rows: JoinedPilotRow[];
  summary: PilotMonthSummary;
};

// ---------------------------------------------------------------------------
// Neon subscription + payment shape (minimal — what we need)
// ---------------------------------------------------------------------------
type NeonClient = {
  chargeoverCustomerId: string | null;
  pipedriveOrgId: number;
  billingProcessor: string | null;
  stripeCustomerId: string | null;
  financeNotes: string | null;
  subscriptions: SubRaw[];
  payments: PayRaw[];
};

function buildPaymentData(neon: NeonClient, now: Date): Pick<
  JoinedPilotRow,
  'lastPaymentDate' | 'lastPaymentAmount' | 'lastPaymentPending' |
  'monthlyAmount' | 'nextPaymentDate' | 'nextPaymentAmount' |
  'paidUpfront' | 'likelyPaidUpfront'
> {
  const activeSubs = neon.subscriptions.filter(s => isActive(s.status));
  const largestSub = [...activeSubs].sort(
    (a, b) => Number(b.amount ?? 0) - Number(a.amount ?? 0)
  )[0] ?? null;

  // Next scheduled invoice: canonical function covering all historical fixes
  const scheduled = nextScheduledPayment(activeSubs, now);

  // Monthly amount: sub.amount when > 0; fallback to lineItemSum from companion recurring
  // sub for paid-upfront clients whose largestSub.amount = 0.
  const monthlyAmount = Number(largestSub?.amount ?? 0) > 0
    ? Number(largestSub!.amount)
    : (scheduled?.amount ?? null);

  // Use statusNormalized enum — processor-agnostic
  const nonFailed = neon.payments.filter(p => p.statusNormalized !== 'FAILED');
  const lastAny = nonFailed[0] ?? null;
  const lastPaymentPending = lastAny ? lastAny.statusNormalized !== 'SUCCESS' : false;

  const paidUpfront = isPaidUpfront(neon.financeNotes);
  // Iterate all active subs — upfront-block sub lives alongside recurring template sub
  const likelyPaidUpfront = !paidUpfront && isLikelyPaidUpfront(activeSubs);

  return {
    lastPaymentDate:    lastAny?.paidDate ? new Date(lastAny.paidDate).toISOString() : null,
    lastPaymentAmount:  lastAny ? Number(lastAny.amount ?? 0) : null,
    lastPaymentPending,
    monthlyAmount,
    nextPaymentDate:    scheduled?.date?.toISOString() ?? null,
    nextPaymentAmount:  scheduled?.amount ?? null,
    paidUpfront,
    likelyPaidUpfront,
  };
}

// ---------------------------------------------------------------------------
// Main join function
// ---------------------------------------------------------------------------
export async function joinPilotEndingMonth(): Promise<JoinedPilotResult> {
  const pdOrgs = await getOrgsWithPilotEndingThisMonth();

  // Collect all ChargeOver IDs that exist in PipeDrive results
  const coIds = pdOrgs.map(o => o.chargeoverCustomerId).filter((id): id is string => id !== null);

  // Shared select shape — used for both the primary and secondary Neon queries
  const NEON_SELECT = {
    chargeoverCustomerId: true,
    pipedriveOrgId: true,
    billingProcessor: true,
    stripeCustomerId: true,
    financeNotes: true,
    subscriptions: { select: { status: true, amount: true, lineItems: true, billingProcessor: true } },
    payments: {
      orderBy: { paidDate: 'desc' as const },
      select: { amount: true, paidDate: true, status: true, statusNormalized: true },
    },
  };

  // Primary lookup: match by chargeoverCustomerId (ChargeOver clients)
  const neonByCoId = new Map<string, NeonClient>();
  if (coIds.length > 0) {
    const rows = await prisma.client.findMany({
      where: { chargeoverCustomerId: { in: coIds } },
      select: NEON_SELECT,
    });
    for (const c of rows) {
      if (c.chargeoverCustomerId) neonByCoId.set(c.chargeoverCustomerId, c as NeonClient);
    }
  }

  // Secondary lookup: match by pipedriveOrgId for Stripe-only orgs (no chargeoverCustomerId)
  const unmatchedOrgIds = pdOrgs
    .filter(o => !o.chargeoverCustomerId || !neonByCoId.has(o.chargeoverCustomerId!))
    .map(o => o.pipedriveOrgId);

  const neonByPdOrgId = new Map<number, NeonClient>();
  if (unmatchedOrgIds.length > 0) {
    const rows = await prisma.client.findMany({
      where: { pipedriveOrgId: { in: unmatchedOrgIds } },
      select: NEON_SELECT,
    });
    for (const c of rows) {
      neonByPdOrgId.set(c.pipedriveOrgId, c as NeonClient);
    }
  }

  const now = new Date();
  const etYearMonth = currentEtYearMonth(now);

  const rows = pdOrgs.map((pd): JoinedPilotRow => {
    const neon =
      (pd.chargeoverCustomerId ? neonByCoId.get(pd.chargeoverCustomerId) : undefined)
      ?? neonByPdOrgId.get(pd.pipedriveOrgId)
      ?? null;
    const paymentData = neon
      ? buildPaymentData(neon, now)
      : {
          lastPaymentDate: null, lastPaymentAmount: null, lastPaymentPending: false,
          monthlyAmount: null,
          nextPaymentDate: null, nextPaymentAmount: null,
          paidUpfront: false, likelyPaidUpfront: false,
        };

    const pilotEndDate = pd.pilotRolloverEndDate ? new Date(pd.pilotRolloverEndDate) : null;
    const rolledOver = neon ? isRolledOver(pilotEndDate, neon.payments, now) : false;
    const isStripe = neon
      ? (neon.billingProcessor === 'STRIPE' || (neon.stripeCustomerId != null && neon.chargeoverCustomerId == null))
      : false;

    // === Forecast bucket math ================================================
    //
    //   Bucket A — "Billing past pilot" (100% confidence)
    //     pilot ended AND org has an active recurring subscription.
    //     Recurring = ChargeOver sub with at least one nextBillDate, OR Stripe
    //     sub with currentPeriodEnd set and upfrontPending !== true.
    //   Bucket B — "Rollover candidates" (50%)
    //     "Potential Rollover" label, NOT already in A.
    //   Bucket C — "Stripe Upfront billed this month" (100%)
    //     Stripe sub with upfrontPending=true AND upfrontBillingDate in the
    //     current calendar month (America/New_York).
    //
    //   Dedupe — an org in both A and C is counted once at the higher
    //   contribution (warning logged).
    //   Exclusion — Dead<30 or Dead/offboarded labels short-circuit to 0.

    const labelIds = new Set(pd.labels.map((l) => l.id));
    const excludedFromCount =
      labelIds.has(DEAD_LT_30_LABEL_ID) || labelIds.has(DEAD_OFFBOARDED_LABEL_ID);
    const potentialRollover = labelIds.has(POTENTIAL_ROLLOVER_LABEL_ID);

    const activeSubs = neon ? neon.subscriptions.filter((s) => isActive(s.status)) : [];

    const recurringSubs = activeSubs.filter((s) => {
      if (s.billingProcessor === 'STRIPE') {
        const li = s.lineItems as {
          currentPeriodEnd?: number;
          cancelAtPeriodEnd?: boolean;
          upfrontPending?: boolean;
        } | null;
        return !!li && !li.cancelAtPeriodEnd && li.currentPeriodEnd != null && li.upfrontPending !== true;
      }
      const liArr = s.lineItems as Array<{ nextBillDate?: string; next_bill_date?: string }> | null;
      return Array.isArray(liArr) && liArr.some((li) => li?.nextBillDate || li?.next_bill_date);
    });

    const pastPilot = !!(pilotEndDate && pilotEndDate < now);
    const bucketAEligible = pastPilot && recurringSubs.length > 0;
    const bucketAAmount = bucketAEligible
      ? recurringSubs.reduce((max, s) => Math.max(max, getMonthlyAmount(s)), 0)
      : 0;

    const upfrontSubsThisMonth = activeSubs.filter((s) => {
      if (s.billingProcessor !== 'STRIPE') return false;
      const li = s.lineItems as { upfrontPending?: boolean; upfrontBillingDate?: string | null } | null;
      return !!li
        && li.upfrontPending === true
        && typeof li.upfrontBillingDate === 'string'
        && li.upfrontBillingDate.startsWith(etYearMonth);
    });
    const tier = neon ? deriveTier(neon.financeNotes) : null;
    const tierUpfrontAmount =
      tier === 'Platinum' ? PLATINUM_UPFRONT_AMOUNT
      : tier === 'Gold'   ? GOLD_UPFRONT_AMOUNT
      : 0;
    const bucketCEligible = upfrontSubsThisMonth.length > 0 && tierUpfrontAmount > 0;
    const bucketCAmount = bucketCEligible ? tierUpfrontAmount : 0;
    if (upfrontSubsThisMonth.length > 0 && tierUpfrontAmount === 0) {
      console.warn(
        `[forecast] ${pd.organizationName} (pdOrgId=${pd.pipedriveOrgId}) has Stripe upfront ` +
        `billing this month but tier could not be inferred from financeNotes — contribution=0`,
      );
    }

    let forecastBucket: 'A' | 'B' | 'C' | null = null;
    let forecastContribution = 0;

    if (excludedFromCount) {
      // exclusion wins
    } else if (bucketAEligible && bucketCEligible) {
      // Both A and C apply — count once at the higher amount.
      if (bucketAAmount >= bucketCAmount) {
        forecastBucket = 'A';
        forecastContribution = bucketAAmount;
      } else {
        forecastBucket = 'C';
        forecastContribution = bucketCAmount;
      }
      console.warn(
        `[forecast] ${pd.organizationName} (pdOrgId=${pd.pipedriveOrgId}) qualifies for ` +
        `both Bucket A ($${bucketAAmount}) and Bucket C ($${bucketCAmount}); ` +
        `counted at Bucket ${forecastBucket}`,
      );
    } else if (bucketAEligible) {
      forecastBucket = 'A';
      forecastContribution = bucketAAmount;
    } else if (bucketCEligible) {
      forecastBucket = 'C';
      forecastContribution = bucketCAmount;
    } else if (potentialRollover) {
      // Bucket B uses the largest active sub's monthly amount via getMonthlyAmount.
      // Falls to 0 (and the "excluded" UI state) when no qualifying recurring amount.
      const bAmount = activeSubs.reduce((max, s) => Math.max(max, getMonthlyAmount(s)), 0);
      if (bAmount > 0) {
        forecastBucket = 'B';
        forecastContribution = 0.5 * bAmount;
      }
    }

    return {
      pipedriveOrgId:      pd.pipedriveOrgId,
      organizationName:    pd.organizationName,
      accountStatus:       pd.accountStatus,
      accountManager:      pd.accountManager,
      pilotRolloverEndDate: pd.pilotRolloverEndDate,
      labels:              pd.labels,
      chargeoverCustomerId: pd.chargeoverCustomerId,
      hasNeonMatch:        neon !== null,
      isStripe,
      ...paymentData,
      rolledOver,
      excludedFromCount,
      forecastContribution,
      forecastBucket,
    };
  });

  // Tile aggregates (rounded once at the end, per spec).
  const included = rows.filter((r) => !r.excludedFromCount);
  const pilotsThisMonth = included.length;
  const rolloverNumerator = included.filter((r) => {
    const ids = new Set(r.labels.map((l) => l.id));
    return ids.has(ROLLED_OVER_LABEL_ID) || ids.has(POTENTIAL_ROLLOVER_LABEL_ID);
  }).length;
  const rolloverPercent = pilotsThisMonth > 0
    ? Math.round((rolloverNumerator / pilotsThisMonth) * 100)
    : 0;
  const forecastTotal = Math.round(
    included.reduce((sum, r) => sum + r.forecastContribution, 0),
  );

  // Sanity check — the Forecast tile and the sum of the Forecast column are
  // computed from the same per-row field, so they must always match. If this
  // ever diverges, the tile / row code paths have drifted.
  const columnSumUnrounded = rows.reduce((s, r) => s + r.forecastContribution, 0);
  const columnSum = Math.round(columnSumUnrounded);
  console.assert(
    forecastTotal === columnSum,
    `[forecast] tile total ($${forecastTotal}) diverges from column sum ($${columnSum})`,
  );

  return {
    rows,
    summary: { pilotsThisMonth, rolloverNumerator, rolloverPercent, forecastTotal },
  };
}

// Serialized version for client components (Dates as strings — already are)
export type SerializedJoinedPilotRow = JoinedPilotRow;
