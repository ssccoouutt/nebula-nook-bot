import { describe, expect, it } from "vitest";
import { validTelegramJoinUrl } from "./telegram";

describe("Telegram membership join links", () => {
  it("accepts private invite links", () => {
    expect(validTelegramJoinUrl("https://t.me/+hwT_8FtgDU85Mzlk")).toBe(true);
    expect(validTelegramJoinUrl("https://t.me/+4I-HIdE73NIyMzI8")).toBe(true);
  });

  it("accepts valid public username links", () => {
    expect(validTelegramJoinUrl("https://t.me/NebulaNook")).toBe(true);
  });

  it("rejects malformed or non-Telegram links", () => {
    expect(validTelegramJoinUrl("http://t.me/NebulaNook")).toBe(false);
    expect(validTelegramJoinUrl("https://example.com/join")).toBe(false);
    expect(validTelegramJoinUrl("https://t.me/")).toBe(false);
  });
});
