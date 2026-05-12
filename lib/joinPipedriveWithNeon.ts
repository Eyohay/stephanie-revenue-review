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
 * Join key: PipeDrive "Chargeover Customer #" field (numeric double stored as
 * string like "2613") ↔ Neon client.chargeoverCustomerId (string).
 */

import { prisma } from './prisma';
import {
  ACTIVE_STATUSES,
  isActive,
  isPaidUpfront,
  isLikelyPaidUpfront,
  isRolledOver,
  nextScheduledPayment,
  type SubRaw,
  type PayRaw,
} from './query';
import { getOrgsWithPilotEndingThisMonth, type PdOrg } from './pipedrive/queries';

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
};

// ---------------------------------------------------------------------------
// Neon subscription + payment shape (minimal — what we need)
// ---------------------------------------------------------------------------
type NeonClient = {
  chargeoverCustomerId: string | null;
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
export async function joinPilotEndingMonth(): Promise<JoinedPilotRow[]> {
  const pdOrgs = await getOrgsWithPilotEndingThisMonth();

  // Collect all ChargeOver IDs that exist in PipeDrive results
  const coIds = pdOrgs.map(o => o.chargeoverCustomerId).filter((id): id is string => id !== null);

  // Fetch matching Neon clients (no status filter — we want Churned clients too)
  const neonClients = coIds.length > 0
    ? await prisma.client.findMany({
        where: { chargeoverCustomerId: { in: coIds } },
        select: {
          chargeoverCustomerId: true,
          billingProcessor: true,
          stripeCustomerId: true,
          financeNotes: true,
          subscriptions: { select: { status: true, amount: true, lineItems: true, billingProcessor: true } },
          payments: {
            orderBy: { paidDate: 'desc' },
            select: { amount: true, paidDate: true, status: true, statusNormalized: true },
          },
        },
      })
    : [];

  const neonByCoId = new Map<string, NeonClient>();
  for (const c of neonClients) {
    if (c.chargeoverCustomerId) neonByCoId.set(c.chargeoverCustomerId, c as NeonClient);
  }

  const now = new Date();

  return pdOrgs.map((pd): JoinedPilotRow => {
    const neon = pd.chargeoverCustomerId ? neonByCoId.get(pd.chargeoverCustomerId) ?? null : null;
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
    };
  });
}

// Serialized version for client components (Dates as strings — already are)
export type SerializedJoinedPilotRow = JoinedPilotRow;
