import { describe, expect, it } from "vitest";

const allowedTelegramSecret = /^[A-Za-z0-9_-]{1,256}$/;
const publishedHealthUrl = "https://nebulabot-easgvwoj.manus.space/api/telegram/health";

describe("Telegram webhook secret", () => {
  it("uses Telegram-allowed characters", () => {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
    expect(secret).toMatch(allowedTelegramSecret);
  });

  it("reaches the published Telegram health endpoint with the configured secret header", async () => {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
    const response = await fetch(publishedHealthUrl, {
      headers: { "X-Telegram-Bot-Api-Secret-Token": secret },
    });
    expect(response.status).toBe(200);
  }, 15_000);
});
