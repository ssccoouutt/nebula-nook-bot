import { describe, expect, it } from "vitest";
import { isTelegramChatNotFoundError, isTelegramTransientNetworkError, validTelegramJoinUrl } from "./telegram";

describe("Telegram membership join links", () => {
  it("recognizes deleted or mistyped membership chats without masking unrelated errors", () => {
    expect(isTelegramChatNotFoundError(new Error("Bad Request: chat not found"))).toBe(true);
    expect(isTelegramChatNotFoundError("chat not found")).toBe(true);
    expect(isTelegramChatNotFoundError(new Error("Bad Request: group chat was upgraded to a supergroup chat"))).toBe(true);
    expect(isTelegramChatNotFoundError(new Error("Forbidden: bot was kicked"))).toBe(false);
  });

  it("classifies transient Telegram network failures without masking unrelated errors", () => {
    expect(isTelegramTransientNetworkError(new TypeError("fetch failed", { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } }))).toBe(true);
    expect(isTelegramTransientNetworkError(new Error("The operation was aborted"))).toBe(true);
    expect(isTelegramTransientNetworkError(new Error("Forbidden: bot was kicked"))).toBe(false);
    expect(isTelegramTransientNetworkError(new Error("Bad Request: invalid chat_id"))).toBe(false);
  });

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
