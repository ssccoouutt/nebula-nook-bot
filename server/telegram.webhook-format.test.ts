import { describe, expect, it } from "vitest";
import { validTelegramWebhookSecret } from "./telegram";

describe("Telegram webhook secret validation", () => {
  it("accepts Telegram-compatible alphanumeric, underscore, and hyphen secrets", () => {
    expect(validTelegramWebhookSecret("King100")).toBe("King100");
    expect(validTelegramWebhookSecret("safe_secret-2026")).toBe("safe_secret-2026");
  });

  it("rejects punctuation that Telegram does not allow", () => {
    expect(validTelegramWebhookSecret("nN7!qP4vZ2#Lm8@Tx6Rk9Wc3")).toBeUndefined();
    expect(validTelegramWebhookSecret("")).toBeUndefined();
    expect(validTelegramWebhookSecret(undefined)).toBeUndefined();
  });
});
