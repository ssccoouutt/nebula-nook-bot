import { describe, expect, it } from "vitest";
import {
  buildAutoPurchaseResult,
  buildConfirmedPurchasePlan,
  buildFulfillmentNotifications,
  buildPurchaseAnnouncement,
  maskPurchaseName,
  productEmoji,
  formatExtraDeviceMessage,
  formatHomeMessage,
  formatMembershipMessage,
  formatOrderStatus,
  formatPurchaseConfirmation,
  formatShopSummary,
  SHOP_PAGE_SIZE,
  formatSupportPrompt,
  formatSupportSubmitted,
  resolveNotificationChatId,
  buildHomeKeyboard,
  buildMembershipKeyboard,
  buildShopKeyboard,
  buildProductKeyboard,
  buildQuantityKeyboard,
  buildPurchaseReviewKeyboard,
  formatQuantityPrompt,
  formatPurchaseReview,
  formatFreebiesMessage,
  buildFreebiesKeyboard,
  telegramResponseMethod,
  parseTelegramCallbackAction,
  resolvePurchaseCallbackRoute,
} from "./telegram";

describe("Telegram presentation and notification helpers", () => {
  it("resolves the configured operations group before runtime and fallback targets", () => {
    expect(resolveNotificationChatId("-100123", "-200456", "-300789")).toBe(-100123);
    expect(resolveNotificationChatId(undefined, "-200456", "-300789")).toBe(-200456);
    expect(resolveNotificationChatId(undefined, undefined, "-300789")).toBe(-300789);
    expect(resolveNotificationChatId("not-a-chat", undefined, "0")).toBeNull();
  });

  it("keeps core messages emoji-led and HTML formatted", () => {
    const home = formatHomeMessage({ firstName: "Rashid", username: "rashid", tier: "Silver", balanceCents: 1000, referrals: 3, access: true });
    expect(home).toContain("👋 <b>Welcome to Nebula Nook, Rashid!</b>");
    expect(home).toContain("<code>@rashid</code>");
    expect(home).toContain("<b>Silver</b>");
    expect(home).toContain("<b>$10.00</b>");
    expect(home).toContain("<b>3</b>");
    expect(home).toContain("✅ Membership active");
    expect(formatMembershipMessage()).toContain("🔐 <b>Membership required</b>");
    expect(formatSupportPrompt()).toContain("🆘 <b>Support</b>");
    expect(formatSupportSubmitted("42")).toContain("✅ <b>Support request received</b>");
    expect(formatExtraDeviceMessage()).toContain("📱 <b>Extra device request</b>");
    expect(formatPurchaseConfirmation(42, "Premium", 100)).toContain("✅ <b>Order completed</b>");
    expect(formatOrderStatus(42, "purchase", "fulfilled", 100)).toContain("✅ #42 · purchase · fulfilled");
  });

  it("formats a compact paginated Shop instead of a message per product", () => {
    expect(SHOP_PAGE_SIZE).toBe(6);
    expect(formatShopSummary(0, 2)).toContain("📄 Page 1 of 2");
    expect(formatShopSummary(1, 2)).toContain("🛍️ <b>Nebula Nook Shop</b>");
  });

  it("renders Freebies as one compact message with grouped claim controls", () => {
    const message = formatFreebiesMessage([
      { name: "Gemini Pro Trial Link", stock: 40 },
      { name: "Notion Plus Coupon", stock: 10 },
    ]);
    expect(message).toContain("🎁 <b>Nebula Nook Freebies</b>");
    expect(message).toContain("Gemini Pro Trial Link");
    expect(message).toContain("Notion Plus Coupon");
    expect(message.split("Nebula Nook Freebies")).toHaveLength(2);

    const rows = buildFreebiesKeyboard([
      { id: 2, name: "Gemini Pro Trial Link" },
      { id: 6, name: "Notion Plus Coupon" },
    ]).inline_keyboard;
    expect(rows[0]).toHaveLength(2);
    expect(rows[0][0]).toMatchObject({ callback_data: "claim:2", style: "success" });
    expect(rows[0][1]).toMatchObject({ callback_data: "claim:6", style: "success" });
    expect(rows[1][0]).toMatchObject({ callback_data: "home", style: "primary" });
  });

  it("routes every inline callback action deterministically", () => {
    expect(parseTelegramCallbackAction("home")).toEqual({ kind: "home" });
    expect(parseTelegramCallbackAction("freebies")).toEqual({ kind: "freebies" });
    expect(parseTelegramCallbackAction("wallet")).toEqual({ kind: "wallet" });
    expect(parseTelegramCallbackAction("orders")).toEqual({ kind: "orders" });
    expect(parseTelegramCallbackAction("profile")).toEqual({ kind: "profile" });
    expect(parseTelegramCallbackAction("support")).toEqual({ kind: "support" });
    expect(parseTelegramCallbackAction("verify_membership")).toEqual({ kind: "verify_membership" });
    expect(parseTelegramCallbackAction("shop")).toEqual({ kind: "shop", id: 0 });
    expect(parseTelegramCallbackAction("shop:2")).toEqual({ kind: "shop", id: 2 });
    expect(parseTelegramCallbackAction("product:7")).toEqual({ kind: "product", id: 7 });
    expect(parseTelegramCallbackAction("claim:7")).toEqual({ kind: "claim", id: 7 });
    expect(parseTelegramCallbackAction("buy:7")).toEqual({ kind: "buy", id: 7 });
    expect(parseTelegramCallbackAction("buyqty:7:3")).toEqual({ kind: "buyqty", id: 7, quantity: 3 });
    expect(parseTelegramCallbackAction("buyconfirm:7:3")).toEqual({ kind: "buyconfirm", id: 7, quantity: 3 });
    expect(parseTelegramCallbackAction("buycancel:7")).toEqual({ kind: "buycancel", id: 7 });
    expect(parseTelegramCallbackAction("unknown:7")).toBeNull();
    expect(parseTelegramCallbackAction("product:nope")).toBeNull();
  });

  it("routes the quantity purchase state machine through the real callback dispatcher seam", () => {
    expect(resolvePurchaseCallbackRoute({ kind: "buy", id: 7 })).toBe("quantity_prompt");
    expect(resolvePurchaseCallbackRoute({ kind: "buyqty", id: 7, quantity: 3 })).toBe("purchase_review");
    expect(resolvePurchaseCallbackRoute({ kind: "buyconfirm", id: 7, quantity: 3 })).toBe("purchase_confirm");
    expect(resolvePurchaseCallbackRoute({ kind: "buycancel", id: 7 })).toBe("product_view");
    expect(resolvePurchaseCallbackRoute({ kind: "home" })).toBeNull();
  });

  it("renders the Qamify-style quantity and confirmation steps", () => {
    expect(formatQuantityPrompt("Gemini Pro", 299, 25)).toContain("🛒 <b>Choose quantity</b>");
    expect(formatQuantityPrompt("Gemini Pro", 299, 25)).toContain("📦 Available: <b>25</b>");
    const quantityRows = buildQuantityKeyboard(7, 25).inline_keyboard;
    expect(quantityRows[0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: "1×", callback_data: "buyqty:7:1", style: "primary" }),
      expect.objectContaining({ text: "2×", callback_data: "buyqty:7:2", style: "primary" }),
      expect.objectContaining({ text: "3×", callback_data: "buyqty:7:3", style: "primary" }),
    ]));
    expect(quantityRows.at(-1)?.[0]).toMatchObject({ text: "↩️ Back to product", callback_data: "product:7" });
    expect(formatPurchaseReview("Gemini Pro", 299, 3, 1000)).toContain("💰 Total: <b>$8.97</b>");
    const reviewRows = buildPurchaseReviewKeyboard(7, 3).inline_keyboard;
    expect(reviewRows[0][0]).toMatchObject({ callback_data: "buyconfirm:7:3", style: "success" });
    expect(reviewRows[1][0]).toMatchObject({ callback_data: "buycancel:7", style: "danger" });
  });

  it("uses edit-in-place responses for callback navigation and send responses for commands", () => {
    expect(telegramResponseMethod()).toBe("sendMessage");
    expect(telegramResponseMethod(1234)).toBe("editMessageText");
  });

  it("assigns Telegram primary and success styles to representative keyboards", () => {
    const home = buildHomeKeyboard().inline_keyboard;
    expect(home[0][0]).toMatchObject({ callback_data: "freebies", style: "success" });
    expect(home[0][1]).toMatchObject({ callback_data: "shop", style: "primary" });

    const compactShop = buildShopKeyboard([{ id: 1, name: "Sample", priceCents: 100 }], 0, 1).inline_keyboard;
    expect(compactShop.at(-1)).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: "🔄 Refresh", callback_data: "shop:0", style: "primary" }),
      expect.objectContaining({ text: "🏠 Back to home", callback_data: "home", style: "primary" }),
    ]));

    const compactProduct = buildProductKeyboard(1).inline_keyboard;
    expect(compactProduct[1]).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: "↩️ Back to shop", callback_data: "shop", style: "primary" }),
      expect.objectContaining({ text: "🏠 Home", callback_data: "home", style: "primary" }),
    ]));

    const membership = buildMembershipKeyboard("https://t.me/+channel", "https://t.me/+group").inline_keyboard;
    expect(membership[0][0]).toMatchObject({ url: "https://t.me/+channel", style: "success" });
    expect(membership[2][0]).toMatchObject({ callback_data: "verify_membership", style: "primary" });

    const shop = buildShopKeyboard([{ id: 7, name: "Gemini Pro", priceCents: 1 }], 0, 2).inline_keyboard;
    expect(shop[0][0]).toMatchObject({ callback_data: "product:7", style: "primary" });
    expect(shop[1][0]).toMatchObject({ callback_data: "shop:1", style: "primary" });

    const product = buildProductKeyboard(7).inline_keyboard;
    expect(product[0][0]).toMatchObject({ callback_data: "buy:7", style: "success" });
  });

  it("computes an automatically fulfilled wallet purchase without dashboard intervention", () => {
    expect(buildAutoPurchaseResult(1000, 299, 25)).toMatchObject({ ok: true, status: "fulfilled", quantity: 1, totalCents: 299, nextBalanceCents: 701, nextStock: 24 });
    expect(buildAutoPurchaseResult(1000, 299, 25, 3)).toMatchObject({ ok: true, status: "fulfilled", quantity: 3, totalCents: 897, nextBalanceCents: 103, nextStock: 22 });
    expect(buildAutoPurchaseResult(100, 299, 25, 3).status).toBe("insufficient_balance");
    expect(buildAutoPurchaseResult(1000, 299, 2, 3).status).toBe("out_of_stock");
    expect(buildConfirmedPurchasePlan(1000, 299, 25, 3)).toEqual({ ok: true, quantity: 3, totalCents: 897, nextBalanceCents: 103, nextStock: 22 });
    expect(buildConfirmedPurchasePlan(100, 299, 25, 3)).toEqual({ ok: false, status: "insufficient_balance", totalCents: 897 });
    expect(buildConfirmedPurchasePlan(1000, 299, 2, 3)).toEqual({ ok: false, status: "out_of_stock", totalCents: 897 });
  });

  it("builds a group completion notice without requiring a customer DM", () => {
    const withCustomer = buildFulfillmentNotifications(42, 100, 7278358063);
    expect(withCustomer.customer).toBeNull();
    expect(withCustomer.group).toContain("✅ <b>Order completed</b>");

    const withoutCustomer = buildFulfillmentNotifications(42, 100);
    expect(withoutCustomer.customer).toBeNull();
    expect(withoutCustomer.group).toContain("✅ <b>Order completed</b>");
  });

  it("builds a Qamify-style masked purchase announcement with a product deep link", () => {
    expect(maskPurchaseName("Rashid")).toBe("R*****d");
    expect(productEmoji("Gemini Pro Trial Link")).toBe("🔋");
    const announcement = buildPurchaseAnnouncement(12, "Gemini Pro Trial Link", 2, "Rashid", 7278358063);
    expect(announcement.text).toContain("R*****d");
    expect(announcement.text).toContain("2×");
    expect(announcement.text).toContain("🔋 <b>Gemini Pro Trial Link</b>");
    expect(announcement.replyMarkup.inline_keyboard[0][0]).toEqual({
      text: "🛍️ View product in bot",
      url: "https://t.me/NebulaNook4827_bot?start=product_12",
      style: "primary",
    });
  });
});
