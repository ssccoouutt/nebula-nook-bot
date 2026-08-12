import { int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar, decimal, bigint } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const botUsers = mysqlTable("botUsers", {
  id: int("id").autoincrement().primaryKey(),
  telegramUserId: bigint("telegramUserId", { mode: "number" }).notNull().unique(),
  username: varchar("username", { length: 255 }),
  firstName: varchar("firstName", { length: 255 }),
  lastName: varchar("lastName", { length: 255 }),
  referralCode: varchar("referralCode", { length: 32 }).notNull().unique(),
  referredById: int("referredById"),
  tier: mysqlEnum("tier", ["Bronze", "Silver", "Gold"]).default("Bronze").notNull(),
  balanceCents: int("balanceCents").default(0).notNull(),
  accessGranted: int("accessGranted").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({ referredByIdx: uniqueIndex("botUsers_referral_code_idx").on(table.referralCode) }));

export const botSettings = mysqlTable("botSettings", {
  id: int("id").autoincrement().primaryKey(),
  key: varchar("key", { length: 128 }).notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const products = mysqlTable("products", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description").notNull(),
  priceCents: int("priceCents").notNull(),
  stock: int("stock").default(0).notNull(),
  active: int("active").default(1).notNull(),
  freeEligible: int("freeEligible").default(0).notNull(),
  freeWindowMs: bigint("freeWindowMs", { mode: "number" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const freeClaims = mysqlTable("freeClaims", {
  id: int("id").autoincrement().primaryKey(),
  botUserId: int("botUserId").notNull(),
  productId: int("productId").notNull(),
  windowStartMs: bigint("windowStartMs", { mode: "number" }).notNull(),
  status: mysqlEnum("status", ["claimed", "fulfilled", "cancelled"]).default("claimed").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({ claimUniq: uniqueIndex("freeClaims_user_product_window_idx").on(table.botUserId, table.productId, table.windowStartMs) }));

export const orders = mysqlTable("orders", {
  id: int("id").autoincrement().primaryKey(),
  botUserId: int("botUserId").notNull(),
  productId: int("productId").notNull(),
  kind: mysqlEnum("kind", ["purchase", "free"]).notNull(),
  amountCents: int("amountCents").notNull(),
  status: mysqlEnum("status", ["pending", "paid", "fulfilled", "cancelled"]).default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const walletLedger = mysqlTable("walletLedger", {
  id: int("id").autoincrement().primaryKey(),
  botUserId: int("botUserId").notNull(),
  amountCents: int("amountCents").notNull(),
  kind: mysqlEnum("kind", ["topup", "purchase", "refund", "referral_bonus", "adjustment"]).notNull(),
  referenceId: varchar("referenceId", { length: 128 }),
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const referrals = mysqlTable("referrals", {
  id: int("id").autoincrement().primaryKey(),
  referrerId: int("referrerId").notNull(),
  referredUserId: int("referredUserId").notNull().unique(),
  bonusCents: int("bonusCents").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const supportTickets = mysqlTable("supportTickets", {
  id: int("id").autoincrement().primaryKey(),
  botUserId: int("botUserId").notNull(),
  message: text("message").notNull(),
  status: mysqlEnum("status", ["open", "in_progress", "closed"]).default("open").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const broadcasts = mysqlTable("broadcasts", {
  id: int("id").autoincrement().primaryKey(),
  message: text("message").notNull(),
  status: mysqlEnum("status", ["queued", "sending", "completed", "failed"]).default("queued").notNull(),
  sentCount: int("sentCount").default(0).notNull(),
  failedCount: int("failedCount").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
  scheduleCronTaskUid: varchar("scheduleCronTaskUid", { length: 65 }),
});

export const notificationDeliveries = mysqlTable("notificationDeliveries", {
  id: int("id").autoincrement().primaryKey(),
  botUserId: int("botUserId"),
  adminChatId: bigint("adminChatId", { mode: "number" }),
  eventType: varchar("eventType", { length: 64 }).notNull(),
  referenceId: varchar("referenceId", { length: 128 }).notNull(),
  status: mysqlEnum("status", ["queued", "sent", "failed"]).default("queued").notNull(),
  error: text("error"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  sentAt: timestamp("sentAt"),
}, (table) => ({ deliveryUniq: uniqueIndex("notificationDeliveries_event_reference_idx").on(table.eventType, table.referenceId) }));

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type BotUser = typeof botUsers.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Order = typeof orders.$inferSelect;
