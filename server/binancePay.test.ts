import { describe, expect, it } from "vitest";
import { buildBinanceSignedQuery, findBinancePayTransaction } from "./binancePay";

describe("Binance Pay transaction verification", () => {
  it("builds a timestamped HMAC query without exposing the secret in the query", () => {
    const query = buildBinanceSignedQuery({ transactionId: "TX-123456" }, "test-secret", 1700000000000);
    expect(query).toContain("transactionId=TX-123456");
    expect(query).toContain("timestamp=1700000000000");
    expect(query).toContain("recvWindow=5000");
    expect(query).toMatch(/signature=[a-f0-9]{64}$/);
    expect(query).not.toContain("test-secret");
  });

  it("accepts a matching positive supported-asset receipt", async () => {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({ data: [{ transactionId: "TX-123456", amount: "12.34", asset: "USDT", status: "SUCCESS" }] }), { status: 200 });
    const result = await findBinancePayTransaction("TX-123456", 1234, fetcher);
    expect(result).toMatchObject({ ok: true, amountCents: 1234, asset: "USDT" });
  });

  it("rejects missing, unsupported, and non-positive receipts", async () => {
    const missing: typeof fetch = async () => new Response(JSON.stringify({ data: [] }), { status: 200 });
    expect(await findBinancePayTransaction("TX-123456", undefined, missing)).toMatchObject({ ok: false, reason: "not_found" });

    const unsupported: typeof fetch = async () => new Response(JSON.stringify({ data: [{ transactionId: "TX-123456", amount: "1", asset: "BTC" }] }), { status: 200 });
    expect(await findBinancePayTransaction("TX-123456", undefined, unsupported)).toMatchObject({ ok: false, reason: "unsupported_asset" });

    const negative: typeof fetch = async () => new Response(JSON.stringify({ data: [{ transactionId: "TX-123456", amount: "-1", asset: "USDT" }] }), { status: 200 });
    expect(await findBinancePayTransaction("TX-123456", undefined, negative)).toMatchObject({ ok: false, reason: "not_received" });
  });

  it("rejects a receipt whose amount differs from the pending checkout total", async () => {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({ data: [{ transactionId: "TX-123456", amount: "12.34", asset: "USDT", status: "SUCCESS" }] }), { status: 200 });
    expect(await findBinancePayTransaction("TX-123456", 1235, fetcher)).toMatchObject({ ok: false, reason: "amount_mismatch" });
  });
});
