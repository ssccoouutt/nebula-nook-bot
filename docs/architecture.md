# Nebula Nook Bot Architecture

Nebula Nook is an original Telegram bot implementation with a comparable public interaction model to the inspected Qamify interface. It does not copy Qamify source code, private data, credentials, or branding.

## Runtime

The Express server exposes `POST /api/telegram/webhook`. Telegram sends updates to this route after the admin registers the webhook from the dashboard. The handler verifies the optional Telegram secret header, deduplicates update IDs through `botSettings`, applies lightweight per-user throttling, and routes commands and callback actions.

## Data

Drizzle/MySQL stores Telegram users, referrals, products, free claims, orders, wallet ledger entries, support tickets, broadcasts, runtime settings, and notification-delivery records. Membership IDs and invite URLs are read from `botSettings`, allowing the gate to change without a code change.

## Admin

The authenticated dashboard provides overview metrics, product creation/editing/archive controls, users, orders, wallet ledger, support tickets, broadcast queueing, runtime settings, and webhook registration. Only the authenticated `admin` role can call these procedures.

## Required secrets

`TELEGRAM_BOT_TOKEN` is the private BotFather token for `@NebulaNook4827_bot`. `TELEGRAM_ADMIN_CHAT_ID` is the Telegram chat ID that receives support, purchase, and free-claim notifications. `TELEGRAM_WEBHOOK_SECRET` is an optional random secret for Telegram webhook header verification. These values must be entered through the secure project secret form; they must not be extracted from Telegram Web or committed to source.

## Required runtime settings

Configure `membership_channel_id`, `membership_group_id`, `membership_channel_url`, and `membership_group_url` in the dashboard. Join URLs must be real public usernames or valid invite links, especially for private groups.

## Hosting

The project is prepared for the default free Autoscale hosting mode. The webhook endpoint remains available at `/api/telegram/webhook`, and an incoming Telegram update can wake the application to process that request. Autoscale is request-scoped, however, so it does not guarantee a continuously running 24/7 process. Background workers, scheduled broadcasts, and in-memory state may pause while the service is idle. Reserved Hosting is the appropriate upgrade when uninterrupted process execution is required, but this project intentionally remains on Autoscale to avoid paid hosting.

After publishing, use the authenticated admin dashboard’s **Settings → Register webhook** control to register the published HTTPS URL with Telegram. The bot token, admin chat ID, and webhook secret remain server-side environment variables and are never placed in client code.

## Public dashboard mode

The dashboard is intentionally available without sign-in at the user’s request. Consequently, dashboard queries and mutations—including product changes, settings changes, webhook registration, order fulfillment, and broadcast queueing—are publicly callable. This mode is suitable only for temporary or tightly restricted testing. Before production use, place the dashboard behind authentication, an access-controlled domain, or an equivalent network boundary. The Telegram bot token and webhook secret remain server-side and are never rendered in the dashboard.

Webhook registration uses the forwarded public host and returns Telegram’s webhook metadata. The dashboard displays either a verified registration result or the actual error message instead of silently appearing inactive.
