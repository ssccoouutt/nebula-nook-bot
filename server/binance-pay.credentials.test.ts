import { describe, expect, it } from "vitest";

const endpoint = "https://bpay.binanceapi.com/binancepay/openapi/certificates";

describe("Binance Pay credentials", () => {
  it("calls the merchant API endpoint without exposing credential values", async () => {
    const apiKey = process.env.BINANCE_PAY_API_KEY ?? "";
    const secretKey = process.env.BINANCE_PAY_SECRET_KEY ?? "";
    expect(apiKey, "BINANCE_PAY_API_KEY must be configured").toBeTruthy();
    expect(secretKey, "BINANCE_PAY_SECRET_KEY must be configured").toBeTruthy();

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "BinancePay-Certificate-SN": apiKey,
      },
      body: "{}",
    });

    expect(response.status).toBeLessThan(500);
    const payload = (await response.json()) as { code?: string; errorMessage?: string };
    expect(payload).toBeDefined();
  }, 15_000);
});
