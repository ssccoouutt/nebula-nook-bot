import { describe, expect, it } from "vitest";
import { formatBulkPricingForUsers, normalizeBulkPricing, parseBulkPricing, resolveBulkUnitPriceCents } from "../shared/pricing";

describe("bulk pricing", () => {
  it("normalizes tiers and calculates the discounted total", () => {
    const value = normalizeBulkPricing("10-14:0.80\n5-9:0.90");
    expect(value).toBe("5-9:0.90\n10-14:0.80");
    expect(resolveBulkUnitPriceCents(100, value, 5) * 5).toBe(450);
    expect(resolveBulkUnitPriceCents(100, value, 10) * 10).toBe(800);
    expect(resolveBulkUnitPriceCents(100, value, 15)).toBe(100);
  });

  it("shows only tiers whose minimum quantity is in stock", () => {
    expect(formatBulkPricingForUsers("5-9:0.90\n10+:0.80", 6)).toBe("• 5-9 codes → $0.90 each");
    expect(formatBulkPricingForUsers("5-9:0.90\n10+:0.80", 10)).toContain("10+ codes → $0.80 each");
  });

  it("rejects overlapping or malformed tiers", () => {
    expect(() => parseBulkPricing("5-10:0.90\n10+:0.80")).toThrow(/overlap/i);
    expect(() => parseBulkPricing("five+:0.80")).toThrow(/one tier per line/i);
  });
});
