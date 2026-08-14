import { describe, expect, it } from "vitest";
import { BINANCE_PAY_MAX_AGE_MS, buildBinanceSignedQuery, findBinancePayTransaction, isBinancePayTransactionRecent, isPaymentAmountWithinTolerance } from "./binancePay";

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
      return new Response(JSON.stringify({ data: [{ transactionId: "TX-123456", amount: "12.34", currency: "USDT", status: "SUCCESS", transactionTime: Date.now() }] }), { status: 200 });
    };
    const result = await findBinancePayTransaction("TX-123456", 1234, fetcher);
    expect(result).toMatchObject({ ok: true, amountCents: 1234, asset: "USDT" });
    const params = new URL(requestedUrl).searchParams;
    expect(params.get("limit")).toBe("200");
    expect(params.get("recvWindow")).toBe("60000");
    expect(params.get("transactionId")).toBeNull();
  });

  it("rejects non-USDT assets even when the transaction ID matches", async () => {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({ data: [
      { orderId: "ORDER-998877", transactionId: "TX-OTHER", amount: "2", currency: "USDC" },
      { orderId: "ORDER-SECOND", transactionId: "TX-SECOND", amount: "3", currency: "USDT" },
    ] }), { status: 200 });
    expect(await findBinancePayTransaction("ORDER-998877", undefined, fetcher)).toMatchObject({ ok: false, reason: "unsupported_asset" });
    expect(await findBinancePayTransaction("998877", undefined, fetcher)).toMatchObject({ ok: false, reason: "unsupported_asset" });
  });

  it("retries without limit when the first Pay transaction request fails", async () => {
    const urls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      urls.push(String(input));
      if (urls.length === 1) return new Response(JSON.stringify({ msg: "limit unsupported" }), { status: 400 });
      return new Response(JSON.stringify({ data: [{ transactionId: "TX-FALLBACK", amount: "1", currency: "BUSD" }] }), { status: 200 });
    };
    expect(await findBinancePayTransaction("TX-FALLBACK", 100, fetcher)).toMatchObject({ ok: false, reason: "unsupported_asset" });
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

  it("accepts payment amounts within three cents and rejects the fourth cent", async () => {
    expect(isPaymentAmountWithinTolerance(97, 100)).toBe(true);
    expect(isPaymentAmountWithinTolerance(103, 100)).toBe(true);
    expect(isPaymentAmountWithinTolerance(104, 100)).toBe(false);
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({ data: [{ transactionId: "TX-123456", amount: "12.34", currency: "USDT", status: "SUCCESS", transactionTime: Date.now() }] }), { status: 200 });
    expect(await findBinancePayTransaction("TX-123456", 1237, fetcher)).toMatchObject({ ok: true, amountCents: 1234 });
    expect(await findBinancePayTransaction("TX-123456", 1238, fetcher)).toMatchObject({ ok: false, reason: "amount_mismatch" });
  });

  it("requires Binance Pay transactions to be timestamped within the last 12 hours", async () => {
    const now = 1_700_000_000_000;
    expect(isBinancePayTransactionRecent({ transactionTime: now - BINANCE_PAY_MAX_AGE_MS }, now)).toBe(true);
    expect(isBinancePayTransactionRecent({ transactionTime: now - BINANCE_PAY_MAX_AGE_MS - 1 }, now)).toBe(false);
    expect(isBinancePayTransactionRecent({ transactionTime: now + 1 }, now)).toBe(false);
    expect(isBinancePayTransactionRecent({}, now)).toBe(false);
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({ data: [{ transactionId: "TX-STALE", amount: "1", currency: "USDT", transactionTime: Date.now() - BINANCE_PAY_MAX_AGE_MS - 1 }] }), { status: 200 });
    expect(await findBinancePayTransaction("TX-STALE", 100, fetcher)).toMatchObject({ ok: false, reason: "stale_transaction" });
  });

  it("verifies a USDT BEP20 deposit from the BSC receipt Transfer log", async () => {
    const previous = process.env.BEP20;
    process.env.BEP20 = "0xmerchant";
    try {
      const fetcher: typeof fetch = async (_input, init) => {
        const request = JSON.parse(String(init?.body ?? "{}")) as { method?: string };
        if (request.method === "eth_getTransactionReceipt") {
          return new Response(JSON.stringify({ result: {
            status: "0x1",
            blockNumber: "0x64",
            logs: [{
              address: "0x55d398326f99059ff775485246999027b3197955",
              topics: [
                "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
                "0x000000000000000000000000ef3aeff9a5f61c6dda33069c58c1434006e13b20",
                `0x${"0".repeat(24)}0586e6a681e3ecbf2803d92e171439a4d878423e`,
              ],
              data: "0x8ac7230489e80000",
            }],
          } }), { status: 200 });
        }
        return new Response(JSON.stringify({ result: { number: "0x65" } }), { status: 200 });
      };
      process.env.BEP20 = "0x0586e6a681e3ecbf2803d92e171439a4d878423e";
      expect(await findBinancePayTransaction("0xabc123", 1000, fetcher, "bep20")).toMatchObject({ ok: true, amountCents: 1000, asset: "USDT" });
      expect(await findBinancePayTransaction("0xabc123", 1003, fetcher, "bep20")).toMatchObject({ ok: true, amountCents: 1000 });
      expect(await findBinancePayTransaction("0xabc123", 1004, fetcher, "bep20")).toMatchObject({ ok: false, reason: "amount_mismatch" });
    } finally {
      if (previous === undefined) delete process.env.BEP20;
      else process.env.BEP20 = previous;
    }
  });

  it("requires a BEP20 transfer to occur after the matching invoice was created", async () => {
    const previous = process.env.BEP20;
    process.env.BEP20 = "0x0586e6a681e3ecbf2803d92e171439a4d878423e";
    try {
      const fetcher: typeof fetch = async (_input, init) => {
        const request = JSON.parse(String(init?.body ?? "{}")) as { method?: string; params?: unknown[] };
        if (request.method === "eth_getTransactionReceipt") {
          return new Response(JSON.stringify({ result: {
            status: "0x1",
            blockNumber: "0x64",
            logs: [{
              address: "0x55d398326f99059ff775485246999027b3197955",
              topics: [
                "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
                `0x${"0".repeat(64)}`,
                `0x${"0".repeat(24)}0586e6a681e3ecbf2803d92e171439a4d878423e`,
              ],
              data: "0x" + BigInt("1000000000000000000").toString(16).padStart(64, "0"),
            }],
          } }), { status: 200 });
        }
        if (request.method === "eth_getBlockByNumber" && request.params?.[0] === "0x64") {
          return new Response(JSON.stringify({ result: { number: "0x64", timestamp: "0x65" } }), { status: 200 });
        }
        return new Response(JSON.stringify({ result: { number: "0x65", timestamp: "0x66" } }), { status: 200 });
      };
      expect(await findBinancePayTransaction("0xafter", 100, fetcher, "bep20", 102000)).toMatchObject({ ok: false, reason: "before_invoice" });
      expect(await findBinancePayTransaction("0xafter", 100, fetcher, "bep20", 100000)).toMatchObject({ ok: true, amountCents: 100, asset: "USDT" });
    } finally {
      if (previous === undefined) delete process.env.BEP20;
      else process.env.BEP20 = previous;
    }
  });

  it("rejects a BEP20 receipt without a matching USDT transfer to the configured address", async () => {
    const previous = process.env.BEP20;
    process.env.BEP20 = "0xmerchant";
    try {
      const fetcher: typeof fetch = async (_input, init) => {
        const request = JSON.parse(String(init?.body ?? "{}")) as { method?: string };
        if (request.method === "eth_getTransactionReceipt") return new Response(JSON.stringify({ result: { status: "0x1", blockNumber: "0x64", logs: [] } }), { status: 200 });
        return new Response(JSON.stringify({ result: { number: "0x65" } }), { status: 200 });
      };
      expect(await findBinancePayTransaction("0xwrong", 1000, fetcher, "bep20")).toMatchObject({ ok: false, reason: "address_mismatch" });
    } finally {
      if (previous === undefined) delete process.env.BEP20;
      else process.env.BEP20 = previous;
    }
  });

  it("accepts the provided transaction ID as a valid lookup candidate without claiming it exists", async () => {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({ data: [] }), { status: 200 });
    expect(await findBinancePayTransaction("448035041403518976", undefined, fetcher)).toMatchObject({ ok: false, reason: "not_found" });
  });
});
