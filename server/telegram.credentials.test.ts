import { describe, expect, it } from "vitest";

describe("Telegram credentials", () => {
  it("authenticates the configured bot token with getMe", async () => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    expect(token, "TELEGRAM_BOT_TOKEN must be configured").toBeTruthy();

    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const payload = (await response.json()) as { ok?: boolean; result?: { username?: string } };

    expect(response.ok).toBe(true);
    expect(payload.ok).toBe(true);
    expect(payload.result?.username).toBe("NebulaNook4827_bot");
  }, 15_000);
});
