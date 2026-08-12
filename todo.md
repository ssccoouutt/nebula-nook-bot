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
- [ ] Add Telegram Bot API 10.2-compatible predefined button styles to Nebula Nook keyboards and verify the live rendering in Telegram Web.
- [x] Document representative Qamify button-type evidence: URL, callback-style, and whether any inspected control launches a Web App; record any limits of Telegram Web DOM evidence.
