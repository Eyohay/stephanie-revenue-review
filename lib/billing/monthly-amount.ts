/**
 * Canonical monthly-amount derivation for a stored Subscription row.
 *
 * Spec (from forecast rework, 2026-05-15):
 *
 *   ChargeOver:
 *     monthly = min(sub.amount, serviceSum)
 *     where serviceSum = sum of (unitPrice × quantity) for lineItems where
 *       type === 'service' AND quantity === 1.
 *     Items where type === 'discount' are excluded.
 *     When serviceSum is 0 (no qualifying items), sub.amount is returned as-is.
 *
 *   Stripe:
 *     monthly = sum of (unitPrice × quantity) across lineItems.items.
 *     Returns 0 when lineItems.upfrontPending === true (upfront subs do not
 *     contribute to monthly recurring forecast).
 *
 * Source notes:
 *   - ChargeOver branch mirrors the inline min(sub.amount, serviceSum) rule
 *     used inside lib/query.ts:nextScheduledPayment (round 7 fix); pulled out
 *     here so the forecast row builder and any future caller share one
 *     implementation instead of re-deriving it.
 *   - Stripe branch encodes the persisted-shape variant of
 *     billing-audit/lib/stripe/normalize.ts:computeStripeMonthlyAmount,
 *     reading lineItems.items written by billing-audit/lib/sync/sync-stripe.ts.
 */

type StoredSubscription = {
  amount: unknown;
  lineItems: unknown;
  billingProcessor: string | null;
};

type ChargeOverLineItem = {
  type?: string;
  quantity?: number;
  qty?: number;
  unitPrice?: number;
};

type StripeLineItems = {
  upfrontPending?: boolean;
  items?: Array<{ unitPrice?: number; quantity?: number }>;
};

export function getMonthlyAmount(sub: StoredSubscription): number {
  if (sub.billingProcessor === 'STRIPE') {
    const li = sub.lineItems as StripeLineItems | null;
    if (!li || li.upfrontPending === true) return 0;
    const items = Array.isArray(li.items) ? li.items : [];
    const total = items.reduce(
      (s, item) => s + Number(item?.unitPrice ?? 0) * Number(item?.quantity ?? 1),
      0,
    );
    return total > 0 ? total : 0;
  }

  // ChargeOver (and any non-Stripe processor)
  const subAmt = Number(sub.amount ?? 0);
  const liArr = (sub.lineItems as ChargeOverLineItem[] | null) ?? [];
  const serviceSum = Array.isArray(liArr)
    ? liArr
        .filter(li => li?.type === 'service' && (li?.quantity ?? li?.qty ?? 1) === 1)
        .reduce((s, li) => s + Number(li?.unitPrice ?? 0) * Number(li?.quantity ?? li?.qty ?? 1), 0)
    : 0;

  if (serviceSum <= 0) return subAmt > 0 ? subAmt : 0;
  if (subAmt <= 0) return serviceSum;
  return Math.min(subAmt, serviceSum);
}
