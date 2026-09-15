import { describe, expect, it } from "vitest";
import {
  buildQualifiedReferralNotificationKeyboard,
  formatSupportDescriptionPrompt,
  parseTelegramCallbackAction,
  supportDescriptionKeyboard,
} from "./telegram";
import { formatBulkPricingForUsers, normalizeBulkPricing, parseBulkPricing, resolveBulkUnitPriceCents } from "../shared/pricing";

describe("reported Telegram and bulk-pricing fixes", () => {
  it("adds a Cancel button to every support description prompt", () => {
    for (const category of ["completed_order", "payment_verification", "bot_issue", "other"] as const) {
      expect(formatSupportDescriptionPrompt(category)).toContain("24 hours");
      expect(supportDescriptionKeyboard()).toEqual({ inline_keyboard: [[{ text: "✖️ Cancel", callback_data: "support_cancel" }]] });
    }
    expect(parseTelegramCallbackAction("support_cancel")).toEqual({ kind: "support_cancel" });
  });

  it("accepts dashboard-friendly bulk tier text and stores canonical tiers", () => {
    const tiers = parseBulkPricing("• 5-9 codes → $0.90 each\n10+ codes → $0.80 each");
    expect(tiers).toEqual([
      { minQuantity: 5, maxQuantity: 9, unitPriceCents: 90 },
      { minQuantity: 10, maxQuantity: null, unitPriceCents: 80 },
    ]);
    expect(normalizeBulkPricing("5-9:0.9; 10+:0.8")).toBe("5-9:0.90\n10+:0.80");
    expect(resolveBulkUnitPriceCents(100, "5-9:0.9\n10+:0.8", 10)).toBe(80);
  });

  it("does not crash product rendering for malformed legacy bulk values", () => {
    expect(formatBulkPricingForUsers("not a valid tier", 20)).toBe("");
    expect(resolveBulkUnitPriceCents(100, "not a valid tier", 10)).toBe(100);
  });

  it("provides a referral deep link that opens the Referrals section", () => {
    const keyboard = buildQualifiedReferralNotificationKeyboard() as { inline_keyboard: Array<Array<{ text: string; url?: string }>> };
    expect(keyboard.inline_keyboard[0][0].text).toBe("🔗 Get your referral link");
    expect(keyboard.inline_keyboard[0][0].url).toMatch(/start=referrals$/);
  });
});
