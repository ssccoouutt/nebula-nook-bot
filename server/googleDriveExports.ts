import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

type Row = Record<string, unknown>;

const TABLES = [
  ["users", "users.json"],
  ["botUsers", "bot_users.json"],
  ["products", "products.json"],
  ["orders", "orders.json"],
  ["walletLedger", "wallet_ledger.json"],
  ["binancePayDeposits", "deposits.json"],
  ["paymentIntents", "payment_intents.json"],
  ["referrals", "referrals.json"],
  ["freeClaims", "free_claims.json"],
  ["priceAlerts", "price_alerts.json"],
  ["supportTickets", "support_tickets.json"],
  ["broadcasts", "broadcasts.json"],
  ["notificationDeliveries", "notification_deliveries.json"],
  ["botSettings", "settings.json"],
] as const;

function databasePath() {
  const storageDir = process.env.KOYEB_DATA_DIR || path.resolve(process.cwd(), "data", "nebula-nook");
  return path.join(storageDir, "nebula-nook.sqlite");
}

function rows(client: InstanceType<typeof DatabaseSync>, table: string) {
  return client.prepare(`SELECT * FROM "${table}" ORDER BY id ASC`).all() as Row[];
}

function formatDate(value: unknown) {
  if (typeof value !== "number") return value ?? null;
  return new Date(value).toISOString();
}

function enrichedOrders(client: InstanceType<typeof DatabaseSync>) {
  return client.prepare(`
    SELECT o.*, p.name AS productName, p.description AS productDescription,
           b.telegramUserId AS buyerTelegramId, b.username AS buyerUsername,
           b.firstName AS buyerFirstName, b.lastName AS buyerLastName
    FROM orders o
    LEFT JOIN products p ON p.id = o.productId
    LEFT JOIN botUsers b ON b.id = o.botUserId
    ORDER BY o.id ASC
  `).all() as Row[];
}

function stockFileName(name: string, id: unknown) {
  const safe = name.trim().replace(/[^a-zA-Z0-9._ -]+/g, "").replace(/\s+/g, " ").trim() || `product-${id}`;
  return `${safe}.txt`;
}

export function buildProductStockExports(products: Row[]) {
  const exports: Record<string, string> = {};
  const usedNames = new Set<string>();
  for (const product of products) {
    const baseName = stockFileName(String(product.name ?? "Product"), product.id);
    let fileName = baseName;
    if (usedNames.has(fileName)) fileName = stockFileName(`${String(product.name ?? "Product")}-${product.id}`, product.id);
    usedNames.add(fileName);
    const stock = String(product.inventoryText ?? "").replaceAll("\\n", "\n").split(/\r?\n/).map(item => item.trim()).filter(Boolean);
    exports[fileName] = stock.length ? `${stock.join("\n")}\n` : "";
  }
  return exports;
}

export function formatOrderHistory(orders: Row[]) {
  return orders.map(order => [
    `Order #${order.id}`,
    `Buyer: ${order.buyerFirstName || ""} ${order.buyerLastName || ""}`.trim() + ` | Telegram ID: ${order.buyerTelegramId ?? "unknown"} | Username: ${order.buyerUsername ? `@${order.buyerUsername}` : "not set"}`,
    `Product: ${order.productName ?? "unknown"}`,
    `Quantity: ${order.quantity ?? 1}`,
    `Kind: ${order.kind} | Payment status: ${order.status}`,
    `Amount: $${(Number(order.amountCents || 0) / 100).toFixed(2)}`,
    `Transaction ID: ${order.transactionId ?? "not applicable"}`,
    `Created: ${formatDate(order.createdAt)} | Updated: ${formatDate(order.updatedAt)}`,
  ].join("\n")).join("\n\n");
}

export function buildReadableExports() {
  const client = new DatabaseSync(databasePath(), { readOnly: true });
  try {
    const exports: Record<string, string> = {};
    for (const [table, fileName] of TABLES) {
      const data = table === "orders" ? enrichedOrders(client) : rows(client, table);
      exports[fileName] = JSON.stringify(data, (_key, value) => {
        if (typeof value === "bigint") return Number(value);
        return value;
      }, 2);
    }
    const orders = enrichedOrders(client);
    Object.assign(exports, buildProductStockExports(rows(client, "products")));
    exports["orders.txt"] = formatOrderHistory(orders) + (orders.length ? "\n\n" : "");
    exports["README.txt"] = [
      "ToolsMania Bot data export",
      "",
      "These files contain the complete human-readable export of the local SQLite dataset.",
      "JSON files preserve every stored field. orders.txt is a readable order history with two blank lines between orders.",
      `Generated: ${new Date().toISOString()}`,
      `Orders exported: ${orders.length}`,
    ].join("\n") + "\n";
    return exports;
  } finally {
    client.close();
  }
}
