import { createHmac, pbkdf2Sync } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decryptConfigPayload } from "./configFile";

const MAGIC = Buffer.from("NEBULA-NOOK-CONFIG-v2\n", "utf8");

function makePayload(plaintext: string, password: string) {
  const salt = Buffer.alloc(16, 7);
  const nonce = Buffer.alloc(32, 9);
  const material = pbkdf2Sync(password, salt, 390_000, 64, "sha256");
  const encryptionKey = material.subarray(0, 32);
  const authenticationKey = material.subarray(32);
  const input = Buffer.from(plaintext, "utf8");
  const ciphertext = Buffer.alloc(input.length);
  for (let offset = 0; offset < input.length; offset += 32) {
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(Math.floor(offset / 32)));
    const block = createHmac("sha256", encryptionKey)
      .update(Buffer.concat([nonce, counter]))
      .digest();
    for (let index = 0; index < Math.min(32, input.length - offset); index += 1) {
      ciphertext[offset + index] = input[offset + index] ^ block[index];
    }
  }
  const tag = createHmac("sha256", authenticationKey)
    .update(Buffer.concat([MAGIC, salt, nonce, ciphertext]))
    .digest();
  return Buffer.concat([MAGIC, Buffer.from(Buffer.concat([salt, nonce, tag, ciphertext]).toString("base64"), "utf8")]);
}

describe("encrypted config loader", () => {
  it("decrypts the Pydroid cfg.enc format", () => {
    const payload = makePayload("TELEGRAM_ADMIN_CHAT_ID=-5036785892\n", "test-pass");
    expect(decryptConfigPayload(payload, "test-pass")).toBe("TELEGRAM_ADMIN_CHAT_ID=-5036785892\n");
  });

  it("rejects an incorrect PASS", () => {
    const payload = makePayload("TELEGRAM_BOT_TOKEN=not-real\\n", "test-pass");
    expect(() => decryptConfigPayload(payload, "wrong-pass")).toThrow(/incorrect|modified/);
  });

  it("accepts the configured PASS for the real encrypted artifact without exposing values", () => {
    const password = process.env.PASS;
    expect(password).toBeTruthy();
    const plaintext = decryptConfigPayload(readFileSync("cfg.enc"), password as string);
    expect(plaintext).toContain("TELEGRAM_ADMIN_CHAT_ID=");
    expect(plaintext).toContain("BINANCE_PAY_API_KEY=");
  });
});
