import { describe, expect, it } from "vitest";
import { BINANCE_PAY_PURCHASE_WINDOW_MS, isLikelyBinancePayTransactionId } from "./telegram";

describe("Binance Pay message routing", () => {
  it("accepts the user-provided transaction ID as a plain message candidate", () => {
    expect(isLikelyBinancePayTransactionId("448035041403518976")).toBe(true);
    expect(isLikelyBinancePayTransactionId(" 448035041403518976 ")).toBe(true);
  });

  it("does not classify commands or ordinary text as transaction IDs", () => {
    expect(isLikelyBinancePayTransactionId("/start")).toBe(false);
    expect(isLikelyBinancePayTransactionId("/shop")).toBe(false);
    expect(isLikelyBinancePayTransactionId("please check this payment")).toBe(false);
    expect(isLikelyBinancePayTransactionId("1234")).toBe(false);
  });

  it("keeps the purchase verification window at exactly 20 minutes", () => {
    expect(BINANCE_PAY_PURCHASE_WINDOW_MS).toBe(20 * 60 * 1000);
  });
});
