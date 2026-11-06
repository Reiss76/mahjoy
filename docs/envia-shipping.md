# Envia production shipping

`ENVIA_API_KEY` is required in the Railway `mahjoy` service. No source-code fallback is allowed. The owner deferred credential rotation; the historically published credential remains valid until revoked. Saving the same value in Railway does not revoke that historical copy.

`ENVIA_ORIGIN_US_JSON` holds the owner-confirmed Envia origin (address record 7472930, Eagle Pass TX 78852). `ENVIA_ORIGIN_MX_JSON` is an optional complete override. A postal-only override cannot change a different origin address. Signed paid snapshots retain their original origin and selected service.

## Verified eligibility, 2026-10-13

PayPal sends a redacted regional address to its authenticated server callback. Do not insert fake recipient/contact/street values to satisfy a carrier schema. Real production regional quotes were accepted for MX FedEx and US FedEx, UPS and USPS. MX DHL, Estafeta and Paquetexpress rejected the redacted payload and are excluded from that flow until supported. Only a returned `dropOff: 0` is offered; absent or branch modes 1/2/3 do not qualify. USPS Media Mail is ineligible for the merchandise.

Official Queries state codes normalize the real PayPal state; Geocodes array and documented wrapper forms are supported. ZIP+4 remains in the address; its five-digit area compares to the quote. Positive references are cached for 24 hours. Definite invalid-location/business failures cannot be bypassed by a fallback.

PDF print settings come from the carrier country catalog, preferring STOCK_4X6, PAPER_4X6, then PAPER_7X4.75. Live US UPS accepts PAPER_7X4.75; its default STOCK_4X6.5 is outside the documented generation enum and is not inferred.

## Selection and costs

Private signed RPC protocol 2 sends verified merchandise values after discount, frozen physical composition, city and state. Every physical parcel has its share of declared merchandise value in integer centavos, excluding shipping and separate from insurance.

Economy compares total prices, then valid durations, then carrier/service. Fastest compares valid durations, then price, then carrier/service. Unknown/conflicting estimates cannot win speed. Structured quantity and unit take priority; `day` and `hrs` aliases were confirmed in live responses. Text ranges use the upper limit. Dates remain provider evidence, never a computed guaranteed arrival date. Identical winners produce one option.

Final approved full-address validation and recotization retain the selected service and buyer-approved amount. A confirmed exceptional cost increase is the merchant's responsibility. A guide records charged shipping, actual label cost and `max(cost - charged, 0)`, once for each billed provider row. The higher cost requires a fresh provider quote and a signed Proax update, bound to the exact order. Never auto-downgrade fast shipping.

Persist a guide reservation before generation. Network/business/invalid replies after purchase stay pending review; never repeat generation. Master and child tracking, shipment ID, PDFs, tracking links and additional files survive reconciliation. Old completed guides replay without recotization. Old unpaid quotes expire normally; historical paid snapshots and signature domains stay readable. If an old guide purchase lacks declared values, use the frozen verified checkout prices; a missing physical bundle allocation requires review rather than reconstruction.

## Rollout

Deploy compatible Proax readers before this producer. Enable `MAHJOY_PAYPAL_SHIPPING_CHOICES_ENABLED=true` on Proax only after an unpaid Live PayPal selector check. Signed private `shippingChoicesVerification` can create an unpaid protocol-2 order while the public choices flag is off; captures of version-2 sessions remain blocked while the flag is off. Keep the established native shipping/authentication flags unchanged.

Watch sanitized `[envia/rates]`, PayPal callback errors/latency, pending guide reservations, selected service and persisted merchant absorption for the first 24 hours. A live guide requires a specific authorized shipment; tests only query rates and simulate generation.

References: https://docs.envia.com/reference/shipping-rates, https://docs.envia.com/reference/create-shipping-label, https://docs.envia.com/docs/delivery-estimate, https://docs.envia.com/reference/carrier-print-options, https://developer.paypal.com/api/orders/v2/server-callback/.
