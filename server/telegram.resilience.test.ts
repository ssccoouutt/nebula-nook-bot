import { describe, expect, it } from "vitest";
import { recordTelegramFailure, telegramRuntimeDiagnostics } from "./telegram";

describe("Telegram resilience diagnostics", () => {
  it("retains the latest structured failure with route context", () => {
    const failure = recordTelegramFailure("webhook_update", new Error("message can't be edited"), {
      updateId: 991,
      updateType: "callback_query",
      chatId: 12345,
      messageId: 77,
      callbackData: "shop:next:2",
    });

    expect(failure.scope).toBe("webhook_update");
    expect(failure.message).toBe("message can't be edited");
    expect(failure.context).toMatchObject({ updateId: 991, updateType: "callback_query", chatId: 12345, messageId: 77 });
    expect(Number.isNaN(Date.parse(failure.at))).toBe(false);
    expect(telegramRuntimeDiagnostics().lastFailure).toEqual(failure);
  });

  it("normalizes non-Error rejection reasons into an inspectable failure", () => {
    const failure = recordTelegramFailure("unhandled_rejection", { code: "ETIMEDOUT" }, { process: 42 });

    expect(failure.message).toBe("[object Object]");
    expect(failure.context).toEqual({ process: 42 });
    expect(telegramRuntimeDiagnostics().lastFailure).toEqual(failure);
  });
});
