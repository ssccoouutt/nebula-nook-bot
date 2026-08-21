# Telegram Stars invoice fix evidence

Official sources reviewed on 2026-08-21:

- https://core.telegram.org/bots/payments-stars
- https://core.telegram.org/bots/api#sendinvoice

Telegram's Stars documentation states that digital goods must use currency `XTR`, `sendInvoice`, `answerPreCheckoutQuery`, and `successful_payment`. For digital goods, `provider_token` may be an empty string. The Stars documentation also explains that `start_parameter` controls forwarding behavior; the current implementation passes `start_parameter: payload` while using a payload containing `toolsmania-stars:<intentId>`. Koyeb logs show the resulting API rejection: `Bad Request: START_PARAM_INVALID` from `sendInvoice` for callback `paystars:3:1`. The targeted fix is to omit `start_parameter` from Stars invoices and retain the order correlation in the invoice `payload` field.

The project currently stores product payment intents with a required product ID, so wallet Stars deposits should use a separate durable provider transaction record (or an equivalent schema extension) rather than pretending a wallet top-up is a product order. Wallet credit must be idempotent by Telegram payment charge ID and recorded in `walletLedger`.
