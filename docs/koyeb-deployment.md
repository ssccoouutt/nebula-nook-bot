# Nebula Nook Koyeb deployment

This project can run as a single Koyeb web service using the existing Node/Express production bundle. Koyeb should build the frontend and server bundle, then start `dist/index.js` through the repository `Procfile`.

## Service configuration

| Setting | Value |
|---|---|
| Service type | Web service |
| Build method | GitHub repository / Buildpack |
| Install command | `pnpm install --frozen-lockfile` |
| Build command | `pnpm build` |
| Run command | `pnpm start` |
| Listening port | Use Koyeb’s injected `PORT` environment variable |
| Health endpoint | `/api/telegram/webhook/health` |
| Webhook endpoint | `/api/telegram/webhook` |
| Persistent data | MySQL/TiDB through `DATABASE_URL`; do not use local files |

The server already reads `PORT`, serves the compiled Vite frontend in production, exposes the Telegram webhook health route, and keeps payment verification server-side. Koyeb must route HTTPS traffic to the web process and should use the health endpoint for service checks.

## Required secrets

Add the existing project secrets through Koyeb’s encrypted environment-variable settings. Never commit a `.env` file or paste secret values into GitHub.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | MySQL/TiDB application database |
| `JWT_SECRET` | Session/cookie signing |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API access |
| `TELEGRAM_WEBHOOK_SECRET` | Telegram webhook secret token; use only URL-safe characters |
| `TELEGRAM_ADMIN_CHAT_ID` | Telegram administration notifications |
| `BINANCE_PAY_API_KEY` | Server-side Binance Pay API key |
| `BINANCE_PAY_SECRET_KEY` | Server-side Binance Pay signing secret |
| `OWNER_OPEN_ID`, `OWNER_NAME` | Owner metadata |
| `VITE_APP_ID`, `VITE_APP_TITLE`, `VITE_APP_LOGO` | Application identity |
| `OAUTH_SERVER_URL`, `VITE_OAUTH_PORTAL_URL` | Manus OAuth configuration if retained |
| `BUILT_IN_FORGE_API_URL`, `BUILT_IN_FORGE_API_KEY` | Existing server-side platform integration if retained |
| `VITE_FRONTEND_FORGE_API_URL`, `VITE_FRONTEND_FORGE_API_KEY` | Existing frontend platform integration if retained |
| `VITE_ANALYTICS_ENDPOINT`, `VITE_ANALYTICS_WEBSITE_ID` | Existing analytics configuration if retained |

Koyeb should also provide `NODE_ENV=production`. The database schema must already exist in the target database; apply migrations through a controlled migration step rather than running destructive schema operations automatically during every service boot.

## Telegram webhook migration

After the Koyeb HTTPS domain is available, register the webhook at:

```text
https://<koyeb-domain>/api/telegram/webhook
```

Use Telegram’s `setWebhook` with the same bot token and the configured URL-safe secret token. Confirm the health endpoint first, then verify Telegram’s webhook status, then send `/start` in the bot. Do not leave both Manus and Koyeb webhooks active for the same bot.

## Binance Pay egress requirement

The production Binance Pay verifier is server-side and signs requests correctly, but the user’s observed production Autoscale egress was rejected by Binance while a non-USA test egress succeeded. Koyeb’s actual egress country and IP must be verified with a read-only Binance lookup before enabling wallet credits. Do not assume a Koyeb region alone guarantees eligibility; confirm the specific public IP and Binance account permissions.

## GitHub safety checklist

Before exporting, confirm that `.env*`, build output, logs, database files, temporary tunnel files, and project metadata are ignored. Review the staged file list for API keys, Telegram tokens, VMess links, and database URLs. The repository should be private unless the user explicitly chooses public visibility.
