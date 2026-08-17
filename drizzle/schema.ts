import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().defaultNow(),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull().defaultNow(),
};

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  openId: text("openId").notNull().unique(),
  name: text("name"), email: text("email"), loginMethod: text("loginMethod"),
  role: text("role").default("user").notNull(), ...timestamps,
  lastSignedIn: integer("lastSignedIn", { mode: "timestamp_ms" }).notNull().defaultNow(),
});
export const botUsers = sqliteTable("botUsers", {
  id: integer("id").primaryKey({ autoIncrement: true }), telegramUserId: integer("telegramUserId").notNull().unique(),
  username: text("username"), firstName: text("firstName"), lastName: text("lastName"),
  referralCode: text("referralCode").notNull().unique(), referredById: integer("referredById"),
  tier: text("tier").default("Bronze").notNull(), balanceCents: integer("balanceCents").default(0).notNull(), referralCredits: integer("referralCredits").default(0).notNull(), accessGranted: integer("accessGranted").default(0).notNull(), ...timestamps,
}, (table) => ({ referredByIdx: uniqueIndex("botUsers_referral_code_idx").on(table.referralCode) }));
export const botSettings = sqliteTable("botSettings", { id: integer("id").primaryKey({ autoIncrement: true }), key: text("key").notNull().unique(), value: text("value").notNull(), updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull().defaultNow() });
export const products = sqliteTable("products", { id: integer("id").primaryKey({ autoIncrement: true }), name: text("name").notNull(), description: text("description").notNull(), details: text("details").default("").notNull(), deliveryFormat: text("deliveryFormat").default("").notNull(), priceCents: integer("priceCents").notNull(), stock: integer("stock").default(0).notNull(), inventoryText: text("inventoryText").default("").notNull(), deliveryMode: text("deliveryMode").default("automatic").notNull(), warrantyDays: text("warrantyDays").default("").notNull(), imageUrl: text("imageUrl").default("").notNull(), active: integer("active").default(1).notNull(), freeEligible: integer("freeEligible").default(0).notNull(), freeWindowMs: integer("freeWindowMs"), shopEligible: integer("shopEligible").default(1).notNull(), referralEligible: integer("referralEligible").default(0).notNull(), referralPriceCredits: integer("referralPriceCredits").default(1).notNull(), ...timestamps });
export const freeClaims = sqliteTable("freeClaims", { id: integer("id").primaryKey({ autoIncrement: true }), botUserId: integer("botUserId").notNull(), productId: integer("productId").notNull(), windowStartMs: integer("windowStartMs").notNull(), status: text("status").default("claimed").notNull(), createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().defaultNow() }, (table) => ({ claimUniq: uniqueIndex("freeClaims_user_product_window_idx").on(table.botUserId, table.productId, table.windowStartMs) }));
export const orders = sqliteTable("orders", { id: integer("id").primaryKey({ autoIncrement: true }), botUserId: integer("botUserId").notNull(), productId: integer("productId").notNull(), kind: text("kind").notNull(), amountCents: integer("amountCents").notNull(), status: text("status").default("pending").notNull(), deliveredItem: text("deliveredItem"), purchaseWarranty: text("purchaseWarranty"), paymentMethod: text("paymentMethod"), quantity: integer("quantity").default(1).notNull(), ...timestamps });
export const walletLedger = sqliteTable("walletLedger", { id: integer("id").primaryKey({ autoIncrement: true }), botUserId: integer("botUserId").notNull(), amountCents: integer("amountCents").notNull(), kind: text("kind").notNull(), referenceId: text("referenceId"), note: text("note"), createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().defaultNow() });
export const binancePayDeposits = sqliteTable("binancePayDeposits", { id: integer("id").primaryKey({ autoIncrement: true }), botUserId: integer("botUserId").notNull(), transactionId: text("transactionId").notNull().unique(), amountCents: integer("amountCents").notNull(), asset: text("asset").notNull(), status: text("status").default("verified").notNull(), rawStatus: text("rawStatus"), createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().defaultNow() });
export const paymentIntents = sqliteTable("paymentIntents", { id: integer("id").primaryKey({ autoIncrement: true }), botUserId: integer("botUserId").notNull(), productId: integer("productId").notNull(), quantity: integer("quantity").notNull(), amountCents: integer("amountCents").notNull(), method: text("method").notNull(), status: text("status").default("pending").notNull(), transactionId: text("transactionId").unique(), ...timestamps });
export const referrals = sqliteTable("referrals", { id: integer("id").primaryKey({ autoIncrement: true }), referrerId: integer("referrerId").notNull(), referredUserId: integer("referredUserId").notNull().unique(), bonusCents: integer("bonusCents").default(0).notNull(), creditsAwarded: integer("creditsAwarded").default(1).notNull(), createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().defaultNow() });
export const priceAlerts = sqliteTable("priceAlerts", { id: integer("id").primaryKey({ autoIncrement: true }), botUserId: integer("botUserId").notNull(), productId: integer("productId").notNull(), active: integer("active").default(1).notNull(), ...timestamps }, (table) => ({ userProductUniq: uniqueIndex("priceAlerts_user_product_idx").on(table.botUserId, table.productId) }));
export const supportTickets = sqliteTable("supportTickets", { id: integer("id").primaryKey({ autoIncrement: true }), botUserId: integer("botUserId").notNull(), message: text("message").notNull(), status: text("status").default("open").notNull(), ...timestamps });
export const broadcasts = sqliteTable("broadcasts", { id: integer("id").primaryKey({ autoIncrement: true }), message: text("message").notNull(), status: text("status").default("queued").notNull(), sentCount: integer("sentCount").default(0).notNull(), failedCount: integer("failedCount").default(0).notNull(), createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().defaultNow(), completedAt: integer("completedAt", { mode: "timestamp_ms" }), scheduleCronTaskUid: text("scheduleCronTaskUid") });
export const notificationDeliveries = sqliteTable("notificationDeliveries", { id: integer("id").primaryKey({ autoIncrement: true }), botUserId: integer("botUserId"), adminChatId: integer("adminChatId"), eventType: text("eventType").notNull(), referenceId: text("referenceId").notNull(), status: text("status").default("queued").notNull(), error: text("error"), createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().defaultNow(), sentAt: integer("sentAt", { mode: "timestamp_ms" }) }, (table) => ({ deliveryUniq: uniqueIndex("notificationDeliveries_event_reference_idx").on(table.eventType, table.referenceId) }));

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type BotUser = typeof botUsers.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Order = typeof orders.$inferSelect;
