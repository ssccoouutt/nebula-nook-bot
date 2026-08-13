import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  products: [{ id: 7, name: "Gemini AI Pro", active: true, stock: 8, priceCents: 500, emoji: "🔋" }],
  users: [{ id: 41, telegramUserId: 9001, firstName: "Rashid", username: "rashid", balanceCents: 1000, tier: "Bronze", referrals: 0 }],
  alerts: [] as Array<{ id: number; botUserId: number; productId: number; active: number }>,
  selectCount: 0,
  mode: "custom" as "custom" | "price",
}));

vi.mock("./db", () => ({
  getDb: vi.fn(async () => ({
    select: () => ({
      from: (_table: unknown) => ({
        where: () => {
          state.selectCount += 1;
          const rows = state.mode === "custom"
            ? (state.selectCount === 1 || state.selectCount === 2 ? state.products : state.users)
            : (((state.selectCount - 1) % 3) === 0 ? state.users : ((state.selectCount - 1) % 3) === 1 ? state.products : state.alerts);
          const query = Promise.resolve(rows) as Promise<typeof rows> & { limit?: () => Promise<typeof rows> };
          query.limit = async () => rows;
          return query;
        },
      }),
    }),
    insert: () => ({
      values: async (value: { botUserId: number; productId: number; active: number }) => {
        state.alerts.push({ id: state.alerts.length + 1, ...value });
        return [{ insertId: state.alerts.length }];
      },
    }),
    update: () => ({
      set: (value: { active: number }) => ({
        where: async () => {
          if (state.alerts[0]) state.alerts[0].active = value.active;
        },
      }),
    }),
  })),
}));

import { handleCallback, handleMessage } from "./telegram";

describe("Telegram dispatcher handlers", () => {
  beforeEach(() => {
    state.alerts.length = 0;
    state.selectCount = 0;
    state.mode = "custom";
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (body.method === "getChatMember") return new Response(JSON.stringify({ ok: true, result: { status: "member" } }));
      return new Response(JSON.stringify({ ok: true, result: { message_id: 321 } }));
    }));
  });

  it("routes a custom quantity reply from prompt through retry and then review", async () => {
    const query = {
      id: "cb-custom",
      from: { id: 9001, first_name: "Rashid" },
      data: "customqty:7",
      message: { message_id: 100, chat: { id: 9001, type: "private" } },
    } as any;
    await handleCallback(query, { skipAccess: true });
    await handleMessage({
      message_id: 101,
      chat: { id: 9001, type: "private" },
      from: { id: 9001, first_name: "Rashid" },
      text: "many",
      reply_to_message: { message_id: 100 },
    } as any);
    await handleMessage({
      message_id: 102,
      chat: { id: 9001, type: "private" },
      from: { id: 9001, first_name: "Rashid" },
      text: "3",
      reply_to_message: { message_id: 101 },
    } as any);

    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const payloads = calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)));
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(payloads)).toContain("Gemini AI Pro");
  });

  it("dispatches pricealert callback through DB-backed create and toggle", async () => {
    state.mode = "price";
    const query = {
      id: "cb-alert-on",
      from: { id: 9001, first_name: "Rashid" },
      data: "pricealert:7",
      message: { message_id: 200, chat: { id: 9001, type: "private" } },
    } as any;
    await handleCallback(query, { skipAccess: true });
    expect(state.alerts).toEqual([{ id: 1, botUserId: 41, productId: 7, active: 1 }]);

    await handleCallback({ ...query, id: "cb-alert-off" } as any, { skipAccess: true });
    expect(state.alerts[0].active).toBe(0);
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const payloads = calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)));
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(payloads)).toContain("Gemini AI Pro");
  });
});
