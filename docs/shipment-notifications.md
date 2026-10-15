# Shipment updates and Apple Wallet

The storefront receives authenticated Envia tracking events and maintains notification-only tables. It does not update payments, sale prices, invoices, or fulfillment records. Mónica and Marcela receive operational alerts through Proax; customer Wallet packages are separately authorized by a signed receipt session issued only after a verified PayPal capture.

## Activation

Deploy the code before enabling either flag. Proax and this service must use the same business database.

| Storefront secret or setting | Purpose |
| --- | --- |
| `MAHJOY_SHIPMENT_NOTIFICATIONS_ENABLED=true` | Run the label scanner and tracking-event worker. |
| `ENVIA_WEBHOOK_SECRET` | At least 32 characters; the signing secret for the Envia subscription, **not the Envia API key**. |
| `MAHJOY_WALLET_ENABLED=true` | Enable Wallet only once all certificate and ownership checks pass. |
| `MAHJOY_WALLET_PUBLIC_ENABLED=false` | Keep new checkout enrollment and browser downloads closed during private device validation. Set to `true` for public launch. Authenticated callbacks for existing Wallet orders remain available. |
| `MAHJOY_WALLET_ORDER_TYPE_ID` | Registered `order.…` identifier for Mahjoy. |
| `MAHJOY_WALLET_MERCHANT_ID` | Merchant identifier from the same Apple Developer team. |
| `MAHJOY_WALLET_TEAM_ID` | Ten-character Apple Developer Team ID. |
| `MAHJOY_WALLET_AUTH_SECRET` | Independent random secret, at least 32 characters; changing it invalidates existing receipt sessions and Wallet order tokens. |
| `MAHJOY_WALLET_SIGNING_CERT` | Valid Order Type ID certificate, PEM. |
| `MAHJOY_WALLET_SIGNING_KEY` | Matching RSA private key, PEM, server secret only. |
| `MAHJOY_WALLET_WWDR_CERT` | Corresponding valid Apple WWDR intermediate, PEM. |

Use Railway server variables, never public frontend variables or source files. Certificate creation requires the team's Apple Developer account; ordinary Proax credentials cannot create it. This feature does not rotate the existing Envia API key.

Configure Envia's **signed** `tracking.simple` or `tracking.ecommerce` subscription to `https://www.playmahjoy.com/api/shipping/events/envia`. The endpoint requires the exact raw request body, fresh millisecond timestamp, matching event type and an HMAC-SHA256 signature. Unsigned legacy webhooks are rejected. Confirm the provider's actual subscription secret and event schema before enabling; do not test by buying or cancelling a real label.

## Behavior

- A tracking number and its carrier must match the same paid Mahjoy shipment. Unknown mappings wait for synchronization; ambiguous matches do not alert either customer.
- Event IDs deduplicate retries. Earlier events and backward delivery transitions cannot replace newer progress. Delivered/returned/cancelled are terminal.
- Label scanning begins on first activation, persists across restarts, and drains batches. It does not flood recipients with historical label notifications.
- Wallet appears after a **new verified completed PayPal payment** and does not add a checkout form. Customers explicitly add the order to Wallet. A guessed order number, copied package URL, or another customer's session cannot download it.
- The package includes purchased product names/quantities, historical payment total, and tracking states. No shipping address or email is required in it. Completion requires every known package to be delivered.
- Existing paid orders and customers without a receipt session are not automatically enrolled. Changing this requires a separate verified customer-ownership mechanism.
- Wallet devices register with their order-specific `AppleOrder` token. Changes enqueue an empty APNs signal; Wallet retrieves the newly signed order package. Retries are bounded and device-token errors cannot discard a newly rotated registration.

## Validation and rollback

`npm ci --ignore-scripts && node --test tests/*.test.js` runs the existing checkout/shipping checks plus signature, database event processing, multi-package association, restart/batch, customer ownership, device registration and APNs retry tests. Test certificates are generated temporarily; these tests do not demonstrate acceptance by a real iPhone or Apple production certificate.

Before enabling Wallet, install a package on a test iPhone and verify registration, a simulated tracking update, package retrieval and unregistration. An authorized real shipment is required to claim end-to-end carrier delivery. Do not capture a payment or purchase a label solely to test notifications.

For private device validation, enable `MAHJOY_WALLET_ENABLED` with `MAHJOY_WALLET_PUBLIC_ENABLED=false` and leave `MAHJOY_SHIPMENT_NOTIFICATIONS_ENABLED=false`. A clearly labeled synthetic order can exist only in the Wallet tables, without a sale or shipment in `web_orders`. Its signed package uses the normal authenticated callback routes and its push queue is processed independently. Do not place private signing keys or downloadable order tokens in source control. Enable public enrollment and shipment processing only after verification.

Rollback: disable `MAHJOY_WALLET_ENABLED` and `MAHJOY_SHIPMENT_NOTIFICATIONS_ENABLED`; preserve the tables, tokens and paid orders for recovery. No real notifications were sent by automated tests.

References: [Wallet Orders](https://developer.apple.com/documentation/walletorders), [Track with Wallet button](https://developer.apple.com/documentation/applepayontheweb/adding-a-track-with-apple-wallet-button), [Order signing](https://developer.apple.com/documentation/walletorders/building-a-distributable-order-package).
