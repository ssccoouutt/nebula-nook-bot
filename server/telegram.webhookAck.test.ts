import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  getDb: vi.fn(() => new Promise(() => undefined)),
}));

import { telegramWebhookHandler } from "./telegram";

describe("Telegram webhook acknowledgement", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("acknowledges before slow storage processing finishes", async () => {
    process.env.NODE_ENV = "production";
    process.env.PORT = "8000";
    process.env.PASS = "test-pass";
    delete process.env.TELEGRAM_WEBHOOK_SECRET;

    const json = vi.fn();
    const response = { status: vi.fn(() => response), json } as any;
    const request = {
      body: {
        update_id: 123,
        message: {
          message_id: 1,
          chat: { id: 9001, type: "private" },
          from: { id: 9001, first_name: "Test" },
          text: "/start",
        },
      },
      header: vi.fn(() => undefined),
    } as any;

    await telegramWebhookHandler(request, response);

    expect(json).toHaveBeenCalledWith({ ok: true });
    expect(response.status).not.toHaveBeenCalled();
  });

  it("acknowledges valid channel_post updates so they cannot block later bot messages", async () => {
    process.env.NODE_ENV = "production";
    process.env.PORT = "8000";
    process.env.PASS = "test-pass";
    delete process.env.TELEGRAM_WEBHOOK_SECRET;

    const json = vi.fn();
    const response = { status: vi.fn(() => response), json } as any;
    const request = {
      body: {
        update_id: 124,
        channel_post: {
          message_id: 2,
          chat: { id: -1004462190741, type: "channel" },
          text: "/start",
        },
      },
      header: vi.fn(() => undefined),
    } as any;

    await telegramWebhookHandler(request, response);

    expect(json).toHaveBeenCalledWith({ ok: true });
    expect(response.status).not.toHaveBeenCalled();
  });
});
