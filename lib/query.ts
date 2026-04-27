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
  // isRecurringMonthly: has nextBillDate AND NOT paidUpfront AND nextBillDate within 60 days
  // Judgment call: 60-day window excludes quarterly/annual billing, includes monthly
  isRecurringMonthly: boolean;
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

  // Recurring monthly detection:
  // - NOT paidUpfront
  // - largest sub has a nextBillDate (excludes one-time payments)
  // - nextBillDate is within 60 days of today (excludes quarterly/annual billing)
  const sixtyDaysOut = new Date(now);
  sixtyDaysOut.setDate(sixtyDaysOut.getDate() + 60);
  const tenDaysAgo = new Date(now);
  tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
  const isRecurringMonthly =
    !paidUpfront &&
    !!nextPaymentDate &&
    nextPaymentDate >= tenDaysAgo &&
    nextPaymentDate <= sixtyDaysOut;

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
    isRecurringMonthly,
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
// Shared DB select config
// ---------------------------------------------------------------------------
const CLIENT_SELECT = {
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
    orderBy: { paidDate: 'desc' as const },
    select: { amount: true, paidDate: true, status: true },
  },
};

// ---------------------------------------------------------------------------
// Tab 1: Pilot ending in next 10 days
// ---------------------------------------------------------------------------
export async function getPilotEndingRows(): Promise<ClientRow[]> {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const tenDaysEnd = new Date(todayStart);
  tenDaysEnd.setDate(tenDaysEnd.getDate() + 10);
  tenDaysEnd.setHours(23, 59, 59, 999);

  const clients = await prisma.client.findMany({
    where: {
      accountStatus: { in: ['Live', 'Pre-Launch'] },
      pilotRolloverEndDate: { gte: todayStart, lte: tenDaysEnd },
    },
    select: CLIENT_SELECT,
    orderBy: { pilotRolloverEndDate: 'asc' },
  }) as unknown as ClientRaw[];

  return clients.map(buildRow);
}

// ---------------------------------------------------------------------------
// Tab 2: Active clients by price (recurring monthly only)
// ---------------------------------------------------------------------------
export async function getActiveByPriceRows(): Promise<ClientRow[]> {
  const clients = await prisma.client.findMany({
    where: { accountStatus: { in: ['Live', 'Pre-Launch'] } },
    select: CLIENT_SELECT,
    orderBy: { organizationName: 'asc' },
  }) as unknown as ClientRaw[];

  return clients
    .map(buildRow)
    .filter((r) => r.isRecurringMonthly)
    .sort((a, b) => (b.largestSubAmount ?? 0) - (a.largestSubAmount ?? 0));
}

// ---------------------------------------------------------------------------
// Tab 3: Live clients (pilot status)
// ---------------------------------------------------------------------------
export async function getLivePilotRows(): Promise<ClientRow[]> {
  const clients = await prisma.client.findMany({
    where: { accountStatus: 'Live' },
    select: CLIENT_SELECT,
    orderBy: { organizationName: 'asc' },
  }) as unknown as ClientRaw[];

  return clients.map(buildRow);
}

// ---------------------------------------------------------------------------
// Stats (runs on every page load — feeds the master stats section)
// ---------------------------------------------------------------------------
export type Stats = {
  totalClients: number;
  pilotsEndingNext10Days: number;
  pilotsEndingThisMonth: number;
  pilotsEndingNextMonth: number;
  pilotsEndingMonthAfterNext: number;
  thisMonthName: string;
  nextMonthName: string;
  monthAfterNextName: string;
  lastMonthName: string;
  revenueLastMonth: number;
  revenueMtd: number;
  revenueForecast: number;
  revenuePostPilotRecurring: number;
};

export async function getStats(): Promise<Stats> {
  const now = new Date();

  // Calendar boundaries
  const y = now.getFullYear();
  const m = now.getMonth();

  const thisMonthStart  = new Date(y, m, 1);
  const thisMonthEnd    = new Date(y, m + 1, 0, 23, 59, 59, 999);
  const lastMonthStart  = new Date(y, m - 1, 1);
  const lastMonthEnd    = new Date(y, m, 0, 23, 59, 59, 999);
  const nextMonthStart  = new Date(y, m + 1, 1);
  const nextMonthEnd    = new Date(y, m + 2, 0, 23, 59, 59, 999);
  const m2Start         = new Date(y, m + 2, 1);
  const m2End           = new Date(y, m + 3, 0, 23, 59, 59, 999);

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const tenDaysEnd = new Date(todayStart);
  tenDaysEnd.setDate(tenDaysEnd.getDate() + 10);
  tenDaysEnd.setHours(23, 59, 59, 999);

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const clients = await prisma.client.findMany({
    where: { accountStatus: { in: ['Live', 'Pre-Launch'] } },
    select: {
      accountStatus: true,
      pilotRolloverEndDate: true,
      financeNotes: true,
      subscriptions: { select: { status: true, amount: true, lineItems: true } },
      payments: {
        select: { amount: true, paidDate: true, status: true },
      },
    },
  });

  let totalClients = clients.length;
  let pilotsEndingNext10Days = 0;
  let pilotsEndingThisMonth = 0;
  let pilotsEndingNextMonth = 0;
  let pilotsEndingMonthAfterNext = 0;
  let revenueLastMonth = 0;
  let revenueMtd = 0;
  let revenueFuture = 0; // nextBillDates falling tomorrow–end of this month
  let revenuePostPilotRecurring = 0;

  for (const c of clients) {
    // Pilot month counts
    if (c.pilotRolloverEndDate) {
      const pd = new Date(c.pilotRolloverEndDate);
      if (pd >= todayStart && pd <= tenDaysEnd) pilotsEndingNext10Days++;
      if (pd >= thisMonthStart && pd <= thisMonthEnd) pilotsEndingThisMonth++;
      else if (pd >= nextMonthStart && pd <= nextMonthEnd) pilotsEndingNextMonth++;
      else if (pd >= m2Start && pd <= m2End) pilotsEndingMonthAfterNext++;
    }

    // Revenue from payments
    for (const p of c.payments) {
      if (!PAID_STATUSES.includes((p.status ?? '').toLowerCase())) continue;
      const pd = p.paidDate ? new Date(p.paidDate) : null;
      if (!pd) continue;
      if (pd >= lastMonthStart && pd <= lastMonthEnd) revenueLastMonth += Number(p.amount);
      if (pd >= thisMonthStart && pd <= now) revenueMtd += Number(p.amount);
    }

    // Future payments this month (nextBillDate between tomorrow and end of this month)
    const activeSubs = (c.subscriptions as SubRaw[]).filter((s) => isActive(s.status));
    const sortedSubs = [...activeSubs].sort((a, b) => subAmount(b) - subAmount(a));
    const largestSub = sortedSubs[0] ?? null;

    if (largestSub) {
      const nextBill = getNextBillDate(largestSub);
      if (nextBill && nextBill >= tomorrow && nextBill <= thisMonthEnd) {
        revenueFuture += subAmount(largestSub);
      }

      // Post-pilot recurring: live clients past pilot with an active sub
      const fn = (c.financeNotes ?? '').toLowerCase();
      const paidUpfront = fn.includes('paid upfront');
      const pilotEnd = c.pilotRolloverEndDate ? new Date(c.pilotRolloverEndDate) : null;
      if (
        c.accountStatus === 'Live' &&
        pilotEnd && pilotEnd <= now &&
        !paidUpfront
      ) {
        revenuePostPilotRecurring += subAmount(largestSub);
      }
    }
  }

  return {
    totalClients,
    pilotsEndingNext10Days,
    pilotsEndingThisMonth,
    pilotsEndingNextMonth,
    pilotsEndingMonthAfterNext,
    thisMonthName: monthNames[m],
    nextMonthName: monthNames[(m + 1) % 12],
    monthAfterNextName: monthNames[(m + 2) % 12],
    lastMonthName: monthNames[((m - 1) + 12) % 12],
    revenueLastMonth,
    revenueMtd,
    revenueForecast: revenueMtd + revenueFuture,
    revenuePostPilotRecurring,
  };
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
