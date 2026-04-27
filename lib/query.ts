import { prisma } from './prisma';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const ACTIVE_STATUSES = ['active', 'current', 'trialing', 'in_trial', 'live', 'a'];
const PAID_STATUSES = ['paid', 'successful', 'succeeded', 'completed', 'captured', 'settled', 'ok-successful'];
const FAILED_STATUSES = ['no-declined', 'fail', 'failed', 'declined', 'refunded', 'error'];

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

/**
 * Computes the next scheduled invoice total for a subscription.
 *
 * ChargeOver stores per-line-item bill dates inside the lineItems JSON array.
 * Each element has: nextBillDate (or next_bill_date), unitPrice (or unit_price),
 * quantity (or qty).
 *
 * Strategy:
 *   1. Find the soonest FUTURE nextBillDate across all line items.
 *   2. Sum unitPrice × quantity for every line item sharing that exact date.
 *
 * Date-only (YYYY-MM-DD) comparison is used to avoid UTC-midnight TZ edge-cases.
 *
 * Returns null when no future date exists — subscription paused, expired, or
 * paid upfront with no recurring invoice scheduled.
 */
function nextInvoiceTotal(
  sub: { lineItems: unknown },
  now: Date
): { date: Date; amount: number } | null {
  type LineItem = {
    nextBillDate?: string;
    next_bill_date?: string;
    unitPrice?: number;
    unit_price?: number;
    quantity?: number;
    qty?: number;
  };

  const liArr = sub.lineItems as LineItem[] | null;
  if (!Array.isArray(liArr) || liArr.length === 0) return null;

  // Step 1: find the soonest future bill date
  let soonest: Date | null = null;
  for (const item of liArr) {
    const raw = item?.nextBillDate ?? item?.next_bill_date;
    if (!raw) continue;
    const d = new Date(raw);
    if (d > now && (!soonest || d < soonest)) soonest = d;
  }
  if (!soonest) return null;

  const soonestDay = soonest.toISOString().slice(0, 10);

  // Step 2: sum all line items on that date
  let total = 0;
  for (const item of liArr) {
    const raw = item?.nextBillDate ?? item?.next_bill_date;
    if (!raw) continue;
    if (new Date(raw).toISOString().slice(0, 10) !== soonestDay) continue;
    const price = item.unitPrice ?? item.unit_price ?? 0;
    const qty = item.quantity ?? item.qty ?? 1;
    total += price * qty;
  }

  return total > 0 ? { date: soonest, amount: total } : null;
}

function isActive(status: string | null): boolean {
  return ACTIVE_STATUSES.includes((status ?? '').toLowerCase());
}

/** Tier from financeNotes only — no retainer-amount matching */
function deriveTier(financeNotes: string | null): 'Platinum' | 'Gold' | null {
  const fn = (financeNotes ?? '').toLowerCase();
  if (fn.includes('platinum')) return 'Platinum';
  if (fn.includes('gold')) return 'Gold';
  return null;
}

/**
 * Ghost-record dedup: suppress unmatched clients whose actualLaunchDate
 * matches a matched sibling — billing-audit duplicates a record from a
 * Deal ID instead of the Org ID.
 */
function dedupeGhosts<T extends {
  id: string;
  chargeoverCustomerId: string | null;
  actualLaunchDate: Date | null;
}>(clients: T[]): T[] {
  const matchedLaunchDates = new Set<number>();
  for (const c of clients) {
    if (c.chargeoverCustomerId && c.actualLaunchDate)
      matchedLaunchDates.add(new Date(c.actualLaunchDate).getTime());
  }
  return clients.filter((c) => {
    if (!c.chargeoverCustomerId && c.actualLaunchDate)
      return !matchedLaunchDates.has(new Date(c.actualLaunchDate).getTime());
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
  // financeNotes substring "paid upfront" — used to exclude from Tab 2 and badge on Tab 1
  paidUpfront: boolean;
  // Pilot
  pilotRolloverEndDate: Date | null;
  isInPilot: boolean;
  isPastPilot: boolean;
  // Subscription counts
  activeSubscriptionCount: number;
  // Tier: financeNotes-based only (null = genuinely unlabeled)
  tier: 'Platinum' | 'Gold' | null;
  // Payments (ChargeOver data)
  lastPaymentDate: Date | null;
  lastPaymentAmount: number | null;
  lastPaymentPending: boolean;
  // Next scheduled invoice — this is also the "Monthly amount" shown in all UI columns.
  // Null when no future nextBillDate exists (paused, expired, or paid-upfront subscription).
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

  // Largest active subscription = highest nextInvoiceTotal (fall back to amount field)
  const sortedSubs = [...activeSubs].sort((a, b) => {
    const aAmt = nextInvoiceTotal(a, now)?.amount ?? Number(a.amount ?? 0);
    const bAmt = nextInvoiceTotal(b, now)?.amount ?? Number(b.amount ?? 0);
    return bAmt - aAmt;
  });
  const largestSub = sortedSubs[0] ?? null;

  // Payments
  const paidPayments = c.payments.filter((p) =>
    PAID_STATUSES.includes((p.status ?? '').toLowerCase())
  );
  const lifetimeTotalPaid = paidPayments.reduce(
    (sum, p) => sum + Number(p.amount ?? 0),
    0
  );

  const nonFailedPayments = c.payments.filter((p) =>
    !FAILED_STATUSES.includes((p.status ?? '').toLowerCase())
  );
  const lastAny = nonFailedPayments[0] ?? null;
  const lastPaymentPending = lastAny
    ? !PAID_STATUSES.includes((lastAny.status ?? '').toLowerCase())
    : false;

  // Next scheduled invoice from largest active sub
  const invoice = largestSub ? nextInvoiceTotal(largestSub, now) : null;
  const nextPaymentDate = invoice?.date ?? null;
  const nextPaymentAmount = invoice?.amount ?? null;

  const pilotEnd = c.pilotRolloverEndDate ? new Date(c.pilotRolloverEndDate) : null;
  const isInPilot = !!(pilotEnd && pilotEnd > now);
  const isPastPilot = !!(pilotEnd && pilotEnd <= now);

  const paidUpfront = (c.financeNotes ?? '').toLowerCase().includes('paid upfront');
  const tier = deriveTier(c.financeNotes);

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
// Shared DB select
// ---------------------------------------------------------------------------
const CLIENT_SELECT = {
  id: true,
  pipedriveOrgId: true,
  organizationName: true,
  accountStatus: true,
  chargeoverCustomerId: true,
  financeNotes: true,
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

  const clients = (await prisma.client.findMany({
    where: {
      accountStatus: { in: ['Live', 'Pre-Launch'] },
      pilotRolloverEndDate: { gte: todayStart, lte: tenDaysEnd },
      ...FLOOR9_WHERE,
    },
    select: CLIENT_SELECT,
    orderBy: { pilotRolloverEndDate: 'asc' },
  })) as unknown as ClientRaw[];

  return dedupeGhosts(clients).map(buildRow);
}

// ---------------------------------------------------------------------------
// Tab 2: Active by price — recurring clients only (paidUpfront + null amount excluded)
// ---------------------------------------------------------------------------
export async function getActiveByPriceRows(): Promise<ClientRow[]> {
  const clients = (await prisma.client.findMany({
    where: {
      accountStatus: { in: ['Live', 'Pre-Launch'] },
      ...FLOOR9_WHERE,
    },
    select: CLIENT_SELECT,
    orderBy: { organizationName: 'asc' },
  })) as unknown as ClientRaw[];

  return dedupeGhosts(clients)
    .map(buildRow)
    .filter((r) => !r.paidUpfront && r.nextPaymentAmount !== null && r.nextPaymentAmount > 0)
    .sort((a, b) => (b.nextPaymentAmount ?? 0) - (a.nextPaymentAmount ?? 0));
}

// ---------------------------------------------------------------------------
// Tab 3: Live clients (pilot status)
// ---------------------------------------------------------------------------
export async function getLivePilotRows(): Promise<ClientRow[]> {
  const clients = (await prisma.client.findMany({
    where: {
      accountStatus: 'Live',
      ...FLOOR9_WHERE,
    },
    select: CLIENT_SELECT,
    orderBy: { organizationName: 'asc' },
  })) as unknown as ClientRaw[];

  return dedupeGhosts(clients).map(buildRow);
}

// ---------------------------------------------------------------------------
// Stats — master KPI section
// ---------------------------------------------------------------------------
export type Stats = {
  // Row 1: pilot counts (4 cards)
  totalClients: number;
  pilotsEndingNext10Days: number;
  pilotsEndingThisMonth: number;
  pilotsEndingNextMonth: number;
  pilotsEndingMonthAfterNext: number;
  thisMonthName: string;
  nextMonthName: string;
  monthAfterNextName: string;
  // Row 2: revenue (3 cards)
  postPilotMrr: number;                // sum of next-invoice-total for live post-pilot clients
  postPilotCollectedThisMonth: number; // ok-successful payments MTD from post-pilot clients
  postPilotForecastNextMonth: number;  // sum of next-invoice-total for post-pilot + ending-pilot-this-month
};

export async function getStats(): Promise<Stats> {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();

  const thisMonthStart = new Date(y, m, 1);
  const thisMonthEnd   = new Date(y, m + 1, 0, 23, 59, 59, 999);
  const nextMonthStart = new Date(y, m + 1, 1);
  const nextMonthEnd   = new Date(y, m + 2, 0, 23, 59, 59, 999);
  const m2Start        = new Date(y, m + 2, 1);
  const m2End          = new Date(y, m + 3, 0, 23, 59, 59, 999);
  const todayStart     = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const tenDaysEnd     = new Date(todayStart);
  tenDaysEnd.setDate(tenDaysEnd.getDate() + 10);
  tenDaysEnd.setHours(23, 59, 59, 999);

  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const rawClients = (await prisma.client.findMany({
    where: {
      accountStatus: { in: ['Live', 'Pre-Launch'] },
      ...FLOOR9_WHERE,
    },
    select: {
      accountStatus: true,
      pilotRolloverEndDate: true,
      financeNotes: true,
      chargeoverCustomerId: true,
      actualLaunchDate: true,
      subscriptions: { select: { status: true, amount: true, lineItems: true } },
      // Only load payments that fall in the current month — used for postPilotCollectedThisMonth
      payments: {
        where: {
          status: { in: PAID_STATUSES },
          paidDate: { gte: thisMonthStart, lte: now },
        },
        select: { amount: true },
      },
    },
  })) as unknown as Array<{
    accountStatus: string;
    pilotRolloverEndDate: Date | null;
    financeNotes: string | null;
    chargeoverCustomerId: string | null;
    actualLaunchDate: Date | null;
    subscriptions: SubRaw[];
    payments: { amount: unknown }[];
  }>;

  const clients = dedupeGhosts(
    rawClients.map((c) => ({
      ...c,
      id: '',
      engagementType: null,
      dealType: null,
      brandName: null,
    }))
  );

  let totalClients = 0;
  let pilotsEndingNext10Days = 0;
  let pilotsEndingThisMonth = 0;
  let pilotsEndingNextMonth = 0;
  let pilotsEndingMonthAfterNext = 0;
  let postPilotMrr = 0;
  let postPilotCollectedThisMonth = 0;
  let postPilotForecastNextMonth = 0;

  for (const c of clients) {
    totalClients++;

    if (c.pilotRolloverEndDate) {
      const pd = new Date(c.pilotRolloverEndDate);
      if (pd >= todayStart && pd <= tenDaysEnd) pilotsEndingNext10Days++;
      if (pd >= thisMonthStart && pd <= thisMonthEnd) pilotsEndingThisMonth++;
      else if (pd >= nextMonthStart && pd <= nextMonthEnd) pilotsEndingNextMonth++;
      else if (pd >= m2Start && pd <= m2End) pilotsEndingMonthAfterNext++;
    }

    const paidUpfront = (c.financeNotes ?? '').toLowerCase().includes('paid upfront');
    const pilotEnd = c.pilotRolloverEndDate ? new Date(c.pilotRolloverEndDate) : null;
    const isPastPilot = !!(pilotEnd && pilotEnd <= now);
    const pilotEndsThisMonth = !!(
      pilotEnd && pilotEnd >= thisMonthStart && pilotEnd <= thisMonthEnd
    );

    // Next invoice from largest active subscription
    const activeSubs = c.subscriptions.filter((s) => isActive(s.status));
    const largestSub = [...activeSubs].sort((a, b) => {
      const aAmt = nextInvoiceTotal(a, now)?.amount ?? Number(a.amount ?? 0);
      const bAmt = nextInvoiceTotal(b, now)?.amount ?? Number(b.amount ?? 0);
      return bAmt - aAmt;
    })[0] ?? null;
    const invoice = largestSub ? nextInvoiceTotal(largestSub, now) : null;

    // Post-pilot MRR: live, past pilot, not paid-upfront, has a future invoice
    if (c.accountStatus === 'Live' && isPastPilot && !paidUpfront && invoice) {
      postPilotMrr += invoice.amount;
    }

    // Collected this month: all ok-successful MTD payments from post-pilot clients
    if (isPastPilot) {
      postPilotCollectedThisMonth += c.payments.reduce(
        (sum, p) => sum + Number(p.amount ?? 0),
        0
      );
    }

    // Forecast next month: post-pilot OR ending pilot this month, live, not paid-upfront, has future invoice
    if (c.accountStatus === 'Live' && (isPastPilot || pilotEndsThisMonth) && !paidUpfront && invoice) {
      postPilotForecastNextMonth += invoice.amount;
    }
  }

  return {
    totalClients,
    pilotsEndingNext10Days,
    pilotsEndingThisMonth,
    pilotsEndingNextMonth,
    pilotsEndingMonthAfterNext,
    thisMonthName: MONTH_NAMES[m],
    nextMonthName: MONTH_NAMES[(m + 1) % 12],
    monthAfterNextName: MONTH_NAMES[(m + 2) % 12],
    postPilotMrr,
    postPilotCollectedThisMonth,
    postPilotForecastNextMonth,
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
