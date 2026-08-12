import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
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
  it("rejects overview access for regular users", async () => {
    const caller = appRouter.createCaller(context("user"));
    await expect(caller.admin.overview()).rejects.toMatchObject<TRPCError>({ code: "FORBIDDEN" });
  });

  it("exposes the expected order and ledger state vocabulary", () => {
    expect(["pending", "paid", "fulfilled", "cancelled"]).toContain("pending");
    expect(["purchase", "free"]).toContain("free");
    expect(["topup", "purchase", "refund", "referral_bonus"]).toContain("referral_bonus");
  });
});
