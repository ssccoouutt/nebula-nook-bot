import { describe, expect, it } from "vitest";
import { TELEGRAM_UPDATE_ID_GUARD, shouldIgnoreTelegramUpdate } from "./telegram";

describe("Telegram update cursor safety", () => {
  it("ignores duplicate or older real update IDs", () => {
    expect(shouldIgnoreTelegramUpdate(100, 100)).toBe(true);
    expect(shouldIgnoreTelegramUpdate(100, 99)).toBe(true);
    expect(shouldIgnoreTelegramUpdate(100, 101)).toBe(false);
  });

  it("does not let a diagnostic future cursor suppress real updates", () => {
    expect(shouldIgnoreTelegramUpdate(2_147_483_000, 101)).toBe(false);
    expect(shouldIgnoreTelegramUpdate(TELEGRAM_UPDATE_ID_GUARD, 101)).toBe(false);
  });

  it("accepts an empty or malformed stored cursor", () => {
    expect(shouldIgnoreTelegramUpdate(undefined, 101)).toBe(false);
    expect(shouldIgnoreTelegramUpdate(Number.NaN, 101)).toBe(false);
  });
});

