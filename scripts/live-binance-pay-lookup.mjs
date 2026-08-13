import crypto from "node:crypto";

const apiKey = process.env.BINANCE_PAY_API_KEY;
const secretKey = process.env.BINANCE_PAY_SECRET_KEY;
const searchId = process.argv[2] ?? "448035041403518976";
if (!apiKey || !secretKey) throw new Error("Binance credentials are not configured");

async function request(params) {
  const signed = new URLSearchParams({ ...params, timestamp: String(Date.now()), recvWindow: "60000" });
  const signature = crypto.createHmac("sha256", secretKey).update(signed.toString()).digest("hex");
  signed.set("signature", signature);
  const response = await fetch(`https://api.binance.com/sapi/v1/pay/transactions?${signed}`, { headers: { "X-MBX-APIKEY": apiKey } });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.msg ?? `HTTP ${response.status}`);
  return payload;
}

let payload;
try {
  payload = await request({ limit: "200" });
} catch (firstError) {
  console.log(`limit_request_failed=${firstError.message}`);
  payload = await request({});
}
const transactions = Array.isArray(payload?.data) ? payload.data : [];
const needle = String(searchId).trim();
const matches = transactions.filter((tx) => {
  const orderId = String(tx.orderId ?? "");
  const transactionId = String(tx.transactionId ?? "");
  return needle === orderId || needle.includes(orderId) || orderId.includes(needle) || needle === transactionId || needle.includes(transactionId) || transactionId.includes(needle);
});
console.log(JSON.stringify({ transactionCount: transactions.length, matchCount: matches.length, matches: matches.map((tx) => ({ orderId: tx.orderId ?? null, transactionId: tx.transactionId ?? null, amount: tx.amount ?? null, currency: tx.currency ?? tx.asset ?? null, status: tx.status ?? null })) }));
