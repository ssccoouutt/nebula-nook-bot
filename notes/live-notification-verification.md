# Live notification verification

On Aug 12, 2026, the published dashboard order #1 was reset to `paid` for a controlled test and then marked `fulfilled` through the live Orders tab. The Telegram Web session for `Nebula Nook Community` (chat ID `-5036785892`) visibly shows the bot message:

`Orders #1 purchase — fulfilled — $0.01`

This confirms the completed-order notification reaches the configured operations group. The customer fulfillment DM path is also invoked by the same mutation; its failure is isolated so it cannot suppress the group notification.
