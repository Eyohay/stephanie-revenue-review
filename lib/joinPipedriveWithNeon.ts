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
  PAID_STATUSES,
  FAILED_STATUSES,
  isActive,
  isPaidUpfront,
  isLikelyPaidUpfront,
  nextScheduledForAllSubs,
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
};

// ---------------------------------------------------------------------------
// Neon subscription + payment shape (minimal — what we need)
// ---------------------------------------------------------------------------
type NeonClient = {
  chargeoverCustomerId: string | null;
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

  // Monthly amount: sub.amount from largest active sub (null when paid-upfront)
  const monthlyAmount = Number(largestSub?.amount ?? 0) > 0 ? Number(largestSub!.amount) : null;

  // Next scheduled invoice: search ALL active subs (finds companion sub's nextBillDate)
  const scheduled = nextScheduledForAllSubs(activeSubs, now);

  const nonFailed = neon.payments.filter(
    p => !FAILED_STATUSES.includes((p.status ?? '').toLowerCase())
  );
  const lastAny = nonFailed[0] ?? null;
  const lastPaymentPending = lastAny
    ? !PAID_STATUSES.includes((lastAny.status ?? '').toLowerCase())
    : false;

  const paidUpfront = isPaidUpfront(neon.financeNotes);
  const likelyPaidUpfront = !paidUpfront && isLikelyPaidUpfront(largestSub);

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
          financeNotes: true,
          subscriptions: { select: { status: true, amount: true, lineItems: true } },
          payments: {
            orderBy: { paidDate: 'desc' },
            select: { amount: true, paidDate: true, status: true },
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

    return {
      pipedriveOrgId:      pd.pipedriveOrgId,
      organizationName:    pd.organizationName,
      accountStatus:       pd.accountStatus,
      accountManager:      pd.accountManager,
      pilotRolloverEndDate: pd.pilotRolloverEndDate,
      labels:              pd.labels,
      chargeoverCustomerId: pd.chargeoverCustomerId,
      hasNeonMatch:        neon !== null,
      ...paymentData,
    };
  });
}

// Serialized version for client components (Dates as strings — already are)
export type SerializedJoinedPilotRow = JoinedPilotRow;
