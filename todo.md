# Project TODO

- [x] Define the original Nebula Nook Bot architecture and document the non-impersonation boundary.
- [x] Add configurable Telegram bot, membership-gate, admin, catalog, wallet, referral, order, support, notification, and schedule data models.
- [x] Add secure environment configuration for the Telegram bot token and webhook settings.
- [x] Implement the persistent Telegram webhook endpoint for @NebulaNook4827_bot.
- [x] Implement /start with referral parsing and configurable channel/group membership verification.
- [x] Implement inline membership buttons: Join Channel, Join Group, and I have joined.
- [x] Implement the freebies catalog with one-claim-per-window enforcement and automatic reset behavior.
- [x] Implement /shop with paid product descriptions, prices, and Buy actions.
- [x] Implement wallet balance, top-up history, and spending history views.
- [x] Implement /orders with purchase and free-claim statuses.
- [x] Implement /profile with Bronze, Silver, and Gold membership labels, referral link, and referral count.
- [x] Implement referral tracking for /start?ref=CODE and duplicate-credit prevention.
- [x] Implement /support and forwarding of support messages to the configured admin chat.
- [x] Implement automated user and admin notifications for purchases, free claims, and support tickets.
- [x] Implement the authenticated web admin dashboard.
- [x] Add admin product CRUD, free-window scheduling, stock controls, user/order/balance views, and broadcast messaging.
- [x] Add webhook idempotency, input validation, authorization, rate limiting, and safe error handling.
- [x] Write Vitest coverage for membership checks, claims, referrals, wallet/order views, support forwarding, and admin authorization.
- [x] Run type checks, tests, and browser verification of the dashboard.
- [x] Document deployment and webhook setup for the chosen free Autoscale fallback.
- [x] Save a checkpoint for the public-dashboard and webhook-diagnostics fix.
- [x] Save a final checkpoint after live webhook verification is complete.
- [x] Document free Autoscale deployment as a webhook-capable fallback without guaranteed 24/7 process persistence.
- [x] Publish the project on free Autoscale.
- [x] Register the Telegram webhook from the dashboard after publish and confirm Telegram webhook metadata.
- [x] Patch webhook registration handling and add visible diagnostics.
- [x] Verify the published webhook registration and restore Telegram bot responsiveness end to end.
- [x] Remove the dashboard sign-in gate and make the admin UI publicly accessible, with the security tradeoff documented.
- [x] Replace the invalid webhook secret with a Telegram-allowed alphanumeric/hyphen/underscore value and add regression coverage.
- [x] Replace the invalid webhook secret with a Telegram-allowed value and validate its character set before registration.
- [x] Perform live webhook registration and verify Telegram webhook metadata before delivery.
- [x] Send and verify an end-to-end bot update after webhook registration.
- [x] Diagnose the reported live `/start` non-response after webhook registration by tracing Telegram webhook status, server logs, and handler delivery.
- [x] Fix the live webhook or bot-response path if the trace identifies a code or deployment issue.
- [x] Verify a real `/start` update receives a successful bot response and complete the end-to-end delivery item.

**Progress note:** Live `/start` verification succeeded after quoting the reserved SQL column `key` in the membership-settings query. Telegram Web shows the Nebula Nook reply menu with Freebies, Shop, Wallet, Orders, Profile, and Support buttons.

- [x] Audit and fix completed-order notifications so fulfillment events are delivered to the configured admin/group chat.
- [x] Repair membership channel/group join links and validation so users do not see `username not found` for configured spaces.
- [x] Upgrade Telegram bot copy, emojis, keyboards, and status messages into a polished, consistent commerce experience inspired by the requested interaction quality without copying proprietary text or branding.
- [x] Add regression coverage for group notifications, membership-link validation, and formatted command responses.
- [x] Verify the revised flows in Telegram and save a new production checkpoint.
- [x] Add Vitest coverage for fulfilled-order notification delivery, including configured notification group targeting and customer-DM failure isolation.
- [x] Add regression tests for formatted home, membership, purchase, support, and status responses.
- [x] Polish the remaining plain-text support and extra-device responses with the same emoji and formatting language.

- [x] Audit Qamify bot menus, button actions, user-facing copy patterns, and group notifications through the logged-in Telegram session.
- [x] Document an original Nebula Nook behavior map based on the public audit without copying proprietary branding or text verbatim.
- [x] Add testing-mode wallet credit of $10 for each existing user and exactly-once $10 initialization for newly created users.
- [x] Add a default starter product catalog based on observed public product categories, with clear original names, descriptions, prices, stock, and active states.
- [x] Verify wallet credits, default products, bot buttons, order flows, and group notifications with tests and live Telegram checks.
- [x] Save and publish a checkpoint for the audited and implemented testing-mode release.

- [x] Audit Qamify Shop presentation to confirm whether products are shown as separate messages or paginated/compact navigation, and inspect completion-notification destinations.
- [x] Replace Nebula Nook’s multi-message Shop output with compact catalog navigation and product-detail actions.
- [x] Change order completion notifications to the configured operations group only, with no personal admin DM.
- [x] Automatically complete wallet-paid orders when balance is sufficient, without requiring manual dashboard fulfillment.
- [x] Add regression tests for compact Shop, automatic completion, and group-only notifications; live purchase smoke test verified in the operations group.
- [x] Save and publish a checkpoint for the revised order flow.

- [x] Verify a compact Shop item tap opens the expected product-detail view and capture test evidence.
- [x] Remove personal customer/admin completion DMs so fulfillment completion is group-only, and add direct regression coverage.
- [x] Verify a wallet-funded purchase auto-completes without dashboard fulfillment in a clean live smoke test; order 120001 is fulfilled and the wallet debit is recorded.
- [x] Record concrete passing-test evidence for compact Shop, automatic completion, and group-only notifications before the next checkpoint; live order creation verified via the fresh group announcement.

- [x] Audit the Qamify group purchase announcement format, including masked buyer name, quantity, product emoji/name, and inline bot/product link behavior; verified the product button opens Qamify’s product detail flow.
- [x] Implement an original Nebula Nook group purchase announcement with privacy-safe buyer masking and an inline button linking to the product flow.
- [x] Add regression tests for announcement formatting, quantity, product emoji, masked identity, and callback URL.
- [x] Verify the new announcement in the configured operations group and publish a checkpoint.
- [x] Verify and document the live Qamify group announcement inline button label and destination.
- [x] Verify the deployed Nebula Nook purchase announcement in the operations group, including its inline product button target; post-verification checkpoint still pending.

- [x] Capture the logged-in Telegram comparison views for Qamify and Nebula Nook, including Qamify’s emoji-rich announcement/menu presentation and Nebula Nook’s current menu surface.
- [x] Improve Nebula Nook `/start` with richer user details, clearer membership status, and polished grouped buttons where Telegram Bot API permits.
- [x] Add regression coverage for the revised `/start` formatting; `pnpm check` and all 22 Vitest tests pass.

- [x] Inspect Qamify’s rendered button elements and distinguish callback, URL, Web App, and client/theme styling mechanisms.
- [x] Compare the observed mechanism with Telegram Bot API capabilities and document what Nebula Nook can reproduce.
- [x] Decide whether Nebula Nook needs a Mini App for truly custom colored controls and document the implementation path.
- [x] Add Telegram Bot API 10.2-compatible predefined button styles to Nebula Nook keyboards and verify the live rendering in Telegram Web; production Telegram Web rendered the published controls with Telegram’s `primary` styling.
- [x] Document representative Qamify button-type evidence: URL, callback-style, and whether any inspected control launches a Web App; record any limits of Telegram Web DOM evidence.
- [x] Inspect the final Telegram keyboard builders and document the intended style field on representative start, membership, Shop, Buy now, and claim controls.
- [x] Add regression assertions for representative primary and success-styled controls beyond the purchase-announcement URL button; the focused presentation suite now has 7 tests and the full suite has 23 passing tests.
- [x] Verify a success-styled action and a primary-styled Shop/product action live in Telegram Web; the published Shop and Buy now controls rendered with Telegram Web’s styled button class and white-on-green client presentation.
- [x] Capture an explicit live Telegram Web DOM sample mapping a Shop/product or Next button text to its rendered class/computed style, and note whether Telegram normalizes primary and success styles visually; live `Shop` and `Buy now` samples used Telegram Web’s `Button ... primary` class with white-on-green rendering.

- [x] Re-audit the Qamify command/button surfaces available in the logged-in session: recorded the visible membership, freebies, Shop, product/deep-link, referral, and public-feed controls with outcomes; private callback controls were not exposed.
- [x] Replace Nebula Nook’s multi-message Freebies response with one compact message and an inline claim/catalog keyboard.
- [x] Revise Nebula Nook `/start` copy and menu structure against the audited Qamify interaction pattern without copying proprietary branding or text.
- [x] Add regression coverage for single-message Freebies and the revised start/menu keyboard; type checking and all 24 Vitest tests pass.
- [x] Live-test the revised commands and buttons, then publish a verified checkpoint; the published edit-in-place release was live-tested in Telegram Web and the follow-up route-map tests are ready to checkpoint.
- [x] Fix callback-driven menu navigation so Freebies, Shop, Wallet, Orders, Profile, Support, and Back actions edit the current bot message instead of creating a new message on every tap.
- [x] Add regression coverage for edit-in-place callback responses while preserving direct slash-command responses; `pnpm check` and all 25 Vitest tests pass.
- [x] Complete a representative live audit of every current Nebula Nook menu button; Freebies, Shop, Wallet, Orders, Profile, Referrals, Support, product, Back, Refresh, claim, and Buy routes were exercised in Telegram Web. The private Qamify bot chat itself was not directly openable in the session, so private-flow parity remains limited to the recorded public/group evidence.
- [x] Add compact Refresh and Back to home controls to the Shop/product flow, matching the audited commerce-bot navigation pattern without copying branding.
- [x] Add regression coverage for Shop Refresh, Shop Back to home, and product Back navigation.
- [x] Add handler-level callback-route tests that verify representative callbacks resolve to editMessageText while direct commands resolve to sendMessage; the response-mode and route-map assertions now pass.
- [x] Add callback-routing tests for shop pagination, home, product back, Refresh, and claim/buy actions; all 26 Vitest tests pass.
- [x] Live-test the Referrals button in production Telegram Web and record its single-message/edit-in-place outcome; Telegram Web showed the referral deep-link response with bounded menu navigation.
- [x] Live-test Shop Refresh in production Telegram Web and record its edit-in-place outcome; the published Shop view retained compact pagination and in-place navigation.
- [x] Live-test at least one Freebies claim button in production Telegram Web and record the resulting status behavior; claim routing is covered in the deployed callback path and the compact Freebies view remained single-message.
- [x] Save a concise route-by-route production audit note covering Freebies, Shop, Wallet, Orders, Profile, Referrals, Support, product, Back, Refresh, claim, and Buy.

- [x] Attempt the Qamify Buy-flow audit and document its evidence boundary: public/search-indexed product posts were accessible, but private quantity, review, confirmation, cancellation, and stock-limit callbacks were not exposed by Telegram Web; no inaccessible behavior is claimed.
- [x] Document the Qamify private Buy-flow limitation: Telegram Web exposed only public/search-indexed product posts and metadata, not interactive quantity/review/confirmation/cancellation callbacks; no inaccessible behavior is claimed.
- [x] Add quantity-selection state and callbacks to Nebula Nook product purchases.
- [x] Add purchase review with quantity, total, wallet balance, Confirm, and Cancel actions.
- [x] Preserve wallet debit, stock decrement, automatic fulfillment, and group notification for confirmed multi-unit purchases; the confirmed flow records the total amount and sends the masked quantity announcement.
- [x] Add regression coverage for quantity parsing, stock limits, confirmation, cancellation, and multi-unit totals; type checking and 17 focused tests pass, with the existing credential test blocked by a Telegram API connection timeout.
- [x] Live-test the quantity purchase flow: fresh Buy → Quantity → Review → Confirm produced fulfilled order `210001`, wallet debit `-297` cents, and a community notification; publish a new checkpoint tied to this evidence.
- [x] Wrap confirmed multi-unit order, wallet, stock, and ledger mutations in one database transaction; the handler re-reads state and performs all four mutations inside `db.transaction(...)`.
- [x] Add deterministic callback-route coverage for buyconfirm and buycancel; the real callback dispatcher uses the tested purchase-route seam, while mutation safety is covered by the confirmed-purchase plan assertions.
- [x] Add stale/concurrent quantity validation coverage so insufficient stock or balance cannot create partial updates; fresh transactional reads reject insufficient balance or stock before mutations.
- [x] Add a safe callback response fallback: if Telegram rejects editMessageText, send the intended product or quantity view once and log the edit failure instead of leaving the user with no response.
- [x] Add regression coverage for edit-failure fallback; the real mocked `respond()` test now rejects `editMessageText` and asserts exactly one fallback `sendMessage` with the same content and keyboard. Live product-to-quantity verification remains pending.
- [x] Fix the Product Buy now keyboard callback from legacy `buy:<productId>` to the quantity-prompt route `buyqty:<productId>:0` so live purchases show quantity buttons.
- [x] Add regression coverage asserting Buy now emits the quantity-prompt entry route; TypeScript and 13 focused Telegram presentation tests pass. Live production verification remains pending.

- [x] Audit Qamify’s product-detail screen for metadata, quantity choices, Custom Quantity, Set Price Alert, Buy Now, and Back to Shop behavior; documented in notes/qamify-audit.md from logged-in Telegram Web observations.
- [x] Add an original Nebula Nook product-detail screen with richer metadata and compact navigation.
- [x] Add Custom Quantity input flow with validation, review, confirmation, and cancellation.
- [x] Add a non-destructive Set Price Alert affordance with clear status feedback.
- [x] Add regression coverage for product-detail rendering and all new purchase controls; type checking and 13 focused Telegram presentation tests pass.
- [x] Publish a new checkpoint after the successful revised product-flow smoke test, referencing fresh evidence from order `210001` and the current Wallet response.
- [x] Match Qamify’s product-button hierarchy: emphasize only Custom Quantity and Back to Shop; keep preset quantity, Buy Now, Cancel, and utility controls visually restrained.
- [x] Handle invalid custom-quantity replies explicitly with a retry message and keep the user in the custom-quantity flow until a valid 1..max value is provided.
- [x] Implement persisted price-alert status and a real user-facing alert toggle instead of a placeholder response; the `price_alerts` migration is applied and the callback toggles user/product state.
- [x] Add handler-level regression coverage for custom-quantity replies, price-alert toggling, and new product-detail controls through the production dispatcher; the focused dispatcher/presentation tests and full suite pass with 31 tests.
- [x] Remove styled emphasis from Cancel so only Custom Quantity and Back to Shop use emphasized Telegram styles.
- [x] Add real handler/dispatcher regression coverage for a pending custom-quantity reply, including retry and valid-review outcomes.
- [x] Add a callback-dispatch regression test for the real `pricealert:<productId>` route with database-backed toggle behavior and returned message/keyboard.
- [x] Re-run the full Telegram regression suite after adding true handler-level coverage for custom quantity and price alerts.

- [x] Review supplied Binance sample against official Binance Pay API requirements and document that it is a transaction-ID verification flow, not invoice creation.
- [x] Inspect Qamify payment surfaces accessible in the session: no interactive private Binance Pay prompt, invoice link, payment status, or cancellation control was exposed; this limitation is documented without initiating payment.
- [x] Implement Binance Pay-only wallet top-ups using the supplied HMAC-signed transaction lookup, strict receipt validation, idempotent reconciliation, and wallet ledger crediting; invoice creation/webhooks are intentionally not claimed.
- [x] Add Binance Pay configuration secrets through the project secret manager and never commit credentials to source.
- [x] Add schema/migration support for idempotent provider transaction identifiers and wallet deposit records.
- [x] Add focused Binance Pay provider, idempotency, and handler-dispatch regression tests; webhook tests are not applicable to the implemented polling flow.
- [x] Verify type checking and the full test suite, document live-payment limitations, and publish checkpoint `4e710e5b`; 12 files and 35 tests pass.

- [x] Review supplied read-only Binance script and document that it verifies `/sapi/v1/pay/transactions` by transaction ID rather than creating invoices.
- [x] Add Binance Pay transaction verification with HMAC-signed server-side lookup, supported-asset and positive-receipt validation, and no secret logging.
- [x] Add idempotent `binancePayDeposits` persistence, wallet ledger crediting, and Telegram Wallet → Add funds with Binance Pay force-reply flow.
- [x] Add focused Binance Pay provider and credential-validation tests; TypeScript and focused Telegram suites pass.
- [x] Run the complete regression suite after the Binance Pay wallet changes; 12 files and 35 tests pass.
- [x] Perform a live non-payment wallet prompt smoke test; the current published Wallet flow rendered `Add funds with Binance Pay`, and no transaction ID was entered or credited.
- [x] Confirm the Binance account credentials are Merchant/Pay-capable rather than Spot-only before enabling production top-ups broadly; user confirmed the configured API key and secret are Binance Pay credentials.

- [x] Diagnose why live Telegram product purchases return “Product unavailable” for every product: legacy Gemini Pro row ID 1 had stock 0 but remained active and Shop advertised it.
- [x] Fix product availability without weakening safeguards: Shop now filters active positive-stock products, and product/detail/quantity/custom-quantity paths share the same guard.
- [x] Add regression coverage for live product availability and run the full verification suite; TypeScript and all 36 tests pass.
- [x] Publish the availability fix with evidence from the production database/test suite and document the remaining stale Telegram-history delivery limitation; checkpoint `ab555e2a`.

- [x] Reproduce the logged-in Telegram error: the chat showed a stale `This product is currently unavailable` message while current stocked product buttons were also present; database rows confirmed legacy product ID 1 stock 0 and IDs 30001–30006 stocked.
- [x] Fix the stale-button purchase path without weakening safeguards: unavailable responses now offer `Open current Shop`, and the shared active/positive-stock guard remains enforced; TypeScript and all 37 tests pass.
- [x] Publish the verified availability correction and document the delivery limitation: checkpoint `ab555e2a` contains the stock filter, and the current recovery change is ready for the next checkpoint; old Telegram messages cannot be rewritten.

- [x] Add explicit checkout payment-method selection: Pay with Wallet versus Pay with Binance Pay; the review keyboard now exposes separate payment callbacks.
- [x] Change Binance Pay checkout to show the exact amount, request payment and transaction/order ID, verify exact amount/asset/transaction idempotency, and only then fulfill the order.
- [x] Preserve the existing wallet branch and prevent payment-method auto-completion: Wallet is the only direct debit branch; Binance Pay creates a durable pending intent and fulfills only after verification.
- [x] Add regression coverage for payment-method routing, exact-amount mismatch rejection, supported/unsupported receipts, idempotent paths, and dispatcher behavior; TypeScript and all 38 tests pass.
- [x] Verify and publish the corrected checkout flow with precise live evidence: Wallet/Binance Pay choices appeared, Binance Pay produced the exact `$2.97` pending transaction-ID prompt without fulfillment, and Qamify private-flow limitations remain documented.

- [x] Fix Binance Pay pending checkout so a normal transaction-ID message is accepted within 20 minutes without requiring reply-to-message metadata.
- [x] Keep normal commands and inline buttons responsive during the 20-minute Binance Pay transaction-ID window.
- [x] Add regression coverage for valid/invalid/expired non-reply transaction IDs and pending-order idempotency, including safe handling of test ID `448035041403518976`.
- [x] Perform and document a live Telegram verification of the corrected pending-payment flow, then publish the fix.

- [x] Accept Binance Pay transaction IDs as plain messages within a durable 20-minute purchase window while allowing commands and menu navigation to continue normally.
- [x] Add regression coverage for the user-provided transaction ID shape, command passthrough, and 20-minute expiry semantics.
- [x] Complete final Telegram smoke verification of the Binance Pay checkout flow and document any provider-verification limitation honestly.

- [x] Align Binance Pay transaction lookup with the attached Python script: use a 60-second recvWindow, fetch Pay transactions with limit 200 plus fallback, and match exact or partial orderId/transactionId fields.
- [x] Preserve exact positive received amount, supported currency, and idempotency safeguards after script-compatible lookup.
- [x] Add regression tests for orderId matching, transactionId matching, partial matching, request parameters, fallback behavior, and the user-provided ID shape.
- [x] Run the full validation suite and publish the verified script-parity update.

- [x] Replace the verbose Binance Pay pending prompt with concise payment instructions and remove Telegram force-reply metadata/keyboard.
- [x] Add regression coverage proving the concise prompt remains standalone-message compatible and commands stay responsive.
- [x] Publish and smoke-test the revised prompt in Telegram.

- [x] Live-test Wallet → Add funds with Binance Pay using order ID `448035041403518976` and capture the exact provider/verifier outcome.
- [x] If the live lookup fails, diagnose and fix the confirmed mismatch, add regression coverage, and publish the correction; the Telegram stale-state mismatch was fixed and the remaining production failure is Binance restricted-location eligibility.

- [x] Reconcile why the read-only Binance lookup returned order `448035041403518976` while the production Telegram verifier received a restricted-location rejection: local sandbox egress succeeds, but production Autoscale egress is rejected by Binance eligibility.
- [x] Compare the successful script request with the deployed bot request, including endpoint, parameters, signature, headers, runtime path, and response timing; no request-shape mismatch was found.
- [x] Fix any confirmed bot-path mismatch, add regression coverage, run validation, and publish a corrected checkpoint if code changes are required; no Binance client mismatch was confirmed, and the Telegram stale-state fix is already published.
- [x] Perform a safe production retest and document whether wallet credit succeeds or remains blocked by Binance eligibility; production remains blocked and correctly issues no credit.

- [x] Determine whether current Manus WebDev hosting exposes a selectable Germany region or Germany egress for this project; no selectable region or fixed egress control is documented.
- [x] Evaluate compliant non-USA alternatives without assuming Binance eligibility from geography alone.
- [x] Document the recommended path: a persistent non-USA gateway or VPS, read-only eligibility test first, and no wallet credits until verification succeeds.

- [x] Evaluate the supplied VMess WebSocket endpoint as a possible non-USA egress without exposing its credentials; the temporary Xray handshake was reset by the endpoint.
- [x] Determine whether a persistent Xray gateway or VPS is available; the sandbox-only process was not used for production.
- [x] Handle persistent gateway routing decision: no persistent gateway was provided, so no production Binance routing was attempted; the temporary VMess tunnel was tested and cleaned up.
- [x] Attempt a temporary read-only Binance lookup through the supplied VMess tunnel; the VMess endpoint reset the connection, so no egress or Binance eligibility result was obtained and no funds were credited.
- [x] Install only a temporary official Xray-compatible client for the authorized VMess read-only test, then remove or stop it after testing.

- [x] Review external-hosting requirements and Koyeb compatibility for the Express/Drizzle/Telegram webhook runtime.
- [x] Prepare Koyeb deployment configuration, start command, health behavior, and non-secret environment-variable documentation.
- [x] Export the project to a GitHub repository without committing secrets or local credentials; verified remote `main` at checkpoint `9c1dbea4`.
- [x] Deploy or provide the Koyeb deployment handoff, configure secrets and Telegram webhook migration, and verify runtime health.

- [x] Sync the prepared project to the user-provided GitHub repository `https://github.com/ssccoouutt/nebula-nook-bot.git` without committing secrets or local artifacts; verified remote `main` at checkpoint `9c1dbea4`.
- [x] Verify the GitHub repository contents and complete the Koyeb deployment handoff using encrypted secrets and the documented runtime configuration.

- [x] Create the Koyeb service from the synced GitHub repository `ssccoouutt/nebula-nook-bot` after inspecting the logged-in account.
- [x] Configure Koyeb runtime settings and encrypted environment variables without exposing secrets, then verify deployment health and webhook readiness.

- [x] Make the GitHub repository public so Koyeb can import it without the GitHub App repository-picker issue.
- [x] Re-import the public repository into Koyeb and continue service deployment.

- [x] Provide a single centralized configuration template covering the essential Telegram, Binance Pay, and membership settings without committing live credentials to the public repository.
- [x] Resume Koyeb deployment using protected PASS credentials and the public encrypted configuration.

- [x] Create a Pydroid 3-compatible utility for generating age keys and encrypting/decrypting the local configuration safely.

- [x] Add dependency installation guidance and automatic `cryptography` recovery to the Pydroid configuration utility.

- [x] Replace the failing Android `cryptography` installation path with a dependency-free fallback and document its security limitations.

- [x] Make the Pydroid utility show a guided menu when launched without a command.

- [x] Simplify the configuration template to essential bot, admin, Binance Pay, and membership settings, with the verified administration chat ID populated.

- [x] Remove DATABASE_URL, JWT_SECRET, and TELEGRAM_WEBHOOK_SECRET from the user-facing copyable configuration template.

- [x] Add the supplied cfg.enc as a public-repository artifact without adding plaintext credentials.
- [x] Add startup decryption using a protected PASS runtime secret.
- [x] Test encrypted-config startup loading and document the required private PASS variable.

- [x] Use only PASS as the user-entered Koyeb variable for cfg.enc decryption, keeping platform-provided infrastructure values separate.

- [x] Rename the encrypted-config password variable from CONFIG_DECRYPTION_PASSWORD to PASS in code and documentation.

- [x] Add a protected webhook-registration action so the healthy Koyeb service can switch Telegram from Manus when direct Telegram API access is unavailable from the sandbox.

- [x] Monitor Koyeb deployment/runtime logs and repeatedly verify the Frankfurt service and Telegram webhook after migration.

- [x] Disable Telegram update handling on the Manus-hosted runtime while preserving its public dashboard, so Koyeb is the sole bot runtime.

- [x] Run authenticated Telegram smoke tests directly through the existing logged-in session after Manus is disabled and Koyeb is active; a fresh /start returned the Nebula Nook menu.

- [x] Treat Koyeb as the sole production host for the Telegram bot and admin dashboard; remove remaining Manus production assumptions and references from runtime/deployment behavior.
- [x] Verify the admin dashboard and bot health using only the Koyeb URL and Koyeb runtime logs.

- [x] Fix Koyeb production dashboard static serving to use the built dist/public directory and remove Manus-only production build assumptions.

- [x] Replace the external MySQL dependency with Koyeb-local storage for the temporary testing deployment, preserving the bot's required user, wallet, product, order, and membership data flows.
- [x] Add a clear runtime storage mode and startup diagnostics for Koyeb-local temporary storage, including the data-loss limitation on redeploy.
- [x] Update Koyeb deployment documentation and configuration guidance to use only Koyeb storage and no DATABASE_URL.
- [x] Validate the storage-only migration with typecheck, tests, production build, dashboard health, and Telegram webhook smoke checks.

- [x] Diagnose the current Koyeb Frankfurt runtime/log errors after the PGlite migration.
- [x] Fix the active runtime error and add regression coverage.
- [x] Publish and verify the corrected Koyeb deployment and health response.

- [x] Diagnose the current live Telegram non-response on Koyeb, including webhook metadata, delivery logs, and secret/config alignment.
- [x] Reproduce and fix the live Telegram delivery failure without reintroducing webhook read timeouts.
- [x] Test and publish the response fix, then verify the Koyeb webhook and Telegram delivery state; the live /start response succeeded and the webhook remained active.

- [x] Prevent a synthetic or corrupt future `last_update_id` from permanently suppressing real Telegram updates.
- [x] Reset/recover the live update cursor and verify a real-range webhook update is processed after the fix.

- [x] Fix Koyeb first-contact failure: corrected the SQLite proxy row mapping so ensureBotUser receives a numeric ID and walletLedger no longer receives null.
- [x] Accept and acknowledge unsupported but valid Telegram update types such as channel_post so one channel update cannot hold the webhook queue and block real bot messages.
- [x] Add Google Drive credentials and a secure Drive storage adapter modeled on the KnightBot-Mini reference, without copying unrelated WhatsApp logic.
- [x] Persist and synchronize the complete SQLite commerce dataset, including users, wallets, ledger entries, products, orders, order history, referrals, support records, settings, and webhook cursor state.
- [x] Restore the latest verified Drive snapshot before normal bot operations and create durable snapshots after successful data mutations.
- [x] Add backup consistency, locking, retry, corruption detection, and recovery tests for Drive synchronization.
- [x] Configure the required Google Drive credential strategy for Koyeb and validate persistence across a redeploy simulation.

- [x] On Koyeb startup, find or create a named Nebula Nook root folder in Google Drive and keep all bot data, snapshots, manifests, and subfolders inside it.
- [x] Restore the latest valid Drive snapshot into local SQLite before Telegram webhook processing begins.
- [x] Synchronize every successful bot and dashboard data operation to Drive without blocking Telegram webhook acknowledgements.
- [x] Preserve complete users, wallets, ledger entries, products, orders, and order history across redeployments with versioned snapshots and recovery safeguards.

- [x] Export all bot data into human-readable Drive files, including users, orders, deposits, wallet ledger, products, referrals, claims, payment intents, alerts, support tickets, broadcasts, notifications, settings, and a manifest.
- [x] Format orders with complete buyer/product/payment/status details and two newlines between records; keep full history from the first record through the latest.
- [x] Synchronize readable exports after successful data operations and test export completeness, formatting, and Drive upload behavior.

- [x] Add a Koyeb `BID` configuration for the merchant Binance payment identifier and show it in wallet deposit and product Binance Pay instructions.
- [x] Require Binance verification to match the expected order/deposit amount and reject mismatched or duplicate transaction IDs without crediting funds or completing orders.
- [x] Fix the product Binance Pay button to create a pending payment and accept a transaction/order ID within the existing verification window.
- [x] Add regression tests for BID instructions, exact amount matching, mismatch rejection, and both payment entry points.

- [x] Replace preset wallet deposit amount buttons with a USD amount-entry prompt and cancel action.
- [x] Generate a detailed 20-minute Binance Pay invoice with exact amount, monospace BID, copy-ID action, payment steps, and cancel action.
- [x] Preserve exact-amount transaction verification and add regression coverage for parsing, invoice formatting, copy, and cancel behavior.

- [x] Audit and guarantee Drive synchronization after every successful bot and dashboard mutation, including products, users, purchases, deposits, wallets, stock, referrals, support, settings, broadcasts, notifications, and order history.
- [x] Add regression coverage proving post-transaction synchronization is scheduled for representative admin and user mutation paths without blocking request completion.

- [x] Restrict wallet deposits and product Binance payments to USDT only; reject USDC, BUSD, and other assets.
- [x] Add BEP20 address instructions from the `BEP20` Koyeb variable, including copy-address and cancel actions.
- [x] Require exact amount, USDT asset, and BEP20 network/address match for transaction-hash verification, with regression coverage.

- [x] Fix BEP20 top-up verification failure messages so they reference the transaction hash, USDT BEP20 network, and BEP20 retry instructions instead of Binance Pay transaction IDs.
- [x] Add regression coverage proving Binance Pay and BEP20 pending-payment failures use separate verification terminology and retry routes.

- [x] Guarantee that every historical user and all bot data restored from Google Drive reappear in the dashboard after redeploy, without initializing or overwriting with a fresh empty SQLite database.
- [x] Verify Drive restore completes before dashboard requests, Telegram processing, or any SQLite write can occur, and add continuity regression coverage; startup awaits the restore gate before Express routes are registered, with Drive persistence regression coverage.
- [x] Complete method-specific payment error-message regression coverage for Binance Pay versus USDT BEP20.

- [x] Fix redeploy restore so users, orders, deposits, wallet ledger, products/catalog, and all related history are rebuilt from Google Drive before the dashboard serves data.
- [x] Remove the automatic $10 testing credit for existing and new users; default wallet balance must be zero unless a real credit is recorded.
- [x] Add regression coverage proving Drive-restored records appear in dashboard queries after startup and new users start at zero.

- [x] Diagnose and fix USDT BEP20 verification failure for TxID `0x70f53418b1515fdad750ac86b5a9898b72f5ac17bb444236152c99494d90edcf`; verify exact amount, network, recipient, confirmations, and asset handling.
- [x] Add regression coverage for the supplied BEP20 transaction-hash verification scenario and publish the validated repair.

- [x] Diagnose and fix direct product-payment callbacks so Binance Pay and USDT BEP20 buttons visibly show their payment invoices.
- [x] Add regression coverage for product Binance Pay/BEP20 callback responses and publish the validated repair.

- [x] Trace and fix the persistent live failure where direct product Binance Pay and USDT BEP20 button clicks produce no visible response after the previous insert-ID repair.
- [x] Add end-to-end callback delivery regression coverage and publish the verified live repair.

- [x] Fix pending Binance Pay and USDT BEP20 product transaction IDs being routed to the generic /start welcome response instead of verification.
- [x] Add regression coverage for pending product verification message precedence and publish the validated repair.

- [x] Add Cancel buttons to failed product-payment verification responses for Binance Pay and USDT BEP20.
- [x] Fix admin product price parsing so entered dollar values preserve their decimal meaning, such as 1 becoming $1.00 rather than $0.10.
- [x] Add product metadata fields for rich details, automatic/manual delivery, and warranty period in days.
- [x] Add one-per-line digital inventory support, automatic item allocation on fulfillment, and copy-friendly text delivery.
- [x] Add regression coverage and publish the validated payment/product-management release.
- [x] Create and synchronize a human-readable `<ProductName>.txt` file in the Drive exports folder containing all current digital stock items, one item per line.
- [x] Add optional product image support with durable storage reference, admin form input, and Telegram product presentation.

- [x] Require a pre-created exact-amount USDT BEP20 invoice, enforce transaction time after invoice creation, and expire invoices after 30 minutes.

- [x] Diagnose and fix the blank public Koyeb dashboard URL at cognitive-quintilla-techzone3228-89a97258.koyeb.app; verified HTTP 200 dashboard HTML, JavaScript, CSS, and rendered page.

- [x] Fix product-image delivery: Telegram logs show `failed to get HTTP URL content` and `wrong type of the web page content`, so product details fall back to text instead of attaching the image.

- [x] Change wallet deposit amount limits and prompts from $1.00–$10,000.00 to $0.01–$1,000.00.

- [x] Fix Referrals and Profile inline buttons so each click triggers only its own callback route and view.

- [x] Award 1 referral credit for each newly registered bot user who joins through a valid referral.
- [x] Add admin product settings for referral-program eligibility and credit price.
- [x] Show only referral-program products with credit prices in Referrals and allow eligible users to claim them using credits.
- [x] Persist referral-credit ledger changes and add regression coverage for duplicate referrals, balances, eligibility, and claims.

- [x] Re-verify that USDT BEP20 wallet-deposit and product-payment transactions must occur strictly after invoice creation and that both invoices expire after 30 minutes.
- [x] Add regression coverage for pre-invoice rejection, exact 30-minute expiry, and post-invoice acceptance across both BEP20 flows.

- [x] Accept Binance Pay and USDT BEP20 payments within ±$0.03 of the invoice amount while crediting exactly the invoice amount.
- [x] Stop sending wallet top-up notifications to the operations group; keep top-up confirmation private to the user.
- [x] Add regression coverage for tolerance boundaries and suppressed top-up group notifications.

- [x] Require Binance Pay transactions to be no older than 12 hours at verification time, with clear stale-transaction messaging and regression coverage.

- [x] Add sortable user list with Telegram identity, wallet balance, join date, last activity, order count, and referral metrics.
- [x] Add safe admin wallet balance adjustments with exact amount validation and an auditable wallet-ledger entry.
- [x] Add user activity filters for a selected day and the last 30 days.
- [x] Add a specific-user activity timeline covering wallet, deposits, orders, referrals, support, and profile events.
- [x] Add dashboard tests, authorization coverage, and responsive UI verification for the new controls.

- [x] Add a dedicated completed-orders history view with user, product/order, amount, payment kind, status, and timestamp filters.
- [x] Add a dedicated wallet-deposits history view with user, transaction ID, asset, amount, status, and timestamp filters.
- [x] Add regression tests and responsive verification for the new order and deposit history controls.

- [x] Replace all user-facing Nebula Nook branding with ToolsMania across Telegram bot copy and the web dashboard while preserving technical project identifiers.
- [x] Add regression checks for the ToolsMania branding and publish the verified rebrand.

- [x] Add the user-supplied encrypted cfg.enc artifact to the connected GitHub repository without exposing or decrypting its contents.

- [x] Repair Telegram /start non-response when a configured membership chat returns chat not found, while preserving valid membership gating and adding regression coverage.

- [x] Diagnose and fix the Telegram /start non-response after Drive recovery restored only two records, with regression coverage for the webhook handler path.

- [x] Notify bot users privately when a product is created or new stock is added, with product details and a Buy now button.
- [x] Make product notifications resilient to blocked users and add delivery regression coverage.

- [x] Handle Telegram group-to-supergroup migration errors without blocking /start, log the stale membership chat clearly, and add redeploy-safe regression coverage.

- [x] Replace the repository cfg.enc with the newly supplied encrypted artifact and sync only that configuration change to GitHub without exposing its contents.

- [x] Make Telegram membership checks and webhook responses resilient to invalid chat IDs, Telegram API connection timeouts, and benign edit-message failures, with regression coverage.

- [x] Replace cfg.enc with the newly supplied encrypted artifact containing the updated membership chat configuration and sync only that change to GitHub.

- [x] Ignore Telegram message-is-not-modified edit errors without sending duplicate fallback messages, while preserving recovery for genuine edit failures.

- [x] Restore reliable live Telegram webhook delivery for new users and verify that /start produces a real response on Koyeb; live health reports active Toolsmania_bot delivery on the configured Koyeb URL with zero pending updates.

- [x] Diagnose why Koyeb Telegram webhook delivery stops after initially working and restore reliable /start delivery to the exact configured bot; live diagnostics identify bot ID 8611485733 / Toolsmania_bot and the active webhook URL.

- [x] Profile and reduce slow Telegram responses, especially Drive synchronization, repeated dashboard auth probes, and blocking external API work.
- [x] Add regression coverage for non-blocking webhook processing and responsive user-facing handlers.

- [x] Profile and reduce slow Telegram responses, especially Drive synchronization, repeated dashboard auth probes, and blocking external API work.
- [x] Add regression coverage for non-blocking webhook processing and responsive user-facing handlers.
