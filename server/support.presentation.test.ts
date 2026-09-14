import { describe, expect, it } from "vitest";
import {
  formatSupportDescriptionPrompt,
  formatSupportPrompt,
  formatSupportSubmitted,
  formatSupportTicketDetail,
  parseTelegramCallbackAction,
} from "./telegram";

describe("guided support flow", () => {
  it("explains response timing and duplicate-ticket guidance", () => {
    const prompt = formatSupportPrompt();
    expect(prompt).toContain("24 hours");
    expect(prompt).toContain("duplicate tickets");
  });

  it("asks payment-verification users for amount, error, and transaction hash", () => {
    const prompt = formatSupportDescriptionPrompt("payment_verification", { paymentMethod: "USDT BEP20" });
    expect(prompt).toContain("USDT BEP20");
    expect(prompt).toContain("how much you sent");
    expect(prompt).toContain("transaction hash");
    expect(prompt).toContain("auto-verification error");
  });

  it("parses guided support category, order, payment, history, and detail callbacks", () => {
    expect(parseTelegramCallbackAction("support_category:completed_order")).toEqual({ kind: "support_category", category: "completed_order" });
    expect(parseTelegramCallbackAction("support_order:42")).toEqual({ kind: "support_order", id: 42 });
    expect(parseTelegramCallbackAction("support_payment:3")).toEqual({ kind: "support_payment", id: 3 });
    expect(parseTelegramCallbackAction("tickets_page:2")).toEqual({ kind: "tickets_page", page: 2 });
    expect(parseTelegramCallbackAction("ticket_detail:42")).toEqual({ kind: "ticket_detail", id: 42 });
  });

  it("shows ticket status, context, message, and admin answer", () => {
    const detail = formatSupportTicketDetail({
      id: 42,
      category: "completed_order",
      status: "answered",
      message: "The delivered account does not work.",
      orderName: "Premium Account",
      adminReply: "We have replaced the account.",
      createdAt: new Date("2026-09-14T10:00:00Z"),
    });
    expect(detail).toContain("#42");
    expect(detail).toContain("answered");
    expect(detail).toContain("Premium Account");
    expect(detail).toContain("We have replaced the account.");
  });

  it("confirms a ticket and points users to ticket history", () => {
    const message = formatSupportSubmitted("42");
    expect(message).toContain("#42");
    expect(message).toContain("My tickets");
  });

  it("rejects malformed guided support callbacks", () => {
    expect(parseTelegramCallbackAction("support_category:unknown")).toBeNull();
    expect(parseTelegramCallbackAction("ticket_detail:not-a-number")).toBeNull();
  });
});
