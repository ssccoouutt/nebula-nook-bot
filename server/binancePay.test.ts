import { describe, expect, it } from "vitest";
import { buildBinanceSignedQuery, findBinancePayTransaction } from "./binancePay";

describe("Binance Pay transaction verification", () => {
  it("builds the script-compatible timestamped HMAC query without exposing the secret", () => {
    const query = buildBinanceSignedQuery({ limit: 200 }, "test-secret", 1700000000000);
    expect(query).toContain("limit=200");
    expect(query).toContain("timestamp=1700000000000");
    expect(query).toContain("recvWindow=60000");
    expect(query).toMatch(/signature=[a-f0-9]{64}$/);
    expect(query).not.toContain("test-secret");
  });

  it("fetches up to 200 Pay transactions and matches an exact transactionId", async () => {
    let requestedUrl = "";
    const fetcher: typeof fetch = async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({ data: [{ transactionId: "TX-123456", amount: "12.34", currency: "USDT", status: "SUCCESS" }] }), { status: 200 });
    };
    const result = await findBinancePayTransaction("TX-123456", 1234, fetcher);
    expect(result).toMatchObject({ ok: true, amountCents: 1234, asset: "USDT" });
    const params = new URL(requestedUrl).searchParams;
    expect(params.get("limit")).toBe("200");
    expect(params.get("recvWindow")).toBe("60000");
    expect(params.get("transactionId")).toBeNull();
  });

  it("matches orderId and the script’s exact-or-partial ID behavior", async () => {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({ data: [
      { orderId: "ORDER-998877", transactionId: "TX-OTHER", amount: "2", currency: "USDC" },
      { orderId: "ORDER-SECOND", transactionId: "TX-SECOND", amount: "3", currency: "USDT" },
    ] }), { status: 200 });
    expect(await findBinancePayTransaction("ORDER-998877", undefined, fetcher)).toMatchObject({ ok: true, amountCents: 200, asset: "USDC" });
    expect(await findBinancePayTransaction("998877", undefined, fetcher)).toMatchObject({ ok: true, amountCents: 200, asset: "USDC" });
  });

  it("retries without limit when the first Pay transaction request fails", async () => {
    const urls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      urls.push(String(input));
      if (urls.length === 1) return new Response(JSON.stringify({ msg: "limit unsupported" }), { status: 400 });
      return new Response(JSON.stringify({ data: [{ transactionId: "TX-FALLBACK", amount: "1", currency: "BUSD" }] }), { status: 200 });
    };
    expect(await findBinancePayTransaction("TX-FALLBACK", 100, fetcher)).toMatchObject({ ok: true, amountCents: 100, asset: "BUSD" });
    expect(new URL(urls[0]).searchParams.get("limit")).toBe("200");
    expect(new URL(urls[1]).searchParams.get("limit")).toBeNull();
  });

  it("rejects missing, ambiguous, unsupported, and non-positive receipts", async () => {
    const missing: typeof fetch = async () => new Response(JSON.stringify({ data: [] }), { status: 200 });
    expect(await findBinancePayTransaction("TX-123456", undefined, missing)).toMatchObject({ ok: false, reason: "not_found" });

    const ambiguous: typeof fetch = async () => new Response(JSON.stringify({ data: [
      { orderId: "ORDER-A", transactionId: "TX-SAME", amount: "1", currency: "USDT" },
      { orderId: "ORDER-B", transactionId: "TX-SAME", amount: "1", currency: "USDT" },
    ] }), { status: 200 });
    expect(await findBinancePayTransaction("TX-SAME", undefined, ambiguous)).toMatchObject({ ok: false, reason: "ambiguous_id" });

    const unsupported: typeof fetch = async () => new Response(JSON.stringify({ data: [{ transactionId: "TX-123456", amount: "1", currency: "BTC" }] }), { status: 200 });
    expect(await findBinancePayTransaction("TX-123456", undefined, unsupported)).toMatchObject({ ok: false, reason: "unsupported_asset" });

    const negative: typeof fetch = async () => new Response(JSON.stringify({ data: [{ transactionId: "TX-123456", amount: "-1", currency: "USDT" }] }), { status: 200 });
    expect(await findBinancePayTransaction("TX-123456", undefined, negative)).toMatchObject({ ok: false, reason: "not_received" });
  });

  it("rejects a receipt whose amount differs from the pending checkout total", async () => {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({ data: [{ transactionId: "TX-123456", amount: "12.34", currency: "USDT", status: "SUCCESS" }] }), { status: 200 });
    expect(await findBinancePayTransaction("TX-123456", 1235, fetcher)).toMatchObject({ ok: false, reason: "amount_mismatch" });
  });

  it("accepts the provided transaction ID as a valid lookup candidate without claiming it exists", async () => {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({ data: [] }), { status: 200 });
    expect(await findBinancePayTransaction("448035041403518976", undefined, fetcher)).toMatchObject({ ok: false, reason: "not_found" });
  });
});
