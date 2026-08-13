# Google Drive persistence research

## Reference repository

Source: https://github.com/ssccoouutt/KnightBot-Mini

KnightBot-Mini is a WhatsApp/Baileys bot. Its `database.js` uses local JSON files for groups, users, warnings, and moderators, while delegating Google Drive persistence to `utils/driveStorage.js`. The Drive helper uses Axios and Google Drive v3 REST endpoints, caches an access token with an expiry, obtains token metadata from a configured token URL, refreshes expired OAuth tokens with client credentials and a refresh token, downloads JSON files, and uploads or updates files by Drive file ID. It also supports separate Drive JSON files for forwarding configurations and user data.

The reference package includes `googleapis` but the inspected helper primarily uses Axios against Drive REST endpoints. It hardcodes Drive file IDs and a token URL in configuration. That model must not be copied literally because it would expose provider-specific identifiers and would not preserve the relational SQLite dataset or atomic commerce transactions.

## Current Nebula Nook data model

The production database is a local Node 22 SQLite file on Koyeb, accessed through a Drizzle SQLite proxy. The schema currently includes: users, botUsers, botSettings, products, freeClaims, orders, walletLedger, binancePayDeposits, paymentIntents, referrals, priceAlerts, supportTickets, broadcasts, and notificationDeliveries. The webhook cursor is stored in `botSettings` under `last_update_id`.

Important mutation paths are in `server/telegram.ts`: user bootstrap, free claims, payment intents, fulfilled orders, stock decrement, Binance Pay deposits, wallet balance and ledger updates, price alerts, support tickets, notification deliveries, and cursor updates. The Drive design must snapshot all tables, not only users and orders, and must avoid syncing half of a transaction.

## Initial architecture implication

Use a versioned, authenticated snapshot envelope containing all SQLite tables and metadata, uploaded to a private Google Drive application folder. Write a new immutable snapshot after successful business mutations, and maintain a small manifest/current pointer. On startup, acquire a lock, compare local state with the latest verified snapshot, restore only when the local database is empty or explicitly behind, then resume normal webhook processing. Failed uploads must not fail the original commerce operation; they must queue a retry and expose sync health in the dashboard. A full snapshot is safer than one Drive file per table because it keeps relational consistency across tables and avoids partial cross-file updates.

Credentials must be supplied through secure Koyeb configuration. Do not place OAuth client secrets, refresh tokens, or access tokens in the public repository or in the encrypted snapshot. Google Drive operations must never permanently delete files; old snapshots should be retained or moved to trash only after explicit user approval.

## Official API findings

Google’s Drive API supports simple, multipart, and resumable uploads. For small JSON snapshots, multipart upload is appropriate; an existing file can be updated with `PATCH`, while resumable uploads are recommended for larger or interruption-prone files. Google documents OAuth 2.0 access tokens in the Authorization Bearer header and recommends a server-side OAuth client library for web-server applications. The Drive API can use a dedicated application folder so the app does not access the user’s entire Drive.

Sources: [Drive upload documentation](https://developers.google.com/workspace/drive/api/guides/manage-uploads), [Drive API overview](https://developers.google.com/workspace/drive/api/guides/about-sdk), [Google OAuth 2.0 web-server applications](https://developers.google.com/identity/protocols/oauth2/web-server).

The public KnightBot-Mini config also contains a long WhatsApp session string in source control. It must not be copied or reused. Its Drive token endpoint and file IDs are provider-specific configuration, not safe credentials for Nebula Nook.
