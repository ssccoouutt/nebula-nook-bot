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
} from "./telegram";

describe("Telegram presentation and notification helpers", () => {
  it("resolves the configured operations group before runtime and fallback targets", () => {
    expect(resolveNotificationChatId("-100123", "-200456", "-300789")).toBe(-100123);
    expect(resolveNotificationChatId(undefined, "-200456", "-300789")).toBe(-200456);
    expect(resolveNotificationChatId(undefined, undefined, "-300789")).toBe(-300789);
    expect(resolveNotificationChatId("not-a-chat", undefined, "0")).toBeNull();
  });

  it("keeps core messages emoji-led and HTML formatted", () => {
    expect(formatHomeMessage()).toContain("✨ <b>Welcome to Nebula Nook</b>");
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
    });
  });
});
