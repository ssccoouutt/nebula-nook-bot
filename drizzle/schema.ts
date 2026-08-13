import { bigint, integer, pgTable, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
};

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"), email: varchar("email", { length: 320 }), loginMethod: varchar("loginMethod", { length: 64 }),
  role: text("role").default("user").notNull(), ...timestamps,
  lastSignedIn: timestamp("lastSignedIn", { withTimezone: true }).defaultNow().notNull(),
});
export const botUsers = pgTable("botUsers", {
  id: serial("id").primaryKey(), telegramUserId: bigint("telegramUserId", { mode: "number" }).notNull().unique(),
  username: varchar("username", { length: 255 }), firstName: varchar("firstName", { length: 255 }), lastName: varchar("lastName", { length: 255 }),
  referralCode: varchar("referralCode", { length: 32 }).notNull().unique(), referredById: integer("referredById"),
  tier: text("tier").default("Bronze").notNull(), balanceCents: integer("balanceCents").default(0).notNull(), accessGranted: integer("accessGranted").default(0).notNull(), ...timestamps,
}, (table) => ({ referredByIdx: uniqueIndex("botUsers_referral_code_idx").on(table.referralCode) }));
export const botSettings = pgTable("botSettings", { id: serial("id").primaryKey(), key: varchar("key", { length: 128 }).notNull().unique(), value: text("value").notNull(), updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull() });
export const products = pgTable("products", { id: serial("id").primaryKey(), name: varchar("name", { length: 255 }).notNull(), description: text("description").notNull(), priceCents: integer("priceCents").notNull(), stock: integer("stock").default(0).notNull(), active: integer("active").default(1).notNull(), freeEligible: integer("freeEligible").default(0).notNull(), freeWindowMs: bigint("freeWindowMs", { mode: "number" }), ...timestamps });
export const freeClaims = pgTable("freeClaims", { id: serial("id").primaryKey(), botUserId: integer("botUserId").notNull(), productId: integer("productId").notNull(), windowStartMs: bigint("windowStartMs", { mode: "number" }).notNull(), status: text("status").default("claimed").notNull(), createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull() }, (table) => ({ claimUniq: uniqueIndex("freeClaims_user_product_window_idx").on(table.botUserId, table.productId, table.windowStartMs) }));
export const orders = pgTable("orders", { id: serial("id").primaryKey(), botUserId: integer("botUserId").notNull(), productId: integer("productId").notNull(), kind: text("kind").notNull(), amountCents: integer("amountCents").notNull(), status: text("status").default("pending").notNull(), ...timestamps });
export const walletLedger = pgTable("walletLedger", { id: serial("id").primaryKey(), botUserId: integer("botUserId").notNull(), amountCents: integer("amountCents").notNull(), kind: text("kind").notNull(), referenceId: varchar("referenceId", { length: 128 }), note: text("note"), createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull() });
export const binancePayDeposits = pgTable("binancePayDeposits", { id: serial("id").primaryKey(), botUserId: integer("botUserId").notNull(), transactionId: varchar("transactionId", { length: 128 }).notNull().unique(), amountCents: integer("amountCents").notNull(), asset: varchar("asset", { length: 16 }).notNull(), status: text("status").default("verified").notNull(), rawStatus: varchar("rawStatus", { length: 64 }), createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull() });
export const paymentIntents = pgTable("paymentIntents", { id: serial("id").primaryKey(), botUserId: integer("botUserId").notNull(), productId: integer("productId").notNull(), quantity: integer("quantity").notNull(), amountCents: integer("amountCents").notNull(), method: text("method").notNull(), status: text("status").default("pending").notNull(), transactionId: varchar("transactionId", { length: 128 }).unique(), ...timestamps });
export const referrals = pgTable("referrals", { id: serial("id").primaryKey(), referrerId: integer("referrerId").notNull(), referredUserId: integer("referredUserId").notNull().unique(), bonusCents: integer("bonusCents").default(0).notNull(), createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull() });
export const priceAlerts = pgTable("priceAlerts", { id: serial("id").primaryKey(), botUserId: integer("botUserId").notNull(), productId: integer("productId").notNull(), active: integer("active").default(1).notNull(), ...timestamps }, (table) => ({ userProductUniq: uniqueIndex("priceAlerts_user_product_idx").on(table.botUserId, table.productId) }));
export const supportTickets = pgTable("supportTickets", { id: serial("id").primaryKey(), botUserId: integer("botUserId").notNull(), message: text("message").notNull(), status: text("status").default("open").notNull(), ...timestamps });
export const broadcasts = pgTable("broadcasts", { id: serial("id").primaryKey(), message: text("message").notNull(), status: text("status").default("queued").notNull(), sentCount: integer("sentCount").default(0).notNull(), failedCount: integer("failedCount").default(0).notNull(), createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(), completedAt: timestamp("completedAt", { withTimezone: true }), scheduleCronTaskUid: varchar("scheduleCronTaskUid", { length: 65 }) });
export const notificationDeliveries = pgTable("notificationDeliveries", { id: serial("id").primaryKey(), botUserId: integer("botUserId"), adminChatId: bigint("adminChatId", { mode: "number" }), eventType: varchar("eventType", { length: 64 }).notNull(), referenceId: varchar("referenceId", { length: 128 }).notNull(), status: text("status").default("queued").notNull(), error: text("error"), createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(), sentAt: timestamp("sentAt", { withTimezone: true }) }, (table) => ({ deliveryUniq: uniqueIndex("notificationDeliveries_event_reference_idx").on(table.eventType, table.referenceId) }));

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type BotUser = typeof botUsers.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Order = typeof orders.$inferSelect;
