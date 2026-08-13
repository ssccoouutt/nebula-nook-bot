import { describe, expect, it } from "vitest";
import { BINANCE_PAY_PURCHASE_WINDOW_MS, isLikelyBinancePayTransactionId, shouldRoutePendingBinancePurchase } from "./telegram";

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

  it("does not let a stale purchase intercept a Wallet top-up ID", () => {
    expect(shouldRoutePendingBinancePurchase("448035041403518976", false, true, true)).toBe(false);
    expect(shouldRoutePendingBinancePurchase("448035041403518976", false, false, true)).toBe(true);
  });

  it("keeps commands responsive while a payment intent exists", () => {
    expect(shouldRoutePendingBinancePurchase("/shop", true, false, true)).toBe(false);
    expect(shouldRoutePendingBinancePurchase("/wallet", true, true, true)).toBe(false);
  });

  it("keeps the purchase verification window at exactly 20 minutes", () => {
    expect(BINANCE_PAY_PURCHASE_WINDOW_MS).toBe(20 * 60 * 1000);
  });
});
