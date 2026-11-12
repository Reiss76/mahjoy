# Buen Fin 2026 — Mexico storefront

Official campaign dates: November 13–17, 2026 (https://www.elbuenfin.org/?lang=es).
The owner authorized early activation on November 12 at 10:58 Mexico City time. The application window is `2026-11-12T16:58:00Z` through, but excluding, `2026-11-18T06:00:00Z`; the original closing time is unchanged. Customer copy says "Hasta el 17 de noviembre".

## Commercial rules

- Only MXN checkout on the Mexico storefront. `/en/` pages keep their existing experience.
- Net merchandise subtotal after existing coupon/bag offers; shipping does not qualify.
- Automatic 10% off every product and bundle in MXN, including preorder items. Shipping is excluded. Coupon and bag-offer rates use the highest applicable percentage; they do not compound with the campaign.
- One gift per order, at the highest reached tier after discounts: MXN 4,000 Line Finder, 8,000 Velvet Tile Bag, 12,000 Tile Case.
- Buyers can choose among currently available colors in the earned product family. All gift SKUs are explicitly allowlisted in `lib/buen-fin.js` and the independent Universe policy `apps/web/src/lib/mahjoy/buen-fin.ts`.
- The server appends the free physical line to the native PayPal order, shipping manifest and frozen receipt. Paid cart items and Proax catalog/coupon configuration remain intact.
- An unavailable or no longer eligible gift stops creation with a reviewable error; it never becomes a paid addition or an undocumented substitute.

## Automatic return

No scheduler, catalog rewrite or manual reversal is necessary. The popup and gift panel use server time and a boundary timer; the old popup modules resume with their original preference keys. New orders after the boundary use the original checkout. An unpaid order relying on the campaign discount or gift cannot capture after the deadline; already completed payments still reconcile and recover their original prices and gift afterward. The signed storefront uses Buen Fin protocol version 1 so the backend can be deployed first while accepting the older storefront during the rollout.

The browser's ordinary `mj_cart`, coupons and popup preference keys are never cleared. Campaign selection/seen keys are separate session values and become inert after expiry.

## Verification

- Store: `node --test --test-concurrency=4 tests/*.test.js`.
- Universe: from `apps/web`, `node --test --test-concurrency=4 tests/mahjoy-*.test.cjs`; typecheck with `tsc --noEmit`.
- Cover exact boundaries, all thresholds, USD exclusion, live catalog validation, zero-value gift lines, package inclusion, sale/inventory reconciliation, duplicate receipt handling and completed-order recovery after the deadline.
- Preview screenshots use a local process with a test clock; there is no public time override or activation switch.
