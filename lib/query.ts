import { prisma } from './prisma';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const ACTIVE_STATUSES = ['active', 'current', 'trialing', 'in_trial', 'live', 'a'];
const PAID_STATUSES = ['paid', 'successful', 'succeeded', 'completed', 'captured', 'settled', 'ok-successful'];
const FAILED_STATUSES = ['no-declined', 'fail', 'failed', 'declined', 'refunded', 'error'];

// Floor 9 is an internal/investment entity — excluded from all Stephanie views (matches active-clients-billing)
const FLOOR9_ENGAGEMENT = ['Floor 9', 'floor 9', 'FLOOR 9', 'Floor9', 'floor9'];
const FLOOR9_BRAND = [...FLOOR9_ENGAGEMENT, 'Floor 9 Ventures', 'floor 9 ventures', 'FLOOR 9 VENTURES'];

const FLOOR9_WHERE = {
  AND: [
    { OR: [{ engagementType: null as string | null }, { engagementType: { notIn: FLOOR9_ENGAGEMENT } }] },
    { OR: [{ dealType: null as string | null }, { dealType: { notIn: FLOOR9_ENGAGEMENT } }] },
    { OR: [{ brandName: null as string | null }, { brandName: { notIn: FLOOR9_BRAND } }] },
  ],
};

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

/** Derive tier: monthlyRetainer-first, financeNotes fallback, then "Custom" */
function deriveTier(
  monthlyRetainer: number | null,
  financeNotes: string | null
): 'Platinum' | 'Gold' | 'Custom' | null {
  if (monthlyRetainer === 2000) return 'Gold';
  if (monthlyRetainer === 2500) return 'Platinum';
  const fn = (financeNotes ?? '').toLowerCase();
  if (fn.includes('platinum')) return 'Platinum';
  if (fn.includes('gold')) return 'Gold';
  if (monthlyRetainer !== null && monthlyRetainer > 0) return 'Custom';
  return null;
}

/**
 * Ghost-record dedup (matches active-clients-billing logic):
 * Suppress unmatched clients whose actualLaunchDate matches a matched sibling —
 * sign of billing-audit duplicating a record from a Deal ID instead of the Org ID.
 */
function dedupeGhosts<T extends {
  id: string;
  chargeoverCustomerId: string | null;
  actualLaunchDate: Date | null;
}>(clients: T[]): T[] {
  const matchedLaunchDates = new Set<number>();
  for (const c of clients) {
    if (c.chargeoverCustomerId && c.actualLaunchDate) {
      matchedLaunchDates.add(new Date(c.actualLaunchDate).getTime());
    }
  }
  return clients.filter((c) => {
    if (!c.chargeoverCustomerId && c.actualLaunchDate) {
      return !matchedLaunchDates.has(new Date(c.actualLaunchDate).getTime());
    }
    return true;
  });
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
  monthlyRetainer: unknown; // Prisma Decimal — use Number() to convert
  engagementType: string | null;
  dealType: string | null;
  brandName: string | null;
  actualLaunchDate: Date | null;
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
  paidUpfront: boolean; // financeNotes contains "paid upfront" OR monthlyRetainer > 3000
  // Pilot
  pilotRolloverEndDate: Date | null;
  isInPilot: boolean;
  isPastPilot: boolean;
  // Subscription (ChargeOver data — used for last/next payment display only)
  activeSubscriptionCount: number;
  // Monthly amount: Client.monthlyRetainer is source of truth
  monthlyRetainer: number | null;
  // Tier: monthlyRetainer-first, financeNotes fallback, then 'Custom'
  tier: 'Platinum' | 'Gold' | 'Custom' | null;
  // Payments (ChargeOver data)
  lastPaymentDate: Date | null;
  lastPaymentAmount: number | null;
  lastPaymentPending: boolean;
  nextPaymentDate: Date | null;
  nextPaymentAmount: number | null;
  lifetimeTotalPaid: number;
};

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
  const sortedSubs = [...activeSubs].sort((a, b) => subAmount(b) - subAmount(a));
  const largestSub = sortedSubs[0] ?? null;

  // Payments
  const paidPayments = c.payments.filter((p) => PAID_STATUSES.includes((p.status ?? '').toLowerCase()));
  const lifetimeTotalPaid = paidPayments.reduce((sum, p) => sum + Number(p.amount ?? 0), 0);

  // Last non-failed payment (captured or pending) — for display
  const nonFailedPayments = c.payments.filter((p) => !FAILED_STATUSES.includes((p.status ?? '').toLowerCase()));
  const lastAny = nonFailedPayments[0] ?? null;
  const lastPaymentPending = lastAny
    ? !PAID_STATUSES.includes((lastAny.status ?? '').toLowerCase())
    : false;

  // Next payment from largest active sub lineItems
  let nextPaymentDate: Date | null = null;
  let nextPaymentAmount: number | null = null;
  if (largestSub) {
    const nd = getNextBillDate(largestSub);
    if (nd) {
      nextPaymentDate = nd;
      nextPaymentAmount = subAmount(largestSub);
    }
  }

  // Pilot
  const pilotEnd = c.pilotRolloverEndDate ? new Date(c.pilotRolloverEndDate) : null;
  const isInPilot = !!(pilotEnd && pilotEnd > now);
  const isPastPilot = !!(pilotEnd && pilotEnd <= now);

  // monthlyRetainer — source of truth for monthly amount
  const monthlyRetainer = c.monthlyRetainer != null ? Number(c.monthlyRetainer) : null;

  // Paid upfront: financeNotes substring OR monthlyRetainer > 3000
  const fn = (c.financeNotes ?? '').toLowerCase();
  const paidUpfront = fn.includes('paid upfront') || (monthlyRetainer !== null && monthlyRetainer > 3000);

  // Tier: monthlyRetainer-first
  const tier = deriveTier(monthlyRetainer, c.financeNotes);

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
    monthlyRetainer,
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
// Shared DB select (all fields needed for display + filtering)
// ---------------------------------------------------------------------------
const CLIENT_SELECT = {
  id: true,
  pipedriveOrgId: true,
  organizationName: true,
  accountStatus: true,
  chargeoverCustomerId: true,
  financeNotes: true,
  monthlyRetainer: true,
  engagementType: true,
  dealType: true,
  brandName: true,
  actualLaunchDate: true,
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
// Tab 1: Pilots ending in next 10 days
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
      ...FLOOR9_WHERE,
    },
    select: CLIENT_SELECT,
    orderBy: { pilotRolloverEndDate: 'asc' },
  }) as unknown as ClientRaw[];

  return dedupeGhosts(clients).map(buildRow);
}

// ---------------------------------------------------------------------------
// Tab 2: Active by price (monthlyRetainer ≤ 3000, excludes paid-upfront)
// ---------------------------------------------------------------------------
export async function getActiveByPriceRows(): Promise<ClientRow[]> {
  const clients = await prisma.client.findMany({
    where: {
      accountStatus: { in: ['Live', 'Pre-Launch'] },
      ...FLOOR9_WHERE,
    },
    select: CLIENT_SELECT,
    orderBy: { organizationName: 'asc' },
  }) as unknown as ClientRaw[];

  return dedupeGhosts(clients)
    .map(buildRow)
    .filter((r) => !r.paidUpfront && r.monthlyRetainer !== null && r.monthlyRetainer > 0)
    .sort((a, b) => (b.monthlyRetainer ?? 0) - (a.monthlyRetainer ?? 0));
}

// ---------------------------------------------------------------------------
// Tab 3: Live clients (pilot status)
// ---------------------------------------------------------------------------
export async function getLivePilotRows(): Promise<ClientRow[]> {
  const clients = await prisma.client.findMany({
    where: {
      accountStatus: 'Live',
      ...FLOOR9_WHERE,
    },
    select: CLIENT_SELECT,
    orderBy: { organizationName: 'asc' },
  }) as unknown as ClientRaw[];

  return dedupeGhosts(clients).map(buildRow);
}

// ---------------------------------------------------------------------------
// Stats — master KPI section
// ---------------------------------------------------------------------------
export type Stats = {
  // Row 1: pilot counts
  totalClients: number;
  pilotsEndingNext10Days: number;
  pilotsEndingThisMonth: number;
  pilotsEndingNextMonth: number;
  pilotsEndingMonthAfterNext: number;
  thisMonthName: string;
  nextMonthName: string;
  monthAfterNextName: string;
  // Row 2: revenue
  postPilotRevenueThisMonth: number; // sum of monthlyRetainer for live post-pilot clients
  revenueMtd: number;                // ok-successful payments in current month
  revenueForecast: number;           // MTD + nextBillDates remaining this month
  revenueForecastNextMonth: number;  // nextBillDates falling in next calendar month
  revenuePriorMonth: number;         // ok-successful payments in prior month (ALL clients)
};

export async function getStats(): Promise<Stats> {
  const now = new Date();
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

  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const tenDaysEnd = new Date(todayStart);
  tenDaysEnd.setDate(tenDaysEnd.getDate() + 10);
  tenDaysEnd.setHours(23, 59, 59, 999);

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Fetch all live/pre-launch clients (Floor 9 filtered + deduped) for pilot counts
  const rawClients = await prisma.client.findMany({
    where: {
      accountStatus: { in: ['Live', 'Pre-Launch'] },
      ...FLOOR9_WHERE,
    },
    select: {
      accountStatus: true,
      pilotRolloverEndDate: true,
      financeNotes: true,
      monthlyRetainer: true,
      chargeoverCustomerId: true,
      actualLaunchDate: true,
      subscriptions: { select: { status: true, amount: true, lineItems: true } },
    },
  }) as unknown as Array<{
    accountStatus: string;
    pilotRolloverEndDate: Date | null;
    financeNotes: string | null;
    monthlyRetainer: unknown;
    chargeoverCustomerId: string | null;
    actualLaunchDate: Date | null;
    subscriptions: SubRaw[];
  }>;

  const clients = dedupeGhosts(rawClients.map((c) => ({ ...c, id: '', engagementType: null, dealType: null, brandName: null })));

  // Prior month revenue: ALL payments regardless of client status (catches any client in DB)
  const [priorMonthAgg, mtdAgg] = await Promise.all([
    prisma.payment.aggregate({
      where: {
        status: { in: PAID_STATUSES },
        paidDate: { gte: lastMonthStart, lte: lastMonthEnd },
      },
      _sum: { amount: true },
    }),
    prisma.payment.aggregate({
      where: {
        status: { in: PAID_STATUSES },
        paidDate: { gte: thisMonthStart, lte: now },
      },
      _sum: { amount: true },
    }),
  ]);

  let totalClients = 0;
  let pilotsEndingNext10Days = 0;
  let pilotsEndingThisMonth = 0;
  let pilotsEndingNextMonth = 0;
  let pilotsEndingMonthAfterNext = 0;
  let postPilotRevenueThisMonth = 0;
  let revenueFuture = 0;
  let revenueForecastNextMonth = 0;

  for (const c of clients) {
    totalClients++;

    if (c.pilotRolloverEndDate) {
      const pd = new Date(c.pilotRolloverEndDate);
      if (pd >= todayStart && pd <= tenDaysEnd) pilotsEndingNext10Days++;
      if (pd >= thisMonthStart && pd <= thisMonthEnd) pilotsEndingThisMonth++;
      else if (pd >= nextMonthStart && pd <= nextMonthEnd) pilotsEndingNextMonth++;
      else if (pd >= m2Start && pd <= m2End) pilotsEndingMonthAfterNext++;
    }

    // Post-pilot MRR (monthlyRetainer × active post-pilot live clients)
    const retainer = c.monthlyRetainer != null ? Number(c.monthlyRetainer) : null;
    const fn = (c.financeNotes ?? '').toLowerCase();
    const isPaidUpfront = fn.includes('paid upfront') || (retainer !== null && retainer > 3000);
    const pilotEnd = c.pilotRolloverEndDate ? new Date(c.pilotRolloverEndDate) : null;
    if (
      c.accountStatus === 'Live' &&
      pilotEnd && pilotEnd <= now &&
      !isPaidUpfront &&
      retainer !== null
    ) {
      postPilotRevenueThisMonth += retainer;
    }

    // Future payment forecasts from ChargeOver nextBillDates
    const activeSubs = (c.subscriptions as SubRaw[]).filter((s) => isActive(s.status));
    const largestSub = [...activeSubs].sort((a, b) => subAmount(b) - subAmount(a))[0] ?? null;
    if (largestSub) {
      const nextBill = getNextBillDate(largestSub);
      if (nextBill) {
        if (nextBill >= tomorrow && nextBill <= thisMonthEnd) {
          revenueFuture += subAmount(largestSub);
        }
        if (nextBill >= nextMonthStart && nextBill <= nextMonthEnd) {
          revenueForecastNextMonth += subAmount(largestSub);
        }
      }
    }
  }

  const revenueMtd = Number(mtdAgg._sum.amount ?? 0);
  const revenuePriorMonth = Number(priorMonthAgg._sum.amount ?? 0);

  return {
    totalClients,
    pilotsEndingNext10Days,
    pilotsEndingThisMonth,
    pilotsEndingNextMonth,
    pilotsEndingMonthAfterNext,
    thisMonthName: MONTH_NAMES[m],
    nextMonthName: MONTH_NAMES[(m + 1) % 12],
    monthAfterNextName: MONTH_NAMES[(m + 2) % 12],
    postPilotRevenueThisMonth,
    revenueMtd,
    revenueForecast: revenueMtd + revenueFuture,
    revenueForecastNextMonth,
    revenuePriorMonth,
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
