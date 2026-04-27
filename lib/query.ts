import { prisma } from './prisma';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const ACTIVE_STATUSES = ['active', 'current', 'trialing', 'in_trial', 'live', 'a'];
const PAID_STATUSES = ['paid', 'successful', 'succeeded', 'completed', 'captured', 'settled', 'ok-successful'];
const FAILED_STATUSES = ['no-declined', 'fail', 'failed', 'declined', 'refunded', 'error'];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
function subAmount(sub: { amount: unknown; lineItems: unknown }): number {
  const liArr = sub.lineItems as Array<{ unitPrice?: number; quantity?: number }> | null;
  if (Array.isArray(liArr) && liArr.length > 0) {
    const total = liArr.reduce((sum, item) => sum + (item.unitPrice ?? 0) * (item.quantity ?? 1), 0);
    if (total > 0) return total;
  }
  return Number(sub.amount ?? 0);
}

function getNextBillDate(sub: { lineItems: unknown }): Date | null {
  const liArr = sub.lineItems as Array<{ next_bill_date?: string; nextBillDate?: string }> | null;
  if (Array.isArray(liArr) && liArr.length > 0) {
    for (const item of liArr) {
      const raw = item?.nextBillDate || item?.next_bill_date;
      if (raw) return new Date(raw);
    }
  }
  return null;
}

function isActive(status: string | null): boolean {
  return ACTIVE_STATUSES.includes((status ?? '').toLowerCase());
}

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------
type SubRaw = {
  status: string | null;
  amount: unknown;
  lineItems: unknown;
};

type PayRaw = {
  amount: unknown;
  paidDate: Date | null;
  status: string;
};

type ClientRaw = {
  id: string;
  pipedriveOrgId: number;
  organizationName: string;
  accountStatus: string;
  chargeoverCustomerId: string | null;
  financeNotes: string | null;
  pilotRolloverEndDate: Date | null;
  subscriptions: SubRaw[];
  payments: PayRaw[];
};

export type ClientRow = {
  id: string;
  pipedriveOrgId: number;
  organizationName: string;
  accountStatus: string;
  chargeoverCustomerId: string | null;
  paidUpfront: boolean;
  // Pilot
  pilotRolloverEndDate: Date | null;
  isInPilot: boolean;
  isPastPilot: boolean;
  // Subscription
  activeSubscriptionCount: number;
  largestSubAmount: number | null;
  largestSubProductName: string | null;
  // Tier from financeNotes
  tier: 'Platinum' | 'Gold' | null;
  // Payments
  lastPaymentDate: Date | null;
  lastPaymentAmount: number | null;
  lastPaymentPending: boolean;
  nextPaymentDate: Date | null;
  nextPaymentAmount: number | null;
  lifetimeTotalPaid: number;
};

// Date fields as ISO strings for safe server→client passing
export type SerializedClientRow = Omit<
  ClientRow,
  'pilotRolloverEndDate' | 'lastPaymentDate' | 'nextPaymentDate'
> & {
  pilotRolloverEndDate: string | null;
  lastPaymentDate: string | null;
  nextPaymentDate: string | null;
};

export function serializeRow(r: ClientRow): SerializedClientRow {
  return {
    ...r,
    pilotRolloverEndDate: r.pilotRolloverEndDate?.toISOString() ?? null,
    lastPaymentDate: r.lastPaymentDate?.toISOString() ?? null,
    nextPaymentDate: r.nextPaymentDate?.toISOString() ?? null,
  };
}

// ---------------------------------------------------------------------------
// Row builder
// ---------------------------------------------------------------------------
function buildRow(c: ClientRaw): ClientRow {
  const now = new Date();

  const activeSubs = c.subscriptions.filter((s) => isActive(s.status));

  // Largest active sub by amount
  const sortedSubs = [...activeSubs].sort((a, b) => subAmount(b) - subAmount(a));
  const largestSub = sortedSubs[0] ?? null;
  const largestSubAmount = largestSub ? subAmount(largestSub) : null;
  // Product name from lineItems[0].description or null — ChargeOver stores it there
  const largestSubProductName = (() => {
    if (!largestSub) return null;
    const liArr = largestSub.lineItems as Array<{ description?: string; item?: string }> | null;
    if (Array.isArray(liArr) && liArr.length > 0) {
      return liArr[0]?.description || liArr[0]?.item || null;
    }
    return null;
  })();

  // Payments
  const paidPayments = c.payments.filter((p) => PAID_STATUSES.includes((p.status ?? '').toLowerCase()));
  const lifetimeTotalPaid = paidPayments.reduce((sum, p) => sum + Number(p.amount ?? 0), 0);

  // Last non-failed payment (captured or pending)
  const nonFailedPayments = c.payments.filter((p) => !FAILED_STATUSES.includes((p.status ?? '').toLowerCase()));
  const lastAny = nonFailedPayments[0] ?? null;
  const lastPaymentPending = lastAny
    ? !PAID_STATUSES.includes((lastAny.status ?? '').toLowerCase())
    : false;

  // Next payment from largest sub lineItems
  let nextPaymentDate: Date | null = null;
  let nextPaymentAmount: number | null = null;
  if (largestSub) {
    const nd = getNextBillDate(largestSub);
    if (nd) {
      nextPaymentDate = nd;
      nextPaymentAmount = largestSubAmount;
    }
  }

  // Pilot
  const pilotEnd = c.pilotRolloverEndDate ? new Date(c.pilotRolloverEndDate) : null;
  const isInPilot = !!(pilotEnd && pilotEnd > now);
  const isPastPilot = !!(pilotEnd && pilotEnd <= now);

  // Tier detection
  const fn = (c.financeNotes ?? '').toLowerCase();
  let tier: 'Platinum' | 'Gold' | null = null;
  if (fn.includes('platinum')) tier = 'Platinum';
  else if (fn.includes('gold')) tier = 'Gold';

  // Paid upfront
  const paidUpfront = fn.includes('paid upfront');

  return {
    id: c.id,
    pipedriveOrgId: c.pipedriveOrgId,
    organizationName: c.organizationName,
    accountStatus: c.accountStatus,
    chargeoverCustomerId: c.chargeoverCustomerId,
    paidUpfront,
    pilotRolloverEndDate: pilotEnd,
    isInPilot,
    isPastPilot,
    activeSubscriptionCount: activeSubs.length,
    largestSubAmount,
    largestSubProductName,
    tier,
    lastPaymentDate: lastAny?.paidDate ?? null,
    lastPaymentAmount: lastAny ? Number(lastAny.amount ?? 0) : null,
    lastPaymentPending,
    nextPaymentDate,
    nextPaymentAmount,
    lifetimeTotalPaid,
  };
}

// ---------------------------------------------------------------------------
// Shared DB fetch (reads all live/pre-launch clients once)
// ---------------------------------------------------------------------------
async function fetchAllClients(): Promise<ClientRaw[]> {
  return prisma.client.findMany({
    where: {
      accountStatus: { in: ['Live', 'Pre-Launch'] },
    },
    select: {
      id: true,
      pipedriveOrgId: true,
      organizationName: true,
      accountStatus: true,
      chargeoverCustomerId: true,
      financeNotes: true,
      pilotRolloverEndDate: true,
      subscriptions: {
        select: { status: true, amount: true, lineItems: true },
      },
      payments: {
        orderBy: { paidDate: 'desc' },
        select: { amount: true, paidDate: true, status: true },
      },
    },
    orderBy: { organizationName: 'asc' },
  }) as Promise<ClientRaw[]>;
}

// ---------------------------------------------------------------------------
// Tab 1: Pilot Ending (within 7 days)
// ---------------------------------------------------------------------------
export async function getPilotEndingRows(): Promise<ClientRow[]> {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const sevenDaysEnd = new Date(todayStart);
  sevenDaysEnd.setDate(sevenDaysEnd.getDate() + 7);
  sevenDaysEnd.setHours(23, 59, 59, 999);

  const clients = await prisma.client.findMany({
    where: {
      accountStatus: { in: ['Live', 'Pre-Launch'] },
      pilotRolloverEndDate: {
        gte: todayStart,
        lte: sevenDaysEnd,
      },
    },
    select: {
      id: true,
      pipedriveOrgId: true,
      organizationName: true,
      accountStatus: true,
      chargeoverCustomerId: true,
      financeNotes: true,
      pilotRolloverEndDate: true,
      subscriptions: {
        select: { status: true, amount: true, lineItems: true },
      },
      payments: {
        orderBy: { paidDate: 'desc' },
        select: { amount: true, paidDate: true, status: true },
      },
    },
    orderBy: { pilotRolloverEndDate: 'asc' },
  }) as unknown as ClientRaw[];

  return clients.map(buildRow);
}

// ---------------------------------------------------------------------------
// Tab 2: Active by price bucket (live + pre-launch)
// ---------------------------------------------------------------------------
export async function getActiveByPriceRows(): Promise<ClientRow[]> {
  const clients = await fetchAllClients();
  const rows = clients.map(buildRow);
  // Sort by largestSubAmount desc within each bucket (bucket grouping done in UI)
  return rows.sort((a, b) => (b.largestSubAmount ?? 0) - (a.largestSubAmount ?? 0));
}

// ---------------------------------------------------------------------------
// Tab 3: Live pilot status
// ---------------------------------------------------------------------------
export async function getLivePilotRows(): Promise<ClientRow[]> {
  const clients = await prisma.client.findMany({
    where: { accountStatus: 'Live' },
    select: {
      id: true,
      pipedriveOrgId: true,
      organizationName: true,
      accountStatus: true,
      chargeoverCustomerId: true,
      financeNotes: true,
      pilotRolloverEndDate: true,
      subscriptions: {
        select: { status: true, amount: true, lineItems: true },
      },
      payments: {
        orderBy: { paidDate: 'desc' },
        select: { amount: true, paidDate: true, status: true },
      },
    },
    orderBy: { organizationName: 'asc' },
  }) as unknown as ClientRaw[];

  return clients.map(buildRow);
}

// ---------------------------------------------------------------------------
// Last sync time
// ---------------------------------------------------------------------------
export async function getLastSyncedAt(): Promise<Date | null> {
  const log = await prisma.syncLog.findFirst({
    where: { status: 'success' },
    orderBy: { completedAt: 'desc' },
    select: { completedAt: true },
  });
  return log?.completedAt ?? null;
}
