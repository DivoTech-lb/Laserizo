/* ============================================================================
   Bulk pricing — the only place that decides what an order costs.
   ----------------------------------------------------------------------------
   Price per pin and delivery are both chosen by ONE number: the total quantity
   of pins in the whole cart (ready-made catalogue items and custom-text pins
   added together). Crossing a threshold re-prices the WHOLE cart at the new
   rate — it is not marginal pricing, so 50 pins cost 50 × $0.80, not
   49 × $2.00 + 1 × $0.80.

   The tiers come from business.json "pricingTiers"; TIERS below is the same
   table, used only if that list is missing or invalid.

   Matching rule: the tier with the HIGHEST `min` that is <= the quantity.
   `max` is never used to match, so overlapping rows (tier 1 max:5, tier 2
   min:5) resolve deterministically: exactly 5 pins is tier 2.

   Nothing in here touches the DOM. The cart (engine.js), the pricing-rules
   popup and the build-time hero stats all read from these functions.
   ============================================================================ */

/** At this many pins or more, normal checkout is blocked: the customer is
    asked to contact the shop on WhatsApp for a quote instead. */
export const BULK_LIMIT = 1000;

/** Fallback table — identical to business.json "pricingTiers". */
export const TIERS = [
  { min: 1,   max: 5,   unitUsd: 2.00, deliveryUsd: 5 },
  { min: 5,   max: 49,  unitUsd: 2.00, deliveryUsd: 0 },
  { min: 50,  max: 99,  unitUsd: 0.80, deliveryUsd: 5 },
  { min: 100, max: 199, unitUsd: 0.50, deliveryUsd: 5 },
  { min: 200, max: 299, unitUsd: 0.40, deliveryUsd: 5 },
  { min: 300, max: 499, unitUsd: 0.35, deliveryUsd: 5 },
  { min: 500, max: 999, unitUsd: 0.30, deliveryUsd: 5 }
];

/** Validate a tier list (e.g. business.json "pricingTiers") and sort it by
    `min`. Falls back to TIERS when the list is missing or malformed. */
export function normalizeTiers(list) {
  var ok = Array.isArray(list) && list.length > 0 && list.every(function (t) {
    return t && isFinite(t.min) && isFinite(t.unitUsd) && isFinite(t.deliveryUsd);
  });
  var src = ok ? list : TIERS;
  return src.map(function (t) {
    return { min: Number(t.min), max: Number(t.max), unitUsd: Number(t.unitUsd), deliveryUsd: Number(t.deliveryUsd) };
  }).sort(function (a, b) { return a.min - b.min; });
}

/** The quantities each tier ACTUALLY applies to under the highest-min rule:
    from its own `min` up to one below the next tier's `min` (the last tier
    runs up to BULK_LIMIT - 1). Used for display, so overlapping `max` values
    never show as overlapping ranges. */
export function tierRanges(tiers) {
  var list = normalizeTiers(tiers);
  return list.map(function (t, i) {
    var to = list[i + 1] ? list[i + 1].min - 1 : BULK_LIMIT - 1;
    return Object.assign({ from: t.min, to: to }, t);
  });
}

/** Tier for a quantity: the one with the highest `min` <= qty (null if none). */
export function tierFor(qty, tiers) {
  var list = normalizeTiers(tiers);
  var hit = null;
  for (var i = 0; i < list.length; i++) if (list[i].min <= qty) hit = { tier: list[i], index: i, list: list };
  return hit;
}

/**
 * Price an entire cart from its total pin count.
 *
 * @param {number} totalQty  sum of every line's quantity, both collections
 * @param {Array}  [tiers]   tier table; defaults to TIERS
 * @returns {{
 *   qty: number,
 *   blocked: boolean,        true at BULK_LIMIT+ — no price, contact on WhatsApp
 *   tier: object|null,       the matching tier (null when empty or blocked)
 *   unitUsd: number|null,    price applied to every pin in the cart
 *   subtotalUsd: number|null,
 *   deliveryUsd: number|null,
 *   totalUsd: number|null,   subtotal + delivery
 *   next: object|null        the next tier up, with `need` = pins still to add;
 *                            { blocked: true } when the next step is BULK_LIMIT
 * }}
 */
export function bulkPricing(totalQty, tiers) {
  var list = normalizeTiers(tiers);
  var qty = Math.max(0, Math.floor(Number(totalQty) || 0));

  /* Empty cart: nothing to pay, but expose the entry-level rate for display. */
  if (qty === 0) {
    return {
      qty: 0, blocked: false, tier: null,
      unitUsd: list[0].unitUsd, subtotalUsd: 0, deliveryUsd: 0, totalUsd: 0,
      next: Object.assign({ need: list[0].min }, list[0])
    };
  }

  /* 1000+: no automatic price at all. */
  if (qty >= BULK_LIMIT) {
    return {
      qty: qty, blocked: true, tier: null,
      unitUsd: null, subtotalUsd: null, deliveryUsd: null, totalUsd: null,
      next: null
    };
  }

  var hit = tierFor(qty, list) || { tier: list[0], index: 0 };
  var tier = hit.tier;

  /* Work in whole cents so 0.35 × 300 is exactly 105.00, never 104.99999. */
  var subCents = Math.round(tier.unitUsd * 100) * qty;
  var delCents = Math.round(tier.deliveryUsd * 100);

  var up = list[hit.index + 1];
  var next = up
    ? Object.assign({ need: up.min - qty }, up)
    : { need: BULK_LIMIT - qty, blocked: true };

  return {
    qty: qty,
    blocked: false,
    tier: tier,
    unitUsd: tier.unitUsd,
    subtotalUsd: subCents / 100,
    deliveryUsd: delCents / 100,
    totalUsd: (subCents + delCents) / 100,
    next: next
  };
}
