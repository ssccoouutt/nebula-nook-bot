import { describe, expect, it } from "vitest";
import { buildOrderDetailKeyboard, buildOrdersKeyboard, formatDetailedOrder, parseTelegramCallbackAction } from "./telegram";

describe("Telegram completed orders", () => {
  it("parses order page, detail, and Buy again callbacks", () => {
    expect(parseTelegramCallbackAction("orders_page:2")).toEqual({ kind: "orders_page", page: 2 });
    expect(parseTelegramCallbackAction("order_detail:42:2")).toEqual({ kind: "order_detail", id: 42, page: 2 });
    expect(parseTelegramCallbackAction("order_buy_again:42")).toEqual({ kind: "order_buy_again", id: 42 });
  });

  it("renders complete historical order details", () => {
    const text = formatDetailedOrder({ id: 42, kind: "purchase", status: "fulfilled", amountCents: 450, productName: "Prime Pack", quantity: 5, purchaseWarranty: "30 Minutes", deliveredItem: "username; password", paymentMethod: "Wallet", createdAt: "2026-09-13T12:00:00.000Z" });
    expect(text).toContain("Order #42");
    expect(text).toContain("Quantity: <b>5</b>");
    expect(text).toContain("username; password");
    expect(text).toContain("30 Minutes");
    expect(text).toContain("Wallet");
  });

  it("renders five order buttons and older/newer navigation", () => {
    const rows = Array.from({ length: 5 }, (_, index) => ({ id: index + 1, productName: `Product ${index + 1}` }));
    const firstPage = buildOrdersKeyboard(rows, 0, 3) as { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
    expect(firstPage.inline_keyboard).toHaveLength(7);
    expect(firstPage.inline_keyboard[0][0].callback_data).toBe("order_detail:1:0");
    expect(firstPage.inline_keyboard[5][0].callback_data).toBe("orders_page:1");
    const middlePage = buildOrdersKeyboard(rows, 1, 3) as { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
    expect(middlePage.inline_keyboard[5].map((button) => button.callback_data)).toEqual(["orders_page:0", "orders_page:2"]);
  });

  it("provides Buy again and page-preserving Back buttons", () => {
    const markup = buildOrderDetailKeyboard(42, 2) as { inline_keyboard: Array<Array<{ callback_data: string }>> };
    expect(markup.inline_keyboard[0][0].callback_data).toBe("order_buy_again:42");
    expect(markup.inline_keyboard[1][0].callback_data).toBe("orders_page:2");
  });
});
