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
  type SubRaw,
  type PayRaw,
} from './query';
import { getOrgsWithPilotEndingThisMonth } from './pipedrive/queries';
import {
  DEAD_LT_30_LABEL_ID,
  DEAD_OFFBOARDED_LABEL_ID,
  ROLLED_OVER_LABEL_ID,
  POTENTIAL_ROLLOVER_LABEL_ID,
} from './pipedrive/client';

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
  // True when the org has the "Dead <30 days" label — excluded from the
  // pilots tile / rollover-% denominator / forecast total.
  excludedFromCount: boolean;
  // Forecast contribution in dollars for this org (0 when excluded or no Neon data).
  forecastContribution: number;
  // Multiplier applied to monthlyAmount to derive the contribution.
  // 1 = full (active sub, not rollover-tagged)
  // 0.5 = Potential Rollover label present
  // 0 = excluded or no recurring template
  forecastMultiplier: 0 | 0.5 | 1;
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

    // Per-row forecast inputs (full math in the row enrichment loop below).
    const labelIds = new Set(pd.labels.map((l) => l.id));
    const excludedFromCount =
      labelIds.has(DEAD_LT_30_LABEL_ID) || labelIds.has(DEAD_OFFBOARDED_LABEL_ID);
    const potentialRollover = labelIds.has(POTENTIAL_ROLLOVER_LABEL_ID);

    // Effective retainer for forecast purposes — paid-upfront clients use the
    // companion-sub fallback already encoded in monthlyAmount; missing-Neon orgs
    // contribute 0. The canonical helper (nextScheduledPayment) already excludes
    // discount line items and caps multi-month subs at per-month — no re-implementation.
    const retainer = paymentData.monthlyAmount ?? 0;

    const hasActiveSub = !!neon && neon.subscriptions.some((s) => isActive(s.status));

    let forecastMultiplier: 0 | 0.5 | 1;
    if (excludedFromCount) {
      forecastMultiplier = 0;
    } else if (potentialRollover) {
      forecastMultiplier = 0.5;
    } else if (hasActiveSub && retainer > 0) {
      forecastMultiplier = 1;
    } else {
      forecastMultiplier = 0;
      if (!excludedFromCount) {
        console.warn(
          `[forecast] No contribution for ${pd.organizationName} (pdOrgId=${pd.pipedriveOrgId}): ` +
          `hasNeon=${!!neon} activeSub=${hasActiveSub} retainer=${retainer}`,
        );
      }
    }
    const forecastContribution = retainer * forecastMultiplier;

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
      forecastMultiplier,
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

  return {
    rows,
    summary: { pilotsThisMonth, rolloverNumerator, rolloverPercent, forecastTotal },
  };
}

// Serialized version for client components (Dates as strings — already are)
export type SerializedJoinedPilotRow = JoinedPilotRow;
