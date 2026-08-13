# Qamify public behavior audit

## Observed current bot surface

The Qamify chat exposes a membership gate with `Join Channel`, `Join Group`, and `I have joined`. After the gate, the visible menu includes two freebies buttons—`ChatGPT Go 3 Months Coupen | FREE` and `SurfShark VPN Premium | FREE`—plus `Open Shop`. The shop view exposes multiple `Buy Now` buttons and a `« Back` control.

## Observed notification style in related chats

The Qamify Chat feed shows compact purchase notifications such as `User V***** just bought 5× Gemini AI Pro 18 Month!`. Qamify broadcast posts use strong visual separators, emoji-led urgency, stock counts, product title, and price, for example an `ALMOST GONE` post for an ElevenLabs Creator 3M coupon with `Only 1 item left in stock` and `Price $10.00`. Other commerce-group messages use short success notices indicating a user successfully activated a product.

## Initial interaction map

| Area | Observed behavior | Nebula Nook equivalent to implement |
|---|---|---|
| Access gate | Join channel, join group, then verify membership | Keep the same three-step sequence with verified invite URLs and a clear retry path |
| Freebies | Product-specific free claim buttons | Present each active free product with stock/window status and one-tap claim |
| Shop | Dedicated shop entry, product-specific Buy Now buttons, Back navigation | Add a structured shop catalog with product cards, price, stock, and back navigation |
| Group notifications | Short purchase/success messages plus urgency stock broadcasts | Use concise emoji-led operational notifications with product, quantity, user label, price, and status |

## Shop detail audit

Selecting a shop item opens a rich product detail message with an image, title, price, stock, warranty, product type, delivery type, and a description section, followed by a `Buy Now` action. The observed Surfshark item showed `Price: $1.00`, `Stock: 99`, `Warranty: No Warranty`, `Product Type: Coupon / Link`, and `Delivery Type: Automatic`. The shop list also exposes `Refresh` and `Back to Home` controls. The catalog includes a broad set of digital services and coupons with explicit prices and stock counts, including Surfshark, ElevenLabs, Gemini AI Pro, Canva, Leonardo, Veo, CapCut, NordVPN, Notion, Headspace, and email products.

## Nebula Nook live comparison checkpoint

The live Nebula Nook conversation currently exposes the expected six primary controls: `Freebies`, `Shop`, `Wallet`, `Orders`, `Profile`, and `Support`. The database verification confirms the existing Telegram users each have a $10.00 balance and a single `testing-wallet-credit-v1` ledger entry, while the six original starter products are active and stocked. The implementation is intentionally an original Nebula Nook catalog rather than a verbatim reproduction of Qamify’s names, descriptions, or branding.

## Group purchase announcement and inline product behavior

Telegram Web inspection of Qamify Chat showed the latest announcement in the compact format: `Qamify: User N***** just bought 1× [product emoji] LEONARDO AI VIDEO GEN!`. The announcement has an inline product button labeled `LEONARDO AI VIDEO GEN`; opening it navigates to the Qamify product detail flow, which shows product metadata and `Buy Now`, quantity choices, `Custom Quantity`, `Set Price Alert`, and `« Back to Shop` controls. This confirms the desired pattern: masked buyer + quantity + product emoji/name in the group announcement, with a product button leading back into the bot product/purchase flow.

Observed source: logged-in Telegram Web, Qamify Chat, 2026-08-12.

## Latest live Telegram Web audit — 2026-08-12

The current logged-in view confirms Qamify’s visible group patterns: masked buyer/referral announcements, urgency cards with stock and price, and product/deep-link affordances. The latest Nebula Nook responses are bounded single messages: Wallet shows balance and activity; Orders shows the fulfilled order; Profile shows name, tier, referrals, and referral URL; the newest Freebies response shows one compact catalog message with `🎁 Gemini Pro Trial Link` and `📦 Stock: 39`. Telegram Web history still contains older multi-message responses, so newest timestamped messages must be used for verification.

## 2026-08-13 live quantity-flow smoke attempt
The published Nebula Nook Shop screen rendered six compact product buttons (`Gemini Pro · $0.01`, `ChatGPT Starter Access · $2.99`, `Gemini Pro Trial Link · $0.99`, `Surfshark Trial Coupon · $1.00`, `Canva Creator Access · $2.50`, `CapCut Premium Trial · $2.20`) plus `Next`, `Refresh`, and `Back to home`. Telegram Web clicks on the visible `Gemini Pro Trial Link` button were sent through the client, but no product-detail/quantity prompt became visible during the captured interval; this live transition remains unverified and must not be claimed as successful.

## 2026-08-13 live quantity-flow smoke attempt — follow-up
After checkpoint 66b357a9, the published Nebula Nook Shop still rendered multiple in-stock `Buy now` controls. Clicking the current visible control did not produce a visible quantity prompt during this attempt. Local development logs and the available production-log query did not show a corresponding callback entry, so this is an unverified browser-delivery result rather than proof that the published callback route is incorrect. The Telegram Web DOM exposed `Button ... primary` and `data-manus_click_id` attributes but not callback payloads. Source and focused tests now use `buyqty:<productId>:0` for the Product Buy entry, with 17 quantity-flow tests plus response-fallback coverage passing. The chat contains older historical product messages, so stale controls must not be used as evidence; a clean direct Telegram client interaction remains needed for definitive end-to-end confirmation.
