import { describe, expect, it } from "vitest";
import { buildConfirmedPurchasePlan, buildWalletDepositInvoiceKeyboard, formatPurchaseConfirmation } from "./telegram";

describe("commerce feature behavior", () => {
  it("calculates the bulk total for a wallet purchase plan", () => {
    const result = buildConfirmedPurchasePlan(1_000, 100, 20, 5, "5-9:0.90\n10+:0.80");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.totalCents).toBe(450);
  });

  it("includes manual stock details in the completed order message", () => {
    const message = formatPurchaseConfirmation(7, "Instruction Pack", 450, { mode: "manual", items: ["Open this link", "Use code ABC"], warrantyDays: "30 Minutes" });
    expect(message).toContain("Manual delivery details");
    expect(message).toContain("Open this link");
    expect(message).toContain("order is recorded as completed");
  });

  it("keeps a visible cancel control for BEP20 verification", () => {
    const markup = buildWalletDepositInvoiceKeyboard("bep20") as { inline_keyboard?: Array<Array<{ text?: string; callback_data?: string }>> };
    expect(markup.inline_keyboard?.flat().some((button) => button.callback_data === "walletcancel")).toBe(true);
  });
});
