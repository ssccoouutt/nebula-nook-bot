import { z } from "zod";
import { desc, eq, sql } from "drizzle-orm";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { binancePayDeposits, botSettings, botUsers, broadcasts, orders, paymentIntents, referrals, products, supportTickets, walletLedger } from "../drizzle/schema";
import { TRPCError } from "@trpc/server";

function inventoryLines(value: string) {
  return value.replaceAll("\\n", "\n").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function productValues(input: { name: string; description: string; details: string; priceUsd: number; inventoryText: string; deliveryMode: "automatic" | "manual"; warrantyDays: number; imageUrl: string; freeEligible: boolean; freeWindowMs: number | null; referralEligible: boolean; referralPriceCredits: number; active?: boolean }) {
  const priceCents = Math.round(input.priceUsd * 100);
  if (!Number.isFinite(input.priceUsd) || priceCents < 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Price must be a valid non-negative USD amount" });
  const items = inventoryLines(input.inventoryText);
  return { name: input.name.trim(), description: input.description.trim(), details: input.details.trim(), priceCents, stock: items.length, inventoryText: items.join("\n"), deliveryMode: input.deliveryMode, warrantyDays: Math.max(0, Math.floor(input.warrantyDays)), imageUrl: input.imageUrl.trim(), freeEligible: input.freeEligible ? 1 : 0, freeWindowMs: input.freeWindowMs, referralEligible: input.referralEligible ? 1 : 0, referralPriceCredits: Math.max(1, Math.floor(input.referralPriceCredits)), ...(input.active === undefined ? {} : { active: input.active ? 1 : 0 }) };
}
import { buildFulfillmentNotifications, configureTelegramWebhook, notifyAdmin, notifyProductAvailability, sendTelegramMessage, validTelegramJoinUrl } from "./telegram";

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
    createProduct: adminProcedure.input(z.object({ name: z.string().min(1).max(255), description: z.string().min(1), details: z.string().default(""), priceUsd: z.number().nonnegative(), inventoryText: z.string().default(""), deliveryMode: z.enum(["automatic", "manual"]).default("automatic"), warrantyDays: z.number().int().nonnegative().default(0), imageUrl: z.string().url().or(z.literal("")).default(""), freeEligible: z.boolean(), freeWindowMs: z.number().int().positive().nullable(), referralEligible: z.boolean().default(false), referralPriceCredits: z.number().int().positive().default(1) })).mutation(async ({ input }) => {
      const db = await database();
      const values = productValues(input);
      const result = await db.insert(products).values({ ...values, active: 1 });
      const resultRow = Array.isArray(result) ? result[0] : result as any;
      const productId = Number(resultRow?.insertId ?? resultRow?.lastInsertRowid ?? 0);
      if (productId > 0 && values.stock > 0) await notifyProductAvailability({ id: productId, ...values }, "new_product", `created:${Date.now()}`);
      return { success: true };
    }),
    updateProduct: adminProcedure.input(z.object({ id: z.number().int(), name: z.string().min(1).max(255), description: z.string().min(1), details: z.string().default(""), priceUsd: z.number().nonnegative(), inventoryText: z.string().default(""), deliveryMode: z.enum(["automatic", "manual"]).default("automatic"), warrantyDays: z.number().int().nonnegative().default(0), imageUrl: z.string().url().or(z.literal("")).default(""), active: z.boolean(), freeEligible: z.boolean(), freeWindowMs: z.number().int().positive().nullable(), referralEligible: z.boolean().default(false), referralPriceCredits: z.number().int().positive().default(1) })).mutation(async ({ input }) => {
      const db = await database();
      const existing = (await db.select().from(products).where(eq(products.id, input.id)).limit(1))[0];
      const values = productValues(input);
      await db.update(products).set(values).where(eq(products.id, input.id));
      if (existing && values.active === 1 && values.stock > existing.stock) await notifyProductAvailability({ id: input.id, ...values }, "new_stock", `stock:${Date.now()}`);
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
    users: adminProcedure.input(z.object({ sort: z.enum(["lastActivity", "balance", "createdAt", "orders", "referrals"]).default("lastActivity"), direction: z.enum(["asc", "desc"]).default("desc"), limit: z.number().int().min(1).max(500).default(200) }).optional()).query(async ({ input }) => {
      const db = await database();
      const limit = input?.limit ?? 200;
      const [rows, orderRows, ledgerRows, referralRows, ticketRows, paymentRows] = await Promise.all([
        db.select().from(botUsers).limit(limit),
        db.select({ botUserId: orders.botUserId, count: sql<number>`count(*)`, lastAt: sql<number>`max(${orders.updatedAt})` }).from(orders).groupBy(orders.botUserId),
        db.select({ botUserId: walletLedger.botUserId, count: sql<number>`count(*)`, lastAt: sql<number>`max(${walletLedger.createdAt})` }).from(walletLedger).groupBy(walletLedger.botUserId),
        db.select({ referrerId: referrals.referrerId, count: sql<number>`count(*)`, lastAt: sql<number>`max(${referrals.createdAt})` }).from(referrals).groupBy(referrals.referrerId),
        db.select({ botUserId: supportTickets.botUserId, count: sql<number>`count(*)`, lastAt: sql<number>`max(${supportTickets.updatedAt})` }).from(supportTickets).groupBy(supportTickets.botUserId),
        db.select({ botUserId: paymentIntents.botUserId, lastAt: sql<number>`max(${paymentIntents.updatedAt})` }).from(paymentIntents).groupBy(paymentIntents.botUserId),
      ]);
      const byUser = new Map<number, { orders: number; referrals: number; lastActivity: number }>();
      const touch = (id: number, count: number, lastAt: number | null | undefined, field: "orders" | "referrals") => { const current = byUser.get(id) ?? { orders: 0, referrals: 0, lastActivity: 0 }; current[field] += Number(count ?? 0); current.lastActivity = Math.max(current.lastActivity, Number(lastAt ?? 0)); byUser.set(id, current); };
      for (const row of orderRows) touch(row.botUserId, row.count, row.lastAt, "orders");
      for (const row of ledgerRows) { const current = byUser.get(row.botUserId) ?? { orders: 0, referrals: 0, lastActivity: 0 }; current.lastActivity = Math.max(current.lastActivity, Number(row.lastAt ?? 0)); byUser.set(row.botUserId, current); }
      for (const row of referralRows) touch(row.referrerId, row.count, row.lastAt, "referrals");
      for (const row of ticketRows) { const current = byUser.get(row.botUserId) ?? { orders: 0, referrals: 0, lastActivity: 0 }; current.lastActivity = Math.max(current.lastActivity, Number(row.lastAt ?? 0)); byUser.set(row.botUserId, current); }
      for (const row of paymentRows) { const current = byUser.get(row.botUserId) ?? { orders: 0, referrals: 0, lastActivity: 0 }; current.lastActivity = Math.max(current.lastActivity, Number(row.lastAt ?? 0)); byUser.set(row.botUserId, current); }
      const enriched = rows.map((row) => { const stats = byUser.get(row.id) ?? { orders: 0, referrals: 0, lastActivity: 0 }; return { ...row, orderCount: stats.orders, referralCount: stats.referrals, lastActivity: stats.lastActivity || row.updatedAt.getTime() }; });
      const direction = input?.direction === "asc" ? 1 : -1;
      const sort = input?.sort ?? "lastActivity";
      enriched.sort((a, b) => { const av = sort === "balance" ? a.balanceCents : sort === "createdAt" ? a.createdAt.getTime() : sort === "orders" ? a.orderCount : sort === "referrals" ? a.referralCount : a.lastActivity; const bv = sort === "balance" ? b.balanceCents : sort === "createdAt" ? b.createdAt.getTime() : sort === "orders" ? b.orderCount : sort === "referrals" ? b.referralCount : b.lastActivity; return (av - bv) * direction; });
      return enriched;
    }),
    activitySummary: adminProcedure.input(z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).optional()).query(async ({ input }) => {
      const db = await database();
      const now = Date.now();
      const day = input?.day ?? new Date().toISOString().slice(0, 10);
      const dayStart = new Date(`${day}T00:00:00.000Z`).getTime();
      const dayEnd = dayStart + 86_400_000;
      const thirtyDaysAgo = now - 30 * 86_400_000;
      const [users, ordersRows, ledgerRows, referralRows, ticketsRows, paymentsRows] = await Promise.all([
        db.select().from(botUsers),
        db.select({ botUserId: orders.botUserId, at: orders.updatedAt }).from(orders).where(sql`${orders.updatedAt} >= ${thirtyDaysAgo}`),
        db.select({ botUserId: walletLedger.botUserId, at: walletLedger.createdAt }).from(walletLedger).where(sql`${walletLedger.createdAt} >= ${thirtyDaysAgo}`),
        db.select({ botUserId: referrals.referrerId, at: referrals.createdAt }).from(referrals).where(sql`${referrals.createdAt} >= ${thirtyDaysAgo}`),
        db.select({ botUserId: supportTickets.botUserId, at: supportTickets.updatedAt }).from(supportTickets).where(sql`${supportTickets.updatedAt} >= ${thirtyDaysAgo}`),
        db.select({ botUserId: paymentIntents.botUserId, at: paymentIntents.updatedAt }).from(paymentIntents).where(sql`${paymentIntents.updatedAt} >= ${thirtyDaysAgo}`),
      ]);
      const events = [...ordersRows, ...ledgerRows, ...referralRows, ...ticketsRows, ...paymentsRows];
      const todayActiveIds = new Set<number>(); const selectedDayIds = new Set<number>(); const last30Ids = new Set<number>();
      for (const event of events) { const timestamp = event.at instanceof Date ? event.at.getTime() : Number(event.at); if (timestamp >= thirtyDaysAgo) last30Ids.add(event.botUserId); if (timestamp >= dayStart && timestamp < dayEnd) selectedDayIds.add(event.botUserId); }
      for (const user of users) { const created = user.createdAt.getTime(); if (created >= thirtyDaysAgo) last30Ids.add(user.id); if (created >= dayStart && created < dayEnd) { selectedDayIds.add(user.id); todayActiveIds.add(user.id); } }
      return { selectedDay: day, selectedDayUserIds: Array.from(selectedDayIds), selectedDayCount: selectedDayIds.size, last30DayUserIds: Array.from(last30Ids), last30DayCount: last30Ids.size, totalUsers: users.length };
    }),
    userActivity: adminProcedure.input(z.object({ userId: z.number().int().positive() })).query(async ({ input }) => {
      const db = await database();
      const user = (await db.select().from(botUsers).where(eq(botUsers.id, input.userId)).limit(1))[0];
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "Bot user not found" });
      const [userOrders, userLedger, userDeposits, userReferrals, userTickets, userPayments] = await Promise.all([
        db.select().from(orders).where(eq(orders.botUserId, input.userId)),
        db.select().from(walletLedger).where(eq(walletLedger.botUserId, input.userId)),
        db.select().from(binancePayDeposits).where(eq(binancePayDeposits.botUserId, input.userId)),
        db.select().from(referrals).where(sql`${referrals.referrerId} = ${input.userId} OR ${referrals.referredUserId} = ${input.userId}`),
        db.select().from(supportTickets).where(eq(supportTickets.botUserId, input.userId)),
        db.select().from(paymentIntents).where(eq(paymentIntents.botUserId, input.userId)),
      ]);
      const events = [
        { type: "profile", id: user.id, at: user.createdAt.getTime(), label: "Joined ToolsMania bot", amountCents: 0 },
        ...userOrders.map((row) => ({ type: "order", id: row.id, at: row.updatedAt.getTime(), label: `Order #${row.id} · ${row.kind} · ${row.status}`, amountCents: row.amountCents })),
        ...userLedger.map((row) => ({ type: "wallet", id: row.id, at: row.createdAt.getTime(), label: `${row.kind} · ${row.note ?? "Wallet ledger entry"}`, amountCents: row.amountCents })),
        ...userDeposits.map((row) => ({ type: "deposit", id: row.id, at: row.createdAt.getTime(), label: `Verified ${row.asset} deposit · ${row.transactionId}`, amountCents: row.amountCents })),
        ...userReferrals.map((row) => ({ type: "referral", id: row.id, at: row.createdAt.getTime(), label: row.referrerId === input.userId ? `Referral invited user #${row.referredUserId}` : `Joined through referral #${row.referrerId}`, amountCents: row.bonusCents })),
        ...userTickets.map((row) => ({ type: "support", id: row.id, at: row.updatedAt.getTime(), label: `Support ticket #${row.id} · ${row.status}`, amountCents: 0 })),
        ...userPayments.map((row) => ({ type: "payment", id: row.id, at: row.updatedAt.getTime(), label: `Payment intent #${row.id} · ${row.method} · ${row.status}`, amountCents: row.amountCents })),
      ].sort((a, b) => b.at - a.at);
      return { user, events };
    }),
    adjustWallet: adminProcedure.input(z.object({ userId: z.number().int().positive(), amountUsd: z.number().finite().refine((value) => value !== 0, "Adjustment cannot be zero"), note: z.string().trim().min(3).max(500) })).mutation(async ({ input }) => {
      const db = await database();
      const amountCents = Math.round(input.amountUsd * 100);
      if (!Number.isSafeInteger(amountCents) || amountCents === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter a non-zero amount with at most two decimal places" });
      const user = (await db.select().from(botUsers).where(eq(botUsers.id, input.userId)).limit(1))[0];
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "Bot user not found" });
      const nextBalance = user.balanceCents + amountCents;
      if (nextBalance < 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Balance cannot become negative" });
      await db.update(botUsers).set({ balanceCents: nextBalance, updatedAt: new Date() }).where(eq(botUsers.id, user.id));
      await db.insert(walletLedger).values({ botUserId: user.id, amountCents, kind: "admin_adjustment", referenceId: `admin-${user.id}-${Date.now()}`, note: input.note });
      return { success: true, previousBalanceCents: user.balanceCents, balanceCents: nextBalance };
    }),
    ledger: adminProcedure.query(async () => (await database()).select().from(walletLedger).orderBy(desc(walletLedger.createdAt)).limit(300)),
    completedOrders: adminProcedure.input(z.object({ search: z.string().trim().max(200).default(""), limit: z.number().int().min(1).max(1000).default(500) }).optional()).query(async ({ input }) => {
      const db = await database();
      const [rows, users, catalog] = await Promise.all([
        db.select().from(orders).where(eq(orders.status, "fulfilled")).orderBy(desc(orders.updatedAt)).limit(input?.limit ?? 500),
        db.select().from(botUsers),
        db.select({ id: products.id, name: products.name }).from(products),
      ]);
      const userById = new Map(users.map((user) => [user.id, user])); const productById = new Map(catalog.map((product) => [product.id, product])); const search = (input?.search ?? "").toLowerCase();
      return rows.map((row) => { const user = userById.get(row.botUserId); const product = productById.get(row.productId); return { ...row, userName: [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "Unknown user", username: user?.username ?? "", telegramUserId: user?.telegramUserId ?? null, productName: product?.name ?? `Product #${row.productId}` }; }).filter((row) => !search || `${row.userName} ${row.username} ${row.telegramUserId ?? ""} ${row.productName} ${row.id} ${row.kind}`.toLowerCase().includes(search));
    }),
    deposits: adminProcedure.input(z.object({ search: z.string().trim().max(200).default(""), asset: z.string().trim().max(30).default(""), limit: z.number().int().min(1).max(1000).default(500) }).optional()).query(async ({ input }) => {
      const db = await database();
      const [rows, users] = await Promise.all([db.select().from(binancePayDeposits).orderBy(desc(binancePayDeposits.createdAt)).limit(input?.limit ?? 500), db.select().from(botUsers)]);
      const userById = new Map(users.map((user) => [user.id, user])); const search = (input?.search ?? "").toLowerCase(); const asset = (input?.asset ?? "").toLowerCase();
      return rows.map((row) => { const user = userById.get(row.botUserId); return { ...row, userName: [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "Unknown user", username: user?.username ?? "", telegramUserId: user?.telegramUserId ?? null }; }).filter((row) => (!asset || row.asset.toLowerCase() === asset) && (!search || `${row.userName} ${row.username} ${row.telegramUserId ?? ""} ${row.transactionId} ${row.asset} ${row.status}`.toLowerCase().includes(search)));
    }),
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
