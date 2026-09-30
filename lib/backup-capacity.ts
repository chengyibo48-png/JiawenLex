import { DeleteObjectsCommand, ListObjectsV2Command, ListObjectVersionsCommand, type S3Client } from "@aws-sdk/client-s3";

// Keep the private original-PDF archive's 3 GB ceiling plus this backup
// ceiling below B2's 10 GB free storage allowance, with room for versions.
export const FREE_BACKUP_MAX_BYTES = 6_000_000_000;
export const FREE_SNAPSHOT_MAX_BYTES = 500_000_000;
export class BackupQuotaError extends Error {}

function limit(value: string | undefined, fallback: number, name: string): number {
  if (!value?.trim()) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0 || Number(value) > fallback) {
    throw new BackupQuotaError(name + " must be a positive integer no greater than " + fallback);
  }
  return Number(value);
}
export function backupLimits(env: Record<string, string | undefined>) {
  const endpoint = new URL(env.BACKUP_S3_ENDPOINT ?? "https://invalid.example");
  const flag = env.BACKUP_S3_VERSIONED?.trim();
  if (flag && !["true", "false"].includes(flag)) throw new BackupQuotaError("Invalid BACKUP_S3_VERSIONED");
  const backblaze = endpoint.hostname.endsWith(".backblazeb2.com");
  // B2 always stores versions: disabling the flag must not hide billed data.
  return { storageBytes: limit(env.BACKUP_MAX_STORAGE_BYTES, FREE_BACKUP_MAX_BYTES, "BACKUP_MAX_STORAGE_BYTES"), snapshotBytes: limit(env.BACKUP_MAX_SNAPSHOT_BYTES, FREE_SNAPSHOT_MAX_BYTES, "BACKUP_MAX_SNAPSHOT_BYTES"), versioned: backblaze || flag === "true" };
}
export function assertBackupCapacity(used: number, incoming: number, ceiling: number): void {
  if (![used, incoming, ceiling].every(Number.isSafeInteger) || used < 0 || incoming < 0 || ceiling <= 0) throw new BackupQuotaError("Unknown backup size; write paused");
  if (used > ceiling || incoming > ceiling - used) throw new BackupQuotaError("Backup capacity limit reached; new writes paused and existing recovery points retained");
}

type StoredObject = { Key: string; VersionId?: string; Size: number };
export async function listStoredBackupObjects(client: S3Client, bucket: string, versioned: boolean, prefix = ""): Promise<StoredObject[]> {
  const objects: StoredObject[] = [];
  const cursors = new Set<string>();
  let token: string | undefined, keyMarker: string | undefined, versionMarker: string | undefined;
  for (let pageIndex = 0; pageIndex < 100; pageIndex++) {
    if (versioned) {
      const page = await client.send(new ListObjectVersionsCommand({ Bucket: bucket, Prefix: prefix, KeyMarker: keyMarker, VersionIdMarker: versionMarker, MaxKeys: 1000 }));
      if (typeof page.IsTruncated !== "boolean") throw new BackupQuotaError("Incomplete storage pagination; write paused");
      for (const item of page.Versions ?? []) {
        if (!item.Key || !item.VersionId || item.Size === undefined || !Number.isSafeInteger(item.Size) || item.Size < 0 || !item.Key.startsWith(prefix)) throw new BackupQuotaError("Incomplete storage inventory; write paused");
        objects.push({ Key: item.Key, VersionId: item.VersionId, Size: item.Size });
      }
      for (const item of page.DeleteMarkers ?? []) {
        if (!item.Key || !item.VersionId || !item.Key.startsWith(prefix)) throw new BackupQuotaError("Incomplete storage inventory; write paused");
        objects.push({ Key: item.Key, VersionId: item.VersionId, Size: 0 });
      }
      if (!page.IsTruncated) return objects;
      keyMarker = page.NextKeyMarker; versionMarker = page.NextVersionIdMarker;
      if (!keyMarker) throw new BackupQuotaError("Incomplete storage pagination; write paused");
      token = JSON.stringify([keyMarker, versionMarker]);
    } else {
      const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000 }));
      if (typeof page.IsTruncated !== "boolean") throw new BackupQuotaError("Incomplete storage pagination; write paused");
      for (const item of page.Contents ?? []) {
        if (!item.Key || item.Size === undefined || !Number.isSafeInteger(item.Size) || item.Size < 0 || !item.Key.startsWith(prefix)) throw new BackupQuotaError("Incomplete storage inventory; write paused");
        objects.push({ Key: item.Key, Size: item.Size });
      }
      if (!page.IsTruncated) return objects;
      token = page.NextContinuationToken;
      if (!token) throw new BackupQuotaError("Incomplete storage pagination; write paused");
    }
    if (cursors.has(token)) throw new BackupQuotaError("Repeated storage pagination; write paused");
    cursors.add(token);
  }
  throw new BackupQuotaError("Storage inventory request limit reached; write paused");
}
export async function storedBackupBytes(client: S3Client, bucket: string, versioned: boolean): Promise<number> {
  let total = 0;
  for (const item of await listStoredBackupObjects(client, bucket, versioned)) {
    total += item.Size;
    if (!Number.isSafeInteger(total)) throw new BackupQuotaError("Unknown total backup size; write paused");
  }
  return total;
}
export async function removeBackupSnapshot(client: S3Client, bucket: string, versioned: boolean, prefix: string): Promise<void> {
  if (!/^snapshots\/[A-Za-z0-9-]+\/$/.test(prefix)) throw new Error("Refusing to remove an unexpected snapshot prefix");
  const objects = await listStoredBackupObjects(client, bucket, versioned, prefix);
  for (let start = 0; start < objects.length; start += 1000) {
    const result = await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Quiet: true, Objects: objects.slice(start, start + 1000).map(({Key, VersionId}) => ({Key, ...(VersionId ? {VersionId} : {})})) } }));
    if (result.Errors?.length) throw new Error("Backup retention could not remove all expired object versions");
  }
}
