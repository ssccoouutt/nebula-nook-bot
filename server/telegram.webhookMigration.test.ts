import { describe, expect, it, vi } from "vitest";
import { telegramWebhookConfigure, telegramWebhookHandler, telegramWebhookHealth } from "./telegram";

function responseMock() {
  const response = {
    status: vi.fn(),
    json: vi.fn(),
  };
  response.status.mockReturnValue(response);
  return response;
}

describe("protected Koyeb webhook migration", () => {
  it("rejects a missing or incorrect PASS header", async () => {
    const originalPass = process.env.PASS;
    process.env.PASS = "test-pass";
    const res = responseMock();

    await telegramWebhookConfigure(
      { header: () => "wrong-pass" } as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ ok: false, error: "unauthorized" });
    if (originalPass === undefined) delete process.env.PASS;
    else process.env.PASS = originalPass;
  });

  it("rejects Telegram updates on the non-Koyeb Manus runtime", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalPort = process.env.PORT;
    process.env.NODE_ENV = "production";
    process.env.PORT = "3000";
    const res = responseMock();

    await telegramWebhookHandler({ body: {} } as never, res as never);

    expect(res.status).toHaveBeenCalledWith(410);
    expect(res.json).toHaveBeenCalledWith({ ok: false, error: "Telegram runtime moved to Koyeb" });
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalPort === undefined) delete process.env.PORT;
    else process.env.PORT = originalPort;
  });

  it("reports the non-Koyeb runtime as dashboard-only without calling Telegram", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalPort = process.env.PORT;
    process.env.NODE_ENV = "production";
    process.env.PORT = "3000";
    const res = responseMock();

    await telegramWebhookHealth({} as never, res as never);

    expect(res.json).toHaveBeenCalledWith({ ok: true, active: false, runtime: "manus-dashboard-only" });
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalPort === undefined) delete process.env.PORT;
    else process.env.PORT = originalPort;
  });

  it("does not enable the migration route in a non-Koyeb runtime", async () => {
    const originalPass = process.env.PASS;
    const originalNodeEnv = process.env.NODE_ENV;
    const originalPort = process.env.PORT;
    process.env.PASS = "test-pass";
    process.env.NODE_ENV = "test";
    process.env.PORT = "3000";
    const res = responseMock();

    await telegramWebhookConfigure(
      { header: () => "test-pass" } as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ ok: false, error: "Koyeb startup registration is not enabled in this runtime" });
    if (originalPass === undefined) delete process.env.PASS;
    else process.env.PASS = originalPass;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalPort === undefined) delete process.env.PORT;
    else process.env.PORT = originalPort;
  });
});

