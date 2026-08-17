import { describe, expect, it } from "vitest";
import { orderHistorySearchText, resolveOrderHistorySnapshot } from "./orderHistory";

describe("order history snapshots", () => {
  it("preserves the delivered stock and purchase-time warranty/payment values", () => {
    expect(resolveOrderHistorySnapshot({
      deliveredItem: "user:pass-old",
      purchaseWarranty: "30 days",
      quantity: 1,
      paymentMethod: "Wallet",
      legacyWarranty: "no warranty",
      legacyPaymentMethod: "Binance Pay",
    })).toEqual({ deliveredItem: "user:pass-old", warranty: "30 days", quantity: 1, paymentMethod: "Wallet" });
  });

  it("falls back for legacy orders without snapshots", () => {
    expect(resolveOrderHistorySnapshot({
      deliveredItem: null,
      purchaseWarranty: null,
      quantity: null,
      paymentMethod: null,
      legacyWarranty: "no warranty",
      legacyPaymentMethod: "USDT BEP20",
    })).toEqual({ deliveredItem: "", warranty: "no warranty", quantity: 1, paymentMethod: "USDT BEP20" });
  });

  it("includes delivered stock and historical warranty in search text", () => {
    expect(orderHistorySearchText({ userName: "R", username: "buyer", telegramUserId: 42, productName: "Gemini", deliveredItem: "activation-link", warranty: "30 Minutes", paymentMethod: "Wallet", id: 7, kind: "purchase" })).toContain("activation-link");
    expect(orderHistorySearchText({ userName: "R", username: "buyer", telegramUserId: 42, productName: "Gemini", deliveredItem: "activation-link", warranty: "30 Minutes", paymentMethod: "Wallet", id: 7, kind: "purchase" })).toContain("30 minutes");
  });
});
