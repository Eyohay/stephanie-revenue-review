import { prisma } from './prisma';

// ---------------------------------------------------------------------------
// Constants — exported so joinPipedriveWithNeon.ts can reuse them
// ---------------------------------------------------------------------------
export const ACTIVE_STATUSES = ['active', 'current', 'trialing', 'in_trial', 'live', 'a'];
export const PAID_STATUSES = ['paid', 'successful', 'succeeded', 'completed', 'captured', 'settled', 'ok-successful'];
export const FAILED_STATUSES = ['no-declined', 'fail', 'failed', 'declined', 'refunded', 'error'];

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
 * Canonical next-scheduled-payment function.
 *
 * Combines all three historical fixes into one function — no parallel implementations:
 *
 *   Round 14: Iterates ALL active subs (not just the largest) so that paid-upfront
 *             clients with a companion recurring sub get a next-payment date + amount.
 *
 *   Round 7:  AMOUNT comes from sub.amount (ChargeOver's pre-computed recurring field),
 *             NOT from summing lineItems. ChargeOver excludes discount line items,
 *             one-off service charges (e.g. sherwoodforestinc's $350 Profile Overhaul),
 *             and multi-month upfront blocks from sub.amount. A lineItem sum always
 *             inflates: discount items carry a positive unitPrice that adds to the sum
 *             instead of subtracting (e.g. Momentum Media Group: $2,500 + $75 + $1,200
 *             discount = $3,775 instead of the correct $2,575).
 *
 *   Round 5:  Date anchored to noon UTC to avoid Eastern-timezone off-by-one.
 *             ChargeOver stores dates as "YYYY-MM-DD HH:MM:SS" without TZ suffix.
 *
 * DATE strategy (layered fallback within each sub, same as historic logic):
 *   Strategy 1 — qty=1, non-discount items (handles standard recurring line items)
 *   Strategy 2 — any service item (relaxes qty restriction)
 *   Strategy 3 — any item at all (last resort for unusual sub structures)
 *
 * AMOUNT strategy (for the winning sub):
 *   Primary  — sub.amount when > 0 (authoritative; excludes all noise)
 *   Fallback — filtered lineItem sum when sub.amount = 0 (paid-upfront companion subs
 *              where ChargeOver zeroes the sub-level amount but line items carry prices).
 *              Filter: qty=1, type !== "discount" items only.
 *
 * Returns null if no active sub has any future nextBillDate, or if no amount can be
 * derived (amount = 0 after all strategies).
 */
export function nextScheduledPayment(
  activeSubs: SubRaw[],
  now: Date,
): { date: Date; amount: number } | null {
  type Li = {
    nextBillDate?: string;
    next_bill_date?: string;
    unitPrice?: number;
    quantity?: number;
    qty?: number;
    type?: string;
  };

  const todayUTC = now.toISOString().slice(0, 10);
  const toDay = (raw: string) => String(raw).split(/[\sT]/)[0];
  const isFuture = (d: string) => d > todayUTC;

  let bestDay: string | null = null;
  let bestSub: SubRaw | null = null;

  for (const sub of activeSubs) {
    // Stripe: lineItems is a single object with currentPeriodEnd (Unix seconds — * 1000 for JS Date)
    if (sub.billingProcessor === 'STRIPE') {
      const li = sub.lineItems as { currentPeriodEnd?: number; cancelAtPeriodEnd?: boolean } | null;
      if (!li || li.cancelAtPeriodEnd) continue;
      const ts = li.currentPeriodEnd;
      if (!ts) continue;
      const day = new Date(ts * 1000).toISOString().slice(0, 10);
      if (!isFuture(day)) continue;
      if (!bestDay || day < bestDay) { bestDay = day; bestSub = sub; }
      continue;
    }

    // ChargeOver: lineItems is an array with nextBillDate per item
    const liArr = sub.lineItems as Li[] | null;
    if (!Array.isArray(liArr) || liArr.length === 0) continue;

    // Find soonest FUTURE nextBillDate on this sub using layered strategies
    let candidateDay: string | null = null;

    // Strategy 1: qty=1 non-discount items (strictest — covers standard recurring items)
    for (const item of liArr) {
      if (item?.type === 'discount') continue;
      const qty = item?.quantity ?? item?.qty ?? 1;
      if (qty !== 1) continue;
      const raw = item?.nextBillDate ?? item?.next_bill_date;
      if (!raw) continue;
      const day = toDay(String(raw));
      if (isFuture(day) && (!candidateDay || day < candidateDay)) candidateDay = day;
    }

    // Strategy 2: any service item (relaxes qty restriction)
    if (!candidateDay) {
      for (const item of liArr) {
        if (item?.type !== 'service') continue;
        const raw = item?.nextBillDate ?? item?.next_bill_date;
        if (!raw) continue;
        const day = toDay(String(raw));
        if (isFuture(day) && (!candidateDay || day < candidateDay)) candidateDay = day;
      }
    }

    // Strategy 3: any item (broadest fallback)
    if (!candidateDay) {
      for (const item of liArr) {
        const raw = item?.nextBillDate ?? item?.next_bill_date;
        if (!raw) continue;
        const day = toDay(String(raw));
        if (isFuture(day) && (!candidateDay || day < candidateDay)) candidateDay = day;
      }
    }

    if (!candidateDay) continue;
    if (!bestDay || candidateDay < bestDay) {
      bestDay = candidateDay;
      bestSub = sub;
    }
  }

  if (!bestDay || !bestSub) return null;

  // Amount derivation — three cases handled:
  //
  //   Case 1 (monthly billing): sub.amount == serviceSum (qty=1, non-discount items).
  //     Either value is correct; min() picks either.
  //
  //   Case 2 (bimonthly / quarterly billing): sub.amount = serviceSum × N (N=2,3,…).
  //     ChargeOver stores the per-invoice total, not the monthly rate. serviceSum gives
  //     the per-month rate. min() picks serviceSum.
  //     Observed: hrpmediagroup, radiansys ($4,120 vs $2,060), bertonlaw ($2,060 vs $1,030).
  //
  //   Case 3 (stray one-off service items — round 7): serviceSum > sub.amount because
  //     non-recurring service items (e.g. sherwoodforest's $350 Profile Overhaul) inflate
  //     the lineItem sum. sub.amount correctly excludes them. min() picks sub.amount.
  //
  //   Case 4 (sub.amount = 0 — paid-upfront companion subs): fall back to filtered
  //     lineItem sum as before.
  //
  // serviceSum = sum of unitPrice for qty=1, non-discount lineItems.
  const subAmt = Number(bestSub.amount ?? 0);
  let amount: number;

  if (subAmt > 0) {
    const liArrForAmt = bestSub.lineItems as Li[] | null;
    const serviceSum = Array.isArray(liArrForAmt)
      ? liArrForAmt
          .filter(li => li?.type !== 'discount' && (li?.quantity ?? li?.qty ?? 1) === 1)
          .reduce((s, li) => s + Number(li?.unitPrice ?? 0), 0)
      : 0;
    // Use min(sub.amount, serviceSum) when serviceSum is meaningful.
    // When serviceSum = 0 (e.g. no qty=1 non-discount items), sub.amount is the only signal.
    amount = serviceSum > 0 ? Math.min(subAmt, serviceSum) : subAmt;
  } else {
    const liArr = bestSub.lineItems as Li[] | null;
    if (Array.isArray(liArr)) {
      // Filtered sum: qty=1, non-discount items only — same filter as Strategy 1
      amount = liArr
        .filter(li => li?.type !== 'discount' && (li?.quantity ?? li?.qty ?? 1) === 1)
        .reduce((s, li) => s + Number(li?.unitPrice ?? 0), 0);
      // Broader fallback: any non-discount item if qty=1 filter yields nothing
      if (amount === 0) {
        amount = liArr
          .filter(li => li?.type !== 'discount')
          .reduce((s, li) =>
            s + Number(li?.unitPrice ?? 0) * Number(li?.quantity ?? li?.qty ?? 1), 0);
      }
    } else {
      amount = 0;
    }
  }

  if (amount <= 0) return null;

  // Anchor to noon UTC — avoids Eastern-timezone off-by-one (round 5 fix)
  return { date: new Date(bestDay + 'T12:00:00.000Z'), amount };
}

/**
 * @deprecated Use nextScheduledPayment(activeSubs, now) instead.
 * Kept only to avoid breaking any external callers during transition.
 * Will be removed in round 17.
 */
export function nextInvoiceTotal(
  sub: { amount: unknown; lineItems: unknown },
  now: Date
): { date: Date | null; amount: number } | null {
  const result = nextScheduledPayment([sub as SubRaw], now);
  if (!result) return null;
  return { date: result.date, amount: result.amount };
}

export function isActive(status: string | null): boolean {
  return ACTIVE_STATUSES.includes((status ?? '').toLowerCase());
}

/**
 * Returns true if financeNotes contains a paid-upfront keyword (case-insensitive).
 *
 * These clients pay for a block of months in a single invoice rather than
 * month-to-month. They are excluded from Tab 2 (recurring-by-price) and shown
 * with a "Paid upfront" badge on Tabs 1 and 3.
 *
 * Add new substrings here when new financeNotes patterns appear in PipeDrive.
 * Currently only "Paid Upfront" is observed; the rest are future-proofing.
 */
export function isPaidUpfront(financeNotes: string | null): boolean {
  const fn = (financeNotes ?? '').toLowerCase();
  return [
    'paid upfront',
    'paid up front',
    'paid up-front',
    'upfront',
    'annual prepay',
    'prepay',
    'prepaid',
    'annual',
    'lump sum',
  ].some((kw) => fn.includes(kw));
}

/**
 * Returns true when a client has paid at least once after their pilot end date.
 * Requires: pilot has ended, and at least one ok-successful payment dated after pilot end.
 */
export function isRolledOver(
  pilotRolloverEndDate: Date | null,
  payments: PayRaw[],
  now: Date,
): boolean {
  if (!pilotRolloverEndDate) return false;
  if (pilotRolloverEndDate >= now) return false;
  return payments.some(
    p => p.statusNormalized === 'SUCCESS' && p.paidDate !== null && p.paidDate > pilotRolloverEndDate
  );
}

/**
 * Structural backstop for paid-upfront detection.
 *
 * The primary paid-upfront signal after round 7 is sub.amount === 0 → nextInvoiceTotal
 * returns null → client is naturally excluded from Tab 2 and shown with the "Paid
 * upfront" pill on Tabs 1 and 3.
 *
 * This function is a safety net for the rare edge case where a subscription has
 * multi-month qty>1 service line items AND still has sub.amount > 0 (not observed in
 * production data as of round 7, but structurally possible).
 *
 * The round 6 ratio heuristic (3x threshold) is removed here because after fix 1 the
 * ratio compares sub.amount to last-payment, and monthly clients on a promotional
 * first-month credit legitimately have a high ratio — they are NOT paid upfront.
 *
 * Only called when isPaidUpfront() returned false.
 */
export function isLikelyPaidUpfront(subs: SubRaw[]): boolean {
  for (const sub of subs) {
    if (sub.billingProcessor === 'STRIPE') {
      // Stripe: upfrontPending flag in lineItems object signals a pending upfront balance charge.
      // upfrontBillingDate is a durable signal — it stays populated after the charge fires (when
      // upfrontPending flips to false), so it catches Upfront clients in any charge state.
      const li = sub.lineItems as { upfrontPending?: boolean; upfrontBillingDate?: string | null } | null;
      if (li?.upfrontPending === true) return true;
      if (li?.upfrontBillingDate != null) return true;
    } else {
      // ChargeOver: sub.amount = 0 means no recurring schedule → upfront payment
      if (Number(sub.amount ?? 0) === 0) return true;
      // ChargeOver: qty>1 service items = multi-month block
      const liArr = (sub.lineItems as Array<{ type?: string; quantity?: number; qty?: number }> | null) ?? [];
      if (Array.isArray(liArr) && liArr.some((li) => li?.type === 'service' && (li?.quantity ?? li?.qty ?? 1) > 1)) return true;
    }
  }
  return false;
}

/**
 * @deprecated Use nextScheduledPayment(activeSubs, now) instead.
 * This alias exists only to avoid compile errors in any file still importing
 * this name. Will be removed in round 17.
 */
export const nextScheduledForAllSubs = nextScheduledPayment;

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
// Shared types — exported for reuse in joinPipedriveWithNeon.ts
// ---------------------------------------------------------------------------
export type SubRaw = {
  status: string | null;
  amount: unknown;
  lineItems: unknown;
  billingProcessor: string;
};

export type PayRaw = {
  amount: unknown;
  paidDate: Date | null;
  status: string;
  statusNormalized: string;
};

type ClientRaw = {
  id: string;
  pipedriveOrgId: number;
  organizationName: string;
  accountStatus: string;
  chargeoverCustomerId: string | null;
  billingProcessor: string | null;
  stripeCustomerId: string | null;
  financeNotes: string | null;
  engagementType: string | null;
  dealType: string | null;
  brandName: string | null;
  actualLaunchDate: Date | null;
  kickoffCall: Date | null;
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
  isStripe: boolean;
  // isPaidUpfront() substring match — authoritative (purple badge)
  paidUpfront: boolean;
  // isLikelyPaidUpfront() ratio heuristic — backstop (amber dotted badge)
  likelyPaidUpfront: boolean;
  // Pilot
  pilotRolloverEndDate: Date | null;
  isInPilot: boolean;
  isPastPilot: boolean;
  // Subscription counts
  activeSubscriptionCount: number;
  // Kick-Off Call date from Pipedrive (synced by billing-audit)
  kickoffCall: Date | null;
  // Tier: financeNotes-based only (null = genuinely unlabeled)
  tier: 'Platinum' | 'Gold' | null;
  // Payments (ChargeOver data)
  lastPaymentDate: Date | null;
  lastPaymentAmount: number | null;
  lastPaymentPending: boolean;
  // Monthly recurring amount from the largest active subscription (sub.amount field).
  // Null when sub.amount = 0 (ChargeOver-confirmed paid-upfront: no recurring schedule).
  monthlyAmount: number | null;
  // Next scheduled invoice from ANY active subscription (ported from active-clients-billing).
  // Iterates all active subs, picks earliest nextBillDate, uses lineItemSum for amount.
  // Non-null even when monthlyAmount is null (upfront clients with a companion recurring sub).
  nextPaymentDate: Date | null;
  nextPaymentAmount: number | null;
  lifetimeTotalPaid: number;
  rolledOver: boolean;
};

export type SerializedClientRow = Omit<
  ClientRow,
  'pilotRolloverEndDate' | 'lastPaymentDate' | 'nextPaymentDate' | 'kickoffCall'
> & {
  pilotRolloverEndDate: string | null;
  lastPaymentDate: string | null;
  nextPaymentDate: string | null;
  kickoffCall: string | null;
};

export function serializeRow(r: ClientRow): SerializedClientRow {
  return {
    ...r,
    pilotRolloverEndDate: r.pilotRolloverEndDate?.toISOString() ?? null,
    lastPaymentDate: r.lastPaymentDate?.toISOString() ?? null,
    nextPaymentDate: r.nextPaymentDate?.toISOString() ?? null,
    kickoffCall: r.kickoffCall?.toISOString() ?? null,
  };
}

// ---------------------------------------------------------------------------
// Row builder
// ---------------------------------------------------------------------------
function buildRow(c: ClientRaw): ClientRow {
  const now = new Date();

  const activeSubs = c.subscriptions.filter((s) => isActive(s.status));

  const isStripe = c.billingProcessor === 'STRIPE' ||
    (c.stripeCustomerId != null && c.chargeoverCustomerId == null);

  // Largest active subscription = highest sub.amount (the authoritative recurring field)
  const sortedSubs = [...activeSubs].sort(
    (a, b) => Number(b.amount ?? 0) - Number(a.amount ?? 0)
  );
  const largestSub = sortedSubs[0] ?? null;

  // Payments — use statusNormalized enum (processor-agnostic)
  const paidPayments = c.payments.filter((p) => p.statusNormalized === 'SUCCESS');
  const lifetimeTotalPaid = paidPayments.reduce(
    (sum, p) => sum + Number(p.amount ?? 0),
    0
  );

  const nonFailedPayments = c.payments.filter((p) => p.statusNormalized !== 'FAILED');
  const lastAny = nonFailedPayments[0] ?? null;
  const lastPaymentPending = lastAny ? lastAny.statusNormalized !== 'SUCCESS' : false;

  // Next scheduled invoice: canonical function covering all historical fixes.
  const scheduled = nextScheduledPayment(activeSubs, now);
  const nextPaymentDate = scheduled?.date ?? null;
  const nextPaymentAmount = scheduled?.amount ?? null;

  // Monthly amount: sub.amount when > 0 (authoritative recurring field).
  // Fallback: lineItemSum from nextScheduledForAllSubs() for paid-upfront clients whose
  // largest sub has amount=0 but have a companion recurring sub (e.g. outfittalent,
  // lightningkite, EQ Schools, molten-layer, trueproductions). This surfaces the
  // recurring template's amount so the Monthly column isn't blank for those clients.
  // Only true "no recurring template" clients (null scheduled) stay at null.
  const monthlyAmount = Number(largestSub?.amount ?? 0) > 0
    ? Number(largestSub!.amount)
    : (nextPaymentAmount ?? null);

  const pilotEnd = c.pilotRolloverEndDate ? new Date(c.pilotRolloverEndDate) : null;
  const isInPilot = !!(pilotEnd && pilotEnd > now);
  const isPastPilot = !!(pilotEnd && pilotEnd <= now);

  const paidUpfront = isPaidUpfront(c.financeNotes);

  // Iterate all active subs — upfront-block sub (amount=0, no nextBillDate) lives alongside
  // the recurring template sub; checking only largestSub misses one or the other.
  const likelyPaidUpfront = !paidUpfront && isLikelyPaidUpfront(activeSubs);

  const tier = deriveTier(c.financeNotes);

  const rolledOver = isRolledOver(pilotEnd, c.payments, now);

  return {
    id: c.id,
    pipedriveOrgId: c.pipedriveOrgId,
    organizationName: c.organizationName,
    accountStatus: c.accountStatus,
    chargeoverCustomerId: c.chargeoverCustomerId,
    isStripe,
    paidUpfront,
    likelyPaidUpfront,
    kickoffCall: c.kickoffCall ?? null,
    pilotRolloverEndDate: pilotEnd,
    isInPilot,
    isPastPilot,
    activeSubscriptionCount: activeSubs.length,
    tier,
    lastPaymentDate: lastAny?.paidDate ?? null,
    lastPaymentAmount: lastAny ? Number(lastAny.amount ?? 0) : null,
    lastPaymentPending,
    monthlyAmount,
    nextPaymentDate,
    nextPaymentAmount,
    lifetimeTotalPaid,
    rolledOver,
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
  billingProcessor: true,
  stripeCustomerId: true,
  financeNotes: true,
  engagementType: true,
  dealType: true,
  brandName: true,
  actualLaunchDate: true,
  kickoffCall: true,
  pilotRolloverEndDate: true,
  subscriptions: {
    select: { status: true, amount: true, lineItems: true, billingProcessor: true },
  },
  payments: {
    orderBy: { paidDate: 'desc' as const },
    select: { amount: true, paidDate: true, status: true, statusNormalized: true },
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
      // Tab 1 shows Live + Executed Out — pilots ending regardless of current status
      accountStatus: { in: ['Live', 'Executed Out'] },
      pilotRolloverEndDate: { gte: todayStart, lte: tenDaysEnd },
      ...FLOOR9_WHERE,
    },
    select: CLIENT_SELECT,
    orderBy: { pilotRolloverEndDate: 'asc' },
  })) as unknown as ClientRaw[];

  return dedupeGhosts(clients).map(buildRow);
}

// ---------------------------------------------------------------------------
// Tab 2: Active by price — recurring clients only
// ---------------------------------------------------------------------------
export type ActiveByPriceResult = {
  rows: ClientRow[];     // Recurring monthly clients (paid-upfront excluded)
  excluded: ClientRow[]; // Paid-upfront clients (confirmed or ratio-inferred)
};

export async function getActiveByPriceRows(): Promise<ActiveByPriceResult> {
  const clients = (await prisma.client.findMany({
    where: {
      accountStatus: 'Live',
      ...FLOOR9_WHERE,
    },
    select: CLIENT_SELECT,
    orderBy: { organizationName: 'asc' },
  })) as unknown as ClientRaw[];

  const all = dedupeGhosts(clients).map(buildRow);

  const rows = all
    .filter((r) => !r.paidUpfront && !r.likelyPaidUpfront && r.monthlyAmount !== null && r.monthlyAmount > 0)
    .sort((a, b) => (b.monthlyAmount ?? 0) - (a.monthlyAmount ?? 0));

  const excluded = all
    .filter((r) => r.paidUpfront || r.likelyPaidUpfront)
    .sort((a, b) => a.organizationName.localeCompare(b.organizationName));

  return { rows, excluded };
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
      // KPIs count Live + Executed Out; Pre-Launch excluded
      accountStatus: { in: ['Live', 'Executed Out'] },
      ...FLOOR9_WHERE,
    },
    select: {
      accountStatus: true,
      pilotRolloverEndDate: true,
      financeNotes: true,
      chargeoverCustomerId: true,
      actualLaunchDate: true,
      subscriptions: { select: { status: true, amount: true, lineItems: true, billingProcessor: true } },
      // Only load payments that fall in the current month — used for postPilotCollectedThisMonth
      payments: {
        where: {
          statusNormalized: 'SUCCESS',
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
      // "Pilots ending in next 10 days" — future-only window (used by Tab 1)
      if (pd >= todayStart && pd <= tenDaysEnd) pilotsEndingNext10Days++;
      // "Pilots ending in [Month]" KPI cards — full calendar-month boundaries,
      // regardless of whether the date is past or future. A pilot that ended
      // April 5 (already past) still counts toward "Pilots ending in April."
      if (pd >= thisMonthStart && pd <= thisMonthEnd) pilotsEndingThisMonth++;
      else if (pd >= nextMonthStart && pd <= nextMonthEnd) pilotsEndingNextMonth++;
      else if (pd >= m2Start && pd <= m2End) pilotsEndingMonthAfterNext++;
    }

    const paidUpfront = isPaidUpfront(c.financeNotes);
    const pilotEnd = c.pilotRolloverEndDate ? new Date(c.pilotRolloverEndDate) : null;
    const isPastPilot = !!(pilotEnd && pilotEnd <= now);
    const pilotEndsThisMonth = !!(
      pilotEnd && pilotEnd >= thisMonthStart && pilotEnd <= thisMonthEnd
    );

    // Next scheduled invoice — canonical function
    const activeSubs = c.subscriptions.filter((s) => isActive(s.status));
    const invoice = nextScheduledPayment(activeSubs, now);

    // Post-pilot MRR: live, past pilot, not paid-upfront, has a future invoice
    if (c.accountStatus === 'Live' && isPastPilot && !paidUpfront && invoice) {
      postPilotMrr += invoice.amount;
    }

    // Collected this month: ok-successful MTD payments from live post-pilot clients only
    if (c.accountStatus === 'Live' && isPastPilot) {
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
// Tracy's notes — read-only from the shared ClientNote table
// (table is owned by active-clients-billing; we just read it).
// ---------------------------------------------------------------------------
export type ClientNotesMap = Record<string, string>;

export async function getClientNotes(clientIds: string[]): Promise<ClientNotesMap> {
  if (clientIds.length === 0) return {};
  const notes = await prisma.clientNote.findMany({
    where: { clientId: { in: clientIds } },
    select: { clientId: true, note: true },
  });
  const out: ClientNotesMap = {};
  for (const n of notes) {
    if (n.note) out[n.clientId] = n.note;
  }
  return out;
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
