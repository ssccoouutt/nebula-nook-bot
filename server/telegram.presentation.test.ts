import { describe, expect, it } from "vitest";
import {
  buildAutoPurchaseResult,
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
  formatFreebiesMessage,
  buildFreebiesKeyboard,
  telegramResponseMethod,
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
    expect(buildAutoPurchaseResult(1000, 299, 25)).toEqual({ ok: true, status: "fulfilled", nextBalanceCents: 701, nextStock: 24 });
    expect(buildAutoPurchaseResult(100, 299, 25).status).toBe("insufficient_balance");
    expect(buildAutoPurchaseResult(1000, 299, 0).status).toBe("out_of_stock");
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
