import { describe, expect, it } from "vitest";
import { buildProductStockExports, formatOrderHistory } from "./googleDriveExports";

describe("human-readable Drive exports", () => {
  it("formats complete order history with two blank lines between orders", () => {
    const text = formatOrderHistory([
      { id: 1, buyerFirstName: "Ada", buyerLastName: "Lovelace", buyerTelegramId: 123, buyerUsername: "ada", productName: "Gemini Pro", quantity: 1, kind: "paid", status: "fulfilled", amountCents: 99, createdAt: 1700000000000, updatedAt: 1700000000000 },
      { id: 2, buyerFirstName: "Grace", buyerLastName: "Hopper", buyerTelegramId: 456, buyerUsername: null, productName: "Claude Access", quantity: 1, kind: "free", status: "claimed", amountCents: 0, createdAt: 1700000000000, updatedAt: 1700000000000 },
    ]);
    expect(text).toContain("Order #1");
    expect(text).toContain("Ada Lovelace");
    expect(text).toContain("Gemini Pro");
    expect(text).toContain("Order #2");
    expect(text).toContain("Grace Hopper");
    expect(text).toContain("\n\nOrder #2");
  });

  it("exports only remaining digital stock lines after delivery consumption", () => {
    const exports = buildProductStockExports([
      { id: 7, name: "Gemini Pro", inventoryText: "remaining-link\\nremaining-user:pass" },
      { id: 8, name: "Empty Product", inventoryText: "" },
    ]);
    expect(exports["Gemini Pro.txt"]).toBe(`remaining-link
remaining-user:pass
`);
    expect(exports["Empty Product.txt"]).toBe("");
  });
});
