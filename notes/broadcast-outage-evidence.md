# Broadcast outage evidence

Source: user-provided attachment `/home/ubuntu/upload/pasted_content.txt`.

The attachment contains two `Forbidden: bot was blocked by the user` errors from `deliverBroadcast`, at `Promise.allSettled` indexes 13 and 4. The same stack shows the broadcast helper continued through the router mutation; there is no uncaught broadcast exception, process crash, restart, out-of-memory message, or webhook 5xx in the attachment. The reported result of 70 successful and 2 failed recipients is consistent with the code's `Promise.allSettled` delivery loop and expected blocked-user failures.

The attachment also contains Telegram callback errors: `there is no text in the message to edit`, `inline keyboard expected`, and `message can't be edited`. These occur in the older deployed response path whose log text says `editMessageText failed; falling back to one sendMessage`. The current source has a newer non-text-message guard and logs `editMessageText unavailable; sending a fresh response`, indicating the attached Koyeb build predates the latest callback patch or was not redeployed from it.

Webhook source review: `telegramWebhookHandler` acknowledges updates with HTTP 200 before asynchronously processing them, and wraps `processTelegramWebhookUpdate(update)` in `.catch(...)`; therefore a callback exception should be isolated to that update and should not terminate the Node process. The broadcast helper in `server/routers.ts` claims a queued row, sends recipients in batches of 20 via `Promise.allSettled`, counts fulfilled/rejected deliveries, then marks the broadcast completed. Blocked recipients are counted as failures and do not throw out of the broadcast mutation.

Current conclusion: the provided logs do not prove that the broadcast stopped the bot. They prove two expected blocked-user delivery failures and a separate older callback message-edit compatibility problem. The strongest confirmed explanation is that the deployed Koyeb revision still had the old response helper; the broadcast itself has no process-stopping error in the supplied evidence. A fresh Koyeb log after `/start` is needed to identify any additional current handler failure.
