import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function encryptionKey(): Buffer {
  const secret = process.env.AI_KEY_ENCRYPTION_SECRET;
  if (!secret || secret.length < 32) throw new Error("AI_KEY_ENCRYPTION_SECRET must contain at least 32 random characters");
  return createHash("sha256").update(secret, "utf8").digest();
}

export function encryptKey(plain: string): { encrypted_key: string; iv: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return { encrypted_key: encrypted.toString("base64"), iv: iv.toString("base64") };
}

export function decryptKey(encrypted: string, ivValue: string): string {
  const raw = Buffer.from(encrypted, "base64");
  const iv = Buffer.from(ivValue, "base64");
  const tag = raw.subarray(raw.length - 16);
  const body = raw.subarray(0, raw.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}
