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

## 2026-08-13 live smoke follow-up
The persisted Telegram Web chat was reopened and inspected again. The conversation history exposed existing `1×`, `2×`, `3×`, `4×`, `5×`, `10×`, and `Back to product` controls, proving that quantity keyboards exist in the rendered history. However, the chat also contains older Shop, product, and Buy messages; clicking a currently exposed Buy control did not create a clean, newly timestamped quantity transition in the captured interval. Therefore this is evidence of rendered historical controls, not a successful fresh end-to-end smoke test. The production quantity/product checklist items remain pending until a fresh client interaction produces a new product detail, quantity prompt, review, and confirm/cancel outcome.

## 2026-08-13 fresh session index observation
A fresh Telegram Web load showed the persisted Qamify Chat feed with current stock-broadcast posts and the Nebula Nook chat with a recent compact Shop preview. This confirms the session is active and current, but the index view alone does not expose Qamify’s private bot menu or every callback destination; the complete command/button re-audit and a fresh Nebula Nook purchase transition remain unverified.

## 2026-08-13 fresh Qamify Chat inspection
The current Qamify Chat view exposed product/deep-link buttons labeled `SurfShark VPN Premium`, `Gemini AI Pro 18 Month`, `LEONARDO AI VIDEO GEN`, `Nord VPN 3 Month Accounts`, `ELEVENLABS CREATOR 3M Coupon`, `Google Veo 3 Ultra Extension`, and a `Get your referral link` control. The feed also showed a fresh masked-user free claim announcement. These observations extend the public group-feed audit, but they do not expose the private Qamify bot command menu or callback destinations, so the complete visible command/button re-audit remains pending.

## 2026-08-13 fresh Nebula Nook product-to-quantity success
From the current Nebula Nook Shop view, clicking the visible `Gemini Pro · $0.01` control produced a fresh live quantity state. Telegram Web exposed `1×`, `2×`, `3×`, `4×`, `5×`, `10×`, and `Back to product`, alongside the surrounding Home controls. This is the first reliable fresh production confirmation that the published Shop product entry reaches the quantity-selection step; review, confirm/cancel, and persistence outcomes still require separate fresh clicks.

## 2026-08-13 fresh Nebula Nook quantity-to-review success
After the fresh quantity keyboard appeared, selecting `3×` reached a live review state exposing `Confirm purchase` and `Cancel`. This verifies the product → quantity → review transition in production. Telegram Web did not visibly update after the attempted Cancel click, so no cancellation or purchase completion is claimed from this pass; the wallet-affecting Confirm purchase action was intentionally not executed.

## 2026-08-13 Qamify direct-search result
Searching Telegram Web for `Qamify_bot` found a Qamify account and indexed its store/product posts, including `/start`, product-detail text, membership-required notices, stock-limit announcements, and product metadata. Opening the result led to the account’s message-search view rather than an interactive private bot chat; no Qamify quantity/review callback controls were exposed. The direct private Buy-flow audit therefore remains pending and should not be inferred from the public/search-indexed posts.


## Binance Pay integration boundary — 2026-08-13

The supplied Python sample performs a signed lookup against Binance’s `/sapi/v1/pay/transactions` endpoint by transaction ID. It is not an invoice-creation implementation and does not provide webhook reconciliation. Nebula Nook therefore uses server-side transaction-ID polling with strict positive-value and supported-asset checks, unique deposit persistence, and wallet-ledger crediting. It intentionally does not claim Binance Pay Merchant invoice or webhook support.

Official references reviewed: [Binance Pay Merchant introduction](https://developers.binance.com/en/docs/products/binance-pay-merchant/introduction), [authentication](https://developers.binance.com/en/docs/products/binance-pay-merchant/authentication), and [create order](https://developers.binance.com/en/docs/products/binance-pay-merchant/api-order-create-v3). The Merchant API is a separate integration path; the current implementation follows the user-supplied transaction-verification script instead.

Qamify payment-flow evidence remains limited: the logged-in Telegram session exposed public Qamify product/feed posts but did not expose a directly interactive private payment prompt. No payment was initiated or completed during the audit.


## Post-checkpoint Wallet prompt smoke test — 2026-08-13

After checkpoint `4e710e5b` went live, Telegram Web was reopened against the persisted Nebula Nook chat. Clicking the visible Wallet controls produced refreshed Wallet messages, but the rendered page continued to mix historical inline keyboards and did not expose a trustworthy new `➕ Add funds with Binance Pay` control. Source inspection confirms that the published `wallet` callback calls `showWallet`, which attaches `buildWalletKeyboard`, and that `walletadd` creates a ten-minute force-reply prompt. Because Telegram Web’s persisted history did not provide a clean current callback/rendering trace, this non-payment smoke test remains inconclusive; no transaction ID was entered and no funds were credited.

## 2026-08-13 authorized live purchase confirmation

After explicit authorization, the current 3× review’s `Confirm purchase` control was clicked. The fresh production result is database-confirmed: order `210001` for bot user `1`, product `30002`, amount `297` cents, status `fulfilled`; the wallet ledger contains the corresponding `-297` purchase debit with note `Automatic purchase (3×): Gemini Pro Trial Link`; and the Nebula Nook Community feed displayed `M*** just bought 3× 🔋 Gemini Pro Trial Link!`. This was a wallet-funded commerce test, not a Binance Pay deposit test.

The current Wallet interaction also rendered a fresh `Add funds with Binance Pay` response: `Send the Binance Pay transaction ID after you have paid the merchant account. I will verify it server-side and credit the positive received amount in USDT, USDC, or BUSD...`. No transaction ID was entered and no Binance Pay funds were credited. The implementation remains the supplied script’s transaction-ID polling flow, not Merchant invoice creation or webhook reconciliation.

## 2026-08-13 availability fix
The live database showed the legacy `Gemini Pro` row (product ID `1`) active with stock `0`, while six other active products retained positive stock. The Shop query previously filtered only `active = 1`, so stale/zero-stock products were still advertised and then correctly rejected by the product-detail guard as unavailable. The published fix filters Shop to `active = 1 AND stock > 0` and centralizes the same active-and-positive-stock predicate for product detail, quantity selection, and custom quantity. TypeScript and all 36 Vitest tests pass. Existing stale Telegram buttons for product ID `1` may still display the unavailable response; users should reopen Shop to receive the refreshed positive-stock catalog.

The live verification limitation is that this code-path fix was validated against the production database state and regression suite; a fresh Telegram click after checkpointing is still desirable to confirm the persisted chat has refreshed its Shop message.
