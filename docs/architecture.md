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

The webhook handler is designed for a single persistent WebDev process. The default Autoscale mode is not the correct production mode for an always-on bot process; publish using Reserved Hosting after the secrets are configured. Reserved Hosting is usage-based, with a full-utilization compute ceiling of approximately $37.50 per month before the included $10 monthly usage credit, plus metered egress.
