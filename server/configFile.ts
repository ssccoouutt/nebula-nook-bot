import { createHmac, pbkdf2Sync, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const MAGIC = Buffer.from("NEBULA-NOOK-CONFIG-v2\n", "utf8");
const SALT_BYTES = 16;
const NONCE_BYTES = 32;
const TAG_BYTES = 32;
const PBKDF2_ROUNDS = 390_000;

function xorKeystream(data: Buffer, key: Buffer, nonce: Buffer) {
  const output = Buffer.alloc(data.length);
  for (let offset = 0; offset < data.length; offset += 32) {
    const counter = Math.floor(offset / 32);
    const counterBuffer = Buffer.alloc(8);
    counterBuffer.writeBigUInt64BE(BigInt(counter));
    const block = createHmac("sha256", key)
      .update(Buffer.concat([nonce, counterBuffer]))
      .digest();
    const length = Math.min(block.length, data.length - offset);
    for (let index = 0; index < length; index += 1) {
      output[offset + index] = data[offset + index] ^ block[index];
    }
  }
  return output;
}

export function decryptConfigPayload(encodedFile: Buffer, password: string) {
  if (!encodedFile.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("Unsupported encrypted config format.");
  }
  const encoded = encodedFile.subarray(MAGIC.length).toString("utf8").replace(/\s/g, "");
  const packed = Buffer.from(encoded, "base64");
  const minimum = SALT_BYTES + NONCE_BYTES + TAG_BYTES;
  if (packed.length <= minimum) throw new Error("Encrypted config is incomplete.");

  const salt = packed.subarray(0, SALT_BYTES);
  const nonce = packed.subarray(SALT_BYTES, SALT_BYTES + NONCE_BYTES);
  const tagStart = SALT_BYTES + NONCE_BYTES;
  const tag = packed.subarray(tagStart, tagStart + TAG_BYTES);
  const ciphertext = packed.subarray(tagStart + TAG_BYTES);
  const material = pbkdf2Sync(password, salt, PBKDF2_ROUNDS, 64, "sha256");
  const encryptionKey = material.subarray(0, 32);
  const authenticationKey = material.subarray(32);
  const expectedTag = createHmac("sha256", authenticationKey)
    .update(Buffer.concat([MAGIC, salt, nonce, ciphertext]))
    .digest();
  if (!timingSafeEqual(tag, expectedTag)) {
    throw new Error("Encrypted config password is incorrect or the file was modified.");
  }
  return xorKeystream(ciphertext, encryptionKey, nonce).toString("utf8");
}

function applyEnvText(text: string) {
  let applied = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key) || !value) continue;
    process.env[key] = value;
    applied += 1;
  }
  return applied;
}

export function loadEncryptedConfig() {
  const configPath = resolve(process.env.CONFIG_FILE_PATH ?? "cfg.enc");
  if (!existsSync(configPath)) return { loaded: false, applied: 0 };
  const password = process.env.PASS;
  if (!password) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("PASS is required when cfg.enc exists.");
    }
    console.warn(`Encrypted config found at ${configPath}, but PASS is not set; continuing without it.`);
    return { loaded: false, applied: 0 };
  }
  const plaintext = decryptConfigPayload(readFileSync(configPath), password);
  const applied = applyEnvText(plaintext);
  console.log(`Loaded ${applied} encrypted configuration values.`);
  return { loaded: true, applied };
}
