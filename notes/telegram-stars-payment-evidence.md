# Telegram Stars payment evidence

Source: https://core.telegram.org/bots/payments-stars

Telegram's official Bot Payments API documentation states that digital goods and services must use currency `XTR` (Telegram Stars). A Stars invoice is sent with `sendInvoice`; digital-goods invoices may omit `provider_token`; the bot must answer `pre_checkout_query` within 10 seconds; and goods must only be delivered after receiving a `successful_payment` update. The successful payment includes a `telegram_payment_charge_id`, which should be stored for future refund/dispute handling.

Implementation decision: ToolsMania will use an internal conversion of 100 Stars = $120 equivalent, so `stars = round(usd * 100 / 120)` with a minimum of 1 Star. This is an application-defined conversion for the catalog display and is not a claim that Telegram's user acquisition price is fixed; Telegram notes that acquisition amounts can vary by user due to VAT and fees.
