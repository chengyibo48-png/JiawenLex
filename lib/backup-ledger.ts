import "server-only";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { HttpError } from "./server-auth";
import {
  backupLimits,
  storedBackupBytes,
  assertBackupCapacity,
} from "./backup-capacity";

export type Tombstone = {
  entity:
    | "account"
    | "member_removed"
    | "materials"
    | "practice_attempts"
    | "vocabulary"
    | "share_grants"
    | "writing_drafts"
    | "practice_sessions"
    | "purged_attempt"
    | "micro_attempts"
    | "micro_sessions"
    | "purged_micro_attempt"
    | "provider_key";
  entityId: string;
  ownerId: string;
  at: string;
  updatedBefore?: string;
  keyKind?: "text" | "asr";
};

export function backupClient(): {
  client: S3Client;
  bucket: string;
  key: Buffer;
} {
  const endpoint = process.env.BACKUP_S3_ENDPOINT;
  const region = process.env.BACKUP_S3_REGION;
  const bucket = process.env.BACKUP_S3_BUCKET;
  const accessKeyId = process.env.BACKUP_S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.BACKUP_S3_SECRET_ACCESS_KEY;
  const secret = process.env.BACKUP_ENCRYPTION_SECRET;
  if (
    !endpoint ||
    !region ||
    !bucket ||
    !accessKeyId ||
    !secretAccessKey ||
    !secret ||
    secret.length < 32
  )
    throw new HttpError(
      503,
      "独立备份存储尚未配置，暂不能执行删除或撤销操作。请由管理员完成备份配置。",
    );
  return {
    client: new S3Client({
      endpoint,
      region,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    }),
    bucket,
    key: createHash("sha256").update(secret).digest(),
  };
}

export function encryptBackupBytes(plain: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  return Buffer.concat([
    Buffer.from("JLEX1"),
    iv,
    cipher.update(plain),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
}

export async function recordTombstone(event: Tombstone): Promise<void> {
  const { client, bucket, key } = backupClient();
  const id = randomBytes(16).toString("hex");
  const body = encryptBackupBytes(Buffer.from(JSON.stringify(event)), key);
  try {
    const limits = backupLimits(process.env);
    assertBackupCapacity(
      await storedBackupBytes(client, bucket, limits.versioned),
      body.length,
      limits.storageBytes,
    );
  } catch {
    throw new HttpError(
      503,
      "备份容量已达到限额，或暂时无法核实容量，删除或撤销已暂停。请管理员检查备份空间和连接；已有记录不会因此被删除。",
    );
  }
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: `deletions/${event.at.slice(0, 10)}/${id}.jlex`,
      Body: body,
      ContentType: "application/octet-stream",
    }),
  );
}
