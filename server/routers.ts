import { z } from "zod";
import { desc, eq, sql } from "drizzle-orm";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { botSettings, botUsers, broadcasts, orders, products, supportTickets, walletLedger } from "../drizzle/schema";
import { TRPCError } from "@trpc/server";

function inventoryLines(value: string) {
  return value.replaceAll("\\n", "\n").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function productValues(input: { name: string; description: string; details: string; priceUsd: number; inventoryText: string; deliveryMode: "automatic" | "manual"; warrantyDays: number; imageUrl: string; freeEligible: boolean; freeWindowMs: number | null; active?: boolean }) {
  const priceCents = Math.round(input.priceUsd * 100);
  if (!Number.isFinite(input.priceUsd) || priceCents < 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Price must be a valid non-negative USD amount" });
  const items = inventoryLines(input.inventoryText);
  return { name: input.name.trim(), description: input.description.trim(), details: input.details.trim(), priceCents, stock: items.length, inventoryText: items.join("\n"), deliveryMode: input.deliveryMode, warrantyDays: Math.max(0, Math.floor(input.warrantyDays)), imageUrl: input.imageUrl.trim(), freeEligible: input.freeEligible ? 1 : 0, freeWindowMs: input.freeWindowMs, ...(input.active === undefined ? {} : { active: input.active ? 1 : 0 }) };
}
import { buildFulfillmentNotifications, configureTelegramWebhook, notifyAdmin, sendTelegramMessage, validTelegramJoinUrl } from "./telegram";

// Public dashboard mode is intentionally enabled at the user’s request.
// Keep secrets server-side, but note that all dashboard mutations are publicly callable.
const adminProcedure = publicProcedure;

async function database() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database is unavailable" });
  return db;
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  admin: router({
    overview: adminProcedure.query(async () => {
      const db = await database();
      const [users, activeProducts, openTickets, ordersCount] = await Promise.all([
        db.select({ count: sql<number>`count(*)` }).from(botUsers),
        db.select({ count: sql<number>`count(*)` }).from(products).where(eq(products.active, 1)),
        db.select({ count: sql<number>`count(*)` }).from(supportTickets).where(eq(supportTickets.status, "open")),
        db.select({ count: sql<number>`count(*)` }).from(orders),
      ]);
      return { users: Number(users[0]?.count ?? 0), activeProducts: Number(activeProducts[0]?.count ?? 0), openTickets: Number(openTickets[0]?.count ?? 0), orders: Number(ordersCount[0]?.count ?? 0) };
    }),
    products: adminProcedure.query(async () => (await database()).select().from(products).orderBy(desc(products.createdAt))),
    createProduct: adminProcedure.input(z.object({ name: z.string().min(1).max(255), description: z.string().min(1), details: z.string().default(""), priceUsd: z.number().nonnegative(), inventoryText: z.string().default(""), deliveryMode: z.enum(["automatic", "manual"]).default("automatic"), warrantyDays: z.number().int().nonnegative().default(0), imageUrl: z.string().url().or(z.literal("")).default(""), freeEligible: z.boolean(), freeWindowMs: z.number().int().positive().nullable() })).mutation(async ({ input }) => {
      const db = await database();
      await db.insert(products).values({ ...productValues(input), active: 1 });
      return { success: true };
    }),
    updateProduct: adminProcedure.input(z.object({ id: z.number().int(), name: z.string().min(1).max(255), description: z.string().min(1), details: z.string().default(""), priceUsd: z.number().nonnegative(), inventoryText: z.string().default(""), deliveryMode: z.enum(["automatic", "manual"]).default("automatic"), warrantyDays: z.number().int().nonnegative().default(0), imageUrl: z.string().url().or(z.literal("")).default(""), active: z.boolean(), freeEligible: z.boolean(), freeWindowMs: z.number().int().positive().nullable() })).mutation(async ({ input }) => {
      const db = await database();
      await db.update(products).set(productValues(input)).where(eq(products.id, input.id));
      return { success: true };
    }),
    deleteProduct: adminProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ input }) => {
      const db = await database();
      await db.update(products).set({ active: 0 }).where(eq(products.id, input.id));
      return { success: true };
    }),
    settings: adminProcedure.query(async () => (await database()).select().from(botSettings).orderBy(botSettings.key)),
    setSetting: adminProcedure.input(z.object({ key: z.string().min(1).max(128), value: z.string().max(10000) })).mutation(async ({ input }) => {
      const allowedKeys = new Set(["membership_channel_id", "membership_group_id", "membership_channel_url", "membership_group_url", "notification_chat_id"]);
      if (!allowedKeys.has(input.key)) throw new TRPCError({ code: "BAD_REQUEST", message: "Unsupported setting key" });
      if (input.key.endsWith("_url")) {
        const url = input.value.trim();
        if (!validTelegramJoinUrl(url)) throw new TRPCError({ code: "BAD_REQUEST", message: "Use a valid Telegram public link or invite link such as https://t.me/+..." });
      }
      if (input.key.endsWith("_id")) {
        if (!/^-?\d+$/.test(input.value.trim())) throw new TRPCError({ code: "BAD_REQUEST", message: "Chat IDs must be numeric, for example -1001234567890" });
      }
      const db = await database();
      await db.insert(botSettings).values({ key: input.key, value: input.value.trim() }).onConflictDoUpdate({ target: botSettings.key, set: { value: input.value.trim() } });
      return { success: true };
    }),
    users: adminProcedure.query(async () => (await database()).select().from(botUsers).orderBy(desc(botUsers.createdAt)).limit(200)),
    ledger: adminProcedure.query(async () => (await database()).select().from(walletLedger).orderBy(desc(walletLedger.createdAt)).limit(300)),
    orders: adminProcedure.query(async () => (await database()).select().from(orders).orderBy(desc(orders.createdAt)).limit(200)),
    updateOrderStatus: adminProcedure.input(z.object({ id: z.number().int(), status: z.enum(["pending", "paid", "fulfilled", "cancelled"]) })).mutation(async ({ input }) => {
      const db = await database();
      const order = (await db.select().from(orders).where(eq(orders.id, input.id)).limit(1))[0];
      if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
      await db.update(orders).set({ status: input.status }).where(eq(orders.id, input.id));
      if (input.status === "fulfilled") {
        const users = await db.select().from(botUsers).where(eq(botUsers.id, order.botUserId)).limit(1);
        const customer = users[0];
        const notifications = buildFulfillmentNotifications(String(order.id), order.amountCents, customer?.telegramUserId);
        await notifyAdmin("order_fulfilled", String(order.id), notifications.group);
      }
      return { success: true };
    }),
    tickets: adminProcedure.query(async () => (await database()).select().from(supportTickets).orderBy(desc(supportTickets.createdAt)).limit(200)),
    configureWebhook: adminProcedure.mutation(async ({ ctx }) => {
      const protocol = String(ctx.req.headers["x-forwarded-proto"] ?? ctx.req.protocol ?? "https").split(",")[0].trim();
      const host = String(ctx.req.headers["x-forwarded-host"] ?? ctx.req.headers.host ?? "").split(",")[0].trim();
      if (!host) throw new TRPCError({ code: "BAD_REQUEST", message: "Public host is unavailable" });
      const webhookUrl = `${protocol}://${host}/api/telegram/webhook`;
      const webhook = await configureTelegramWebhook(webhookUrl);
      return { success: true, webhookUrl, webhook };
    }),
    queueBroadcast: adminProcedure.input(z.object({ message: z.string().min(1).max(4000) })).mutation(async ({ input }) => {
      const db = await database();
      await db.insert(broadcasts).values({ message: input.message, status: "queued" });
      return { success: true };
    }),
  }),
});

export type AppRouter = typeof appRouter;
