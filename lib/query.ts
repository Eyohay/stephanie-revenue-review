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
 * Returns the next scheduled invoice amount and date for a subscription.
 *
 * ROUND 7 REWRITE — source-of-truth change:
 *
 *   AMOUNT  → Subscription.amount (ChargeOver's computed recurring field).
 *             This is authoritative: ChargeOver excludes one-off service items,
 *             multi-month upfront blocks, and credits from this field.
 *             sub.amount = 0 means the subscription is paid upfront with no
 *             recurring schedule → return null.
 *
 *   DATE    → Soonest future nextBillDate across qty=1 service line items only.
 *             qty>1 items are multi-month upfront blocks whose dates are not
 *             recurring billing dates.
 *
 * Previous line-item-sum approach had two bugs (round 7 diagnostic):
 *   BUG A — Summed qty>1 multi-month blocks on paid-upfront subs → $10K–$14K totals.
 *   BUG B — Included stray one-off service items (e.g. atlphantom's $1,000 catch-up,
 *            sherwoodforestinc's $350 "Linkedin Profile Overhaul") that ChargeOver
 *            correctly excludes from sub.amount.
 *
 * Round 5 date normalization is preserved: ChargeOver stores dates as
 * "YYYY-MM-DD HH:MM:SS" without a TZ suffix. Anchoring to noon UTC prevents
 * the Eastern-timezone off-by-one that caused May 11 to display as May 10.
 */
export function nextInvoiceTotal(
  sub: { amount: unknown; lineItems: unknown },
  now: Date
): { date: Date | null; amount: number } | null {
  // sub.amount is the authoritative recurring monthly charge.
  // 0 (or missing) means paid upfront / no recurring schedule.
  const subAmt = Number(sub.amount ?? 0);
  if (subAmt <= 0) return null;

  type LineItem = {
    nextBillDate?: string;
    next_bill_date?: string;
    quantity?: number;
    qty?: number;
    type?: string;
  };

  const liArr = sub.lineItems as LineItem[] | null;
  const toDay = (raw: string): string => raw.split(/[\sT]/)[0];
  const todayUTC = now.toISOString().slice(0, 10);

  // Find the soonest future bill date using layered strategies:
  //   Strategy 1: qty=1 non-discount items (original strict rule)
  //   Strategy 2: any service items (relax qty filter)
  //   Strategy 3: any line item at all
  // If no future date is found we still return the amount — ChargeOver may not
  // have set nextBillDate yet (e.g. billing cycle just completed). Showing the
  // monthly amount without a date is better than hiding both.
  let soonestDay: string | null = null;

  if (Array.isArray(liArr) && liArr.length > 0) {
    const isFuture = (d: string) => d > todayUTC;

    // Strategy 1: qty=1 non-discount items
    for (const item of liArr) {
      if (item?.type === 'discount') continue;
      const qty = item?.quantity ?? item?.qty ?? 1;
      if (qty !== 1) continue;
      const raw = item?.nextBillDate ?? item?.next_bill_date;
      if (!raw) continue;
      const day = toDay(String(raw));
      if (isFuture(day) && (!soonestDay || day < soonestDay)) soonestDay = day;
    }

    // Strategy 2: any service items (qty filter relaxed)
    if (!soonestDay) {
      for (const item of liArr) {
        if (item?.type !== 'service') continue;
        const raw = item?.nextBillDate ?? item?.next_bill_date;
        if (!raw) continue;
        const day = toDay(String(raw));
        if (isFuture(day) && (!soonestDay || day < soonestDay)) soonestDay = day;
      }
    }

    // Strategy 3: any line item
    if (!soonestDay) {
      for (const item of liArr) {
        const raw = item?.nextBillDate ?? item?.next_bill_date;
        if (!raw) continue;
        const day = toDay(String(raw));
        if (isFuture(day) && (!soonestDay || day < soonestDay)) soonestDay = day;
      }
    }
  }

  // Always return the amount when sub.amount > 0.
  // date may be null when ChargeOver hasn't set nextBillDate yet — the UI
  // shows the amount with "—" for the date column, which is better than "—" for both.
  const date = soonestDay ? new Date(soonestDay + 'T12:00:00.000Z') : null;
  return { date, amount: subAmt };
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
export function isLikelyPaidUpfront(sub: SubRaw | null): boolean {
  if (!sub) return false;
  // sub.amount = 0 means ChargeOver confirmed no recurring schedule → upfront payment.
  // This is a stronger signal than qty>1 inspection and catches clients like
  // trueproductions.com where the financeNotes don't use the "Paid Upfront" keyword.
  if (Number(sub.amount ?? 0) === 0) return true;
  const liArr = (sub.lineItems as Array<{ type?: string; quantity?: number; qty?: number }> | null) ?? [];
  if (!Array.isArray(liArr)) return false;
  // Any qty>1 service item is a multi-month block — structural signal for upfront payment
  return liArr.some((li) => li?.type === 'service' && (li?.quantity ?? li?.qty ?? 1) > 1);
}

/**
 * Compute the next scheduled invoice across ALL active subscriptions.
 *
 * Ported from active-clients-billing's approach — iterates every active sub
 * (not just the largest) and picks the one with the earliest nextBillDate in
 * lineItems JSON.  Amount = sum of (unitPrice × quantity) for all line items
 * on that sub (may be a multi-month lump rather than the monthly rate).
 *
 * No sub.amount gate — paid-upfront subs with sub.amount = 0 still have
 * nextBillDate set on the LINE ITEMS of a companion subscription that
 * represents the upcoming recurring charge.
 */
export function nextScheduledForAllSubs(
  activeSubs: SubRaw[],
  now: Date,
): { date: Date; amount: number } | null {
  type Li = {
    nextBillDate?: string;
    next_bill_date?: string;
    unitPrice?: number;
    quantity?: number;
    qty?: number;
  };

  let bestDate: Date | null = null;
  let bestAmount = 0;

  for (const sub of activeSubs) {
    const liArr = sub.lineItems as Li[] | null;
    if (!Array.isArray(liArr) || liArr.length === 0) continue;

    let candidateDate: Date | null = null;
    for (const item of liArr) {
      const raw = item?.nextBillDate ?? item?.next_bill_date;
      if (!raw) continue;
      const d = new Date(raw);
      if (!candidateDate || d < candidateDate) candidateDate = d;
    }
    if (!candidateDate) continue;

    if (!bestDate || candidateDate < bestDate) {
      bestDate = candidateDate;
      // Sum all line items (unitPrice × qty) — matches active-clients-billing's subAmount()
      const sum = liArr.reduce(
        (s, li) =>
          s + Number(li?.unitPrice ?? 0) * Number(li?.quantity ?? li?.qty ?? 1),
        0,
      );
      bestAmount = sum > 0 ? sum : Number(sub.amount ?? 0);
    }
  }

  if (!bestDate) return null;

  // Anchor to noon UTC — avoids Eastern-timezone off-by-one (round 5 fix)
  const dateStr = bestDate.toISOString().slice(0, 10);
  return { date: new Date(dateStr + 'T12:00:00.000Z'), amount: bestAmount };
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
// Shared types — exported for reuse in joinPipedriveWithNeon.ts
// ---------------------------------------------------------------------------
export type SubRaw = {
  status: string | null;
  amount: unknown;
  lineItems: unknown;
};

export type PayRaw = {
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

  // Largest active subscription = highest sub.amount (the authoritative recurring field)
  const sortedSubs = [...activeSubs].sort(
    (a, b) => Number(b.amount ?? 0) - Number(a.amount ?? 0)
  );
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

  // Next scheduled invoice: search ALL active subs (ported from active-clients-billing).
  // This finds the companion recurring sub's nextBillDate even when largestSub.amount = 0.
  const scheduled = nextScheduledForAllSubs(activeSubs, now);
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

  // Structural backstop: any qty>1 service item is a multi-month upfront block.
  // The primary signal is sub.amount === 0 → nextPaymentAmount === null → naturally
  // excluded. This only fires for the edge case of qty>1 with sub.amount > 0.
  const likelyPaidUpfront = !paidUpfront && isLikelyPaidUpfront(largestSub);

  const tier = deriveTier(c.financeNotes);

  return {
    id: c.id,
    pipedriveOrgId: c.pipedriveOrgId,
    organizationName: c.organizationName,
    accountStatus: c.accountStatus,
    chargeoverCustomerId: c.chargeoverCustomerId,
    paidUpfront,
    likelyPaidUpfront,
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

    // Next invoice from largest active subscription (sort by sub.amount)
    const activeSubs = c.subscriptions.filter((s) => isActive(s.status));
    const largestSub = [...activeSubs].sort(
      (a, b) => Number(b.amount ?? 0) - Number(a.amount ?? 0)
    )[0] ?? null;
    const invoice = largestSub ? nextInvoiceTotal(largestSub, now) : null;

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
