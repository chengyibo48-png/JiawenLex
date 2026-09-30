import "server-only";
import { DeleteObjectsCommand, ListObjectVersionsCommand, S3Client } from "@aws-sdk/client-s3";
import { HttpError } from "./server-auth";

export const SOURCE_MAX_FILE_BYTES = 536_870_912;
export const SOURCE_PART_BYTES = 16 * 1024 * 1024;
export const SOURCE_DEFAULT_BUCKET_BYTES = 3_000_000_000;

export function sourceStorage() {
  const endpoint = process.env.SOURCE_S3_ENDPOINT;
  const region = process.env.SOURCE_S3_REGION;
  const bucket = process.env.SOURCE_S3_BUCKET;
  const accessKeyId = process.env.SOURCE_S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.SOURCE_S3_SECRET_ACCESS_KEY;
  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey)
    throw new HttpError(503, "Large document storage is not configured");
  const parsed = new URL(endpoint);
  if (parsed.protocol !== "https:" || parsed.pathname !== "/")
    throw new HttpError(503, "Document storage endpoint must be an HTTPS origin");
  const maxBytes = Number(process.env.SOURCE_MAX_STORAGE_BYTES ?? SOURCE_DEFAULT_BUCKET_BYTES);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < SOURCE_MAX_FILE_BYTES || maxBytes > SOURCE_DEFAULT_BUCKET_BYTES)
    throw new HttpError(503, "Document storage limit must be between 512 MiB and 3 GB");
  return {
    bucket,
    maxBytes,
    client: new S3Client({
      endpoint,
      region,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    }),
  };
}

export async function usedSourceBytes(client: S3Client, bucket: string): Promise<number> {
  let keyMarker: string | undefined, versionIdMarker: string | undefined;
  let bytes = 0;
  const seen = new Set<string>();
  for (let page = 0; page < 100; page++) {
    const result = await client.send(new ListObjectVersionsCommand({ Bucket: bucket, Prefix: "originals/", KeyMarker: keyMarker, VersionIdMarker: versionIdMarker, MaxKeys: 1000 }));
    if (typeof result.IsTruncated !== "boolean") throw new HttpError(503, "Could not verify document storage usage");
    for (const item of result.Versions ?? []) {
      if (!item.Key?.startsWith("originals/") || !item.VersionId || !Number.isSafeInteger(item.Size) || (item.Size ?? -1) < 0)
        throw new HttpError(503, "Could not verify document storage usage");
      bytes += item.Size!;
      if (!Number.isSafeInteger(bytes)) throw new HttpError(503, "Document storage usage is unknown");
    }
    for (const item of result.DeleteMarkers ?? []) {
      if (!item.Key?.startsWith("originals/") || !item.VersionId) throw new HttpError(503, "Could not verify document storage usage");
    }
    if (!result.IsTruncated) return bytes;
    keyMarker = result.NextKeyMarker;
    versionIdMarker = result.NextVersionIdMarker;
    if (!keyMarker) throw new HttpError(503, "Document storage usage listing is incomplete");
    const cursor = `${keyMarker}/${versionIdMarker ?? ""}`;
    if (seen.has(cursor)) throw new HttpError(503, "Document storage usage listing repeated a page");
    seen.add(cursor);
  }
  throw new HttpError(503, "Document storage usage listing exceeded its safety limit");
}

export async function removeSourceOwnerVersions(client: S3Client, bucket: string, ownerId: string): Promise<void> {
  if (!/^[a-f\d-]{36}$/i.test(ownerId)) throw new Error("Invalid source owner id");
  const prefix = `originals/${ownerId}/`;
  let keyMarker: string | undefined, versionIdMarker: string | undefined;
  const seen = new Set<string>();
  const allVersions: { Key: string; VersionId: string }[] = [];
  let complete = false;
  for (let page = 0; page < 100; page++) {
    const result = await client.send(new ListObjectVersionsCommand({ Bucket: bucket, Prefix: prefix, KeyMarker: keyMarker, VersionIdMarker: versionIdMarker, MaxKeys: 1000 }));
    if (typeof result.IsTruncated !== "boolean") throw new Error("Private document versions could not be listed safely");
    const entries = [
      ...(result.Versions ?? []).map((item) => ({ Key: item.Key, VersionId: item.VersionId })),
      ...(result.DeleteMarkers ?? []).map((item) => ({ Key: item.Key, VersionId: item.VersionId })),
    ];
    if (entries.some((item) => !item.Key?.startsWith(prefix) || !item.VersionId)) throw new Error("Private document version inventory was incomplete");
    allVersions.push(...entries as { Key: string; VersionId: string }[]);
    if (!result.IsTruncated) { complete = true; break; }
    keyMarker = result.NextKeyMarker;
    versionIdMarker = result.NextVersionIdMarker;
    if (!keyMarker) throw new Error("Private document version pagination was incomplete");
    const cursor = `${keyMarker}/${versionIdMarker ?? ""}`;
    if (seen.has(cursor)) throw new Error("Private document version pagination repeated a page");
    seen.add(cursor);
  }
  if (!complete || allVersions.length >= 100000) throw new Error("Private document version listing exceeded its safety limit");
  for (let index = 0; index < allVersions.length; index += 1000) {
    const deleted = await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Quiet: true, Objects: allVersions.slice(index, index + 1000) } }));
    if (deleted.Errors?.length) throw new Error("Could not completely remove private PDF versions");
  }
}
