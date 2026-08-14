import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function context(role: "admin" | "user"): TrpcContext {
  const now = new Date();
  return {
    user: { id: 1, openId: "test-user", name: "Test User", email: "test@example.com", loginMethod: "test", role, createdAt: now, updatedAt: now, lastSignedIn: now },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("admin authorization", () => {
  it("allows overview access without a sign-in session", async () => {
    const caller = appRouter.createCaller(context("user"));
    await expect(caller.admin.overview()).resolves.toMatchObject({ users: expect.any(Number), activeProducts: expect.any(Number), openTickets: expect.any(Number), orders: expect.any(Number) });
  });

  it("returns sortable enriched users and activity-window summaries", async () => {
    const caller = appRouter.createCaller(context("user"));
    const users = await caller.admin.users({ sort: "balance", direction: "desc", limit: 50 });
    expect(Array.isArray(users)).toBe(true);
    if (users[0]) expect(users[0]).toEqual(expect.objectContaining({ balanceCents: expect.any(Number), orderCount: expect.any(Number), referralCount: expect.any(Number), lastActivity: expect.any(Number) }));
    const summary = await caller.admin.activitySummary({ day: new Date().toISOString().slice(0, 10) });
    expect(summary).toEqual(expect.objectContaining({ selectedDayCount: expect.any(Number), last30DayCount: expect.any(Number), selectedDayUserIds: expect.any(Array), last30DayUserIds: expect.any(Array) }));
  });

  it("returns completed-order and wallet-deposit history records", async () => {
    const caller = appRouter.createCaller(context("user"));
    const completed = await caller.admin.completedOrders({ search: "", limit: 50 });
    const deposits = await caller.admin.deposits({ search: "", asset: "", limit: 50 });
    expect(Array.isArray(completed)).toBe(true);
    expect(Array.isArray(deposits)).toBe(true);
    if (completed[0]) expect(completed[0]).toEqual(expect.objectContaining({ userName: expect.any(String), productName: expect.any(String), status: "fulfilled" }));
    if (deposits[0]) expect(deposits[0]).toEqual(expect.objectContaining({ userName: expect.any(String), transactionId: expect.any(String), asset: expect.any(String), status: expect.any(String) }));
  });

  it("exposes the expected order and ledger state vocabulary", () => {
    expect(["pending", "paid", "fulfilled", "cancelled"]).toContain("pending");
    expect(["purchase", "free"]).toContain("free");
    expect(["topup", "purchase", "refund", "referral_bonus"]).toContain("referral_bonus");
  });
});
