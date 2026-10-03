import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify, parseArgs } from "node:util";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  S3Client, HeadBucketCommand, GetBucketAclCommand, HeadObjectCommand,
  CreateMultipartUploadCommand, AbortMultipartUploadCommand, ListPartsCommand,
  UploadPartCommand, CompleteMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { storedBackupBytes } from "../lib/backup-capacity.ts";
import { assertReleaseMutation } from "./release-policy.mjs";

// Local, owner-scoped ingestion of the explicitly requested 94-PDF collection.
// Originals are never rewritten. No credentials are stored in manifests or logs.
const PART_BYTES = 16 * 1024 * 1024;
const MAX_FILE_BYTES = 512 * 1024 * 1024;
const MAX_STORAGE_BYTES = 8_000_000_000;
const EXPECTED_COUNT = 94;
const EXPECTED_PAGES = 10086;
const EXPECTED_BYTES = 2205616946;
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    directory: { type: "string", default: "D:\\BaiduNetdiskDownload" },
    manifest: { type: "string", default: ".source-archive/manifest.json" },
    owner: { type: "string" },
    "release-version": { type: "string" },
  },
});
const mode = positionals[0] ?? "inventory";
if (mode === "upload") assertReleaseMutation();
if (!["inventory", "upload"].includes(mode)) throw new Error("Use inventory or upload --owner <uuid>");
const manifestPath = resolve(values.manifest);
const controller = new AbortController();
process.on("SIGINT", () => controller.abort());
const emit = (value) => console.log(JSON.stringify(value));
const required = (name) => {
  if (!process.env[name]?.trim()) throw new Error("Missing configuration: " + name);
  return process.env[name].trim();
};
const normalTag = (value) => String(value ?? "").replace(/^"|"$/g, "").toLowerCase();
const multipartTag = (parts) => createHash("md5").update(Buffer.concat(parts.map((part) => Buffer.from(part, "hex")))).digest("hex") + "-" + parts.length;
async function saveJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = path + ".tmp";
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", "utf8");
  await rename(temporary, path);
}
async function digestFile(path) {
  const before = await stat(path);
  const header = await open(path, "r");
  try {
    const bytes = Buffer.alloc(Math.min(1024, before.size));
    await header.read(bytes, 0, bytes.length, 0);
    if (!bytes.includes(Buffer.from("%PDF-"))) throw new Error("Not a PDF: " + basename(path));
  } finally { await header.close(); }
  const sha = createHash("sha256"), parts = [];
  let partHash = createHash("md5"), partBytes = 0;
  for await (const block of createReadStream(path, { highWaterMark: PART_BYTES })) {
    if (controller.signal.aborted) throw new Error("Upload paused");
    sha.update(block);
    for (let offset = 0; offset < block.length;) {
      const end = Math.min(block.length, offset + PART_BYTES - partBytes);
      partHash.update(block.subarray(offset, end));
      partBytes += end - offset;
      offset = end;
      if (partBytes === PART_BYTES) {
        parts.push(partHash.digest("hex"));
        partHash = createHash("md5"); partBytes = 0;
      }
    }
  }
  if (partBytes) parts.push(partHash.digest("hex"));
  const after = await stat(path);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error("File changed during checksum calculation");
  return { sha256: sha.digest("hex"), partMd5: parts, multipartEtag: multipartTag(parts), bytes: before.size, mtimeMs: before.mtimeMs };
}
async function inventory() {
  const directory = resolve(values.directory);
  const files = (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isFile() && /\.pdf$/i.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name));
  if (files.length !== EXPECTED_COUNT) throw new Error("This run is limited to the confirmed 94-PDF collection; found " + files.length);
  const mineru = process.env.MINERU_BIN || join(homedir(), ".local", "bin", "mineru.exe");
  const result = await promisify(execFile)(mineru, ["list", "docs", "--file-type", "pdf", "--limit", "200", "--json"], { maxBuffer: 8 * 1024 * 1024 });
  const docs = JSON.parse(result.stdout).docs;
  if (!Array.isArray(docs)) throw new Error("MinerU inventory unavailable");
  const pagesByHash = new Map(docs.filter((doc) => /^[a-f0-9]{64}$/.test(doc.sha256) && Number.isSafeInteger(doc.page_count) && doc.page_count > 0).map((doc) => [doc.sha256, doc.page_count]));
  const items = [];
  for (const file of files) {
    const path = join(directory, file.name);
    const checksums = await digestFile(path);
    if (checksums.bytes > MAX_FILE_BYTES) throw new Error("PDF exceeds 512 MiB: " + file.name);
    const pages = pagesByHash.get(checksums.sha256);
    if (!pages) throw new Error("No matching MinerU page count for: " + file.name);
    items.push({ path, name: file.name, ...checksums, pages });
  }
  const bytes = items.reduce((total, item) => total + item.bytes, 0), pages = items.reduce((total, item) => total + item.pages, 0);
  if (bytes !== EXPECTED_BYTES || pages !== EXPECTED_PAGES) throw new Error("Collection changed since the confirmed inventory");
  if (new Set(items.map((item) => item.sha256)).size !== EXPECTED_COUNT) throw new Error("Exact byte duplicates need an original-name alias review before upload");
  await saveJson(manifestPath, { format: "jiawenlex-originals-94-v1", directory, createdAt: new Date().toISOString(), count: items.length, bytes, pages, items });
  emit({ inventoryReady: true, count: items.length, bytes, pages, manifest: manifestPath });
}
function checkResult(result) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
function safeName(name) {
  return (name.slice(0, -4).normalize("NFKC").replace(/[^\p{L}\p{N}_.-]+/gu, "_").replace(/^\.+/, "").slice(0, 160) || "document") + ".pdf";
}
async function optionalHead(client, bucket, key) {
  try { return await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: controller.signal }); }
  catch (error) {
    if (error.$metadata?.httpStatusCode === 404 || ["NotFound", "NoSuchKey"].includes(error.name)) return null;
    throw error;
  }
}
function validateHead(head, item, document, owner) {
  if (head.ContentLength !== item.bytes || head.Metadata?.sha256 !== item.sha256 ||
    head.Metadata?.["owner-id"] !== owner || head.Metadata?.["document-id"] !== document.id ||
    normalTag(head.ETag) !== item.multipartEtag) throw new Error("Stored PDF failed size, identity or multipart checksum verification");
}
async function listParts(client, bucket, document, session) {
  const parts = new Map();
  let marker;
  for (let page = 0; page < 100; page++) {
    const result = await client.send(new ListPartsCommand({ Bucket: bucket, Key: document.object_key, UploadId: session.upload_id, PartNumberMarker: marker }), { abortSignal: controller.signal });
    for (const part of result.Parts ?? []) {
      if (!Number.isSafeInteger(part.PartNumber) || !part.ETag || !Number.isSafeInteger(part.Size) || parts.has(part.PartNumber)) throw new Error("Invalid multipart inventory");
      parts.set(part.PartNumber, part);
    }
    if (!result.IsTruncated) return parts;
    if (!result.NextPartNumberMarker || result.NextPartNumberMarker === marker) throw new Error("Incomplete multipart inventory");
    marker = result.NextPartNumberMarker;
  }
  throw new Error("Multipart pagination exceeded safety limit");
}
async function upload() {
  if (!values.owner || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(values.owner)) throw new Error("An explicit owner UUID is required");
  const owner = values.owner;
  const bucket = required("SOURCE_S3_BUCKET"), endpoint = new URL(required("SOURCE_S3_ENDPOINT"));
  if (bucket === process.env.BACKUP_S3_BUCKET) throw new Error("Originals must use a separate private bucket");
  if (endpoint.protocol !== "https:" || endpoint.pathname !== "/" || !endpoint.hostname.endsWith(".backblazeb2.com")) throw new Error("Expected the configured HTTPS B2 S3 endpoint");
  const limit = Number(process.env.SOURCE_MAX_STORAGE_BYTES ?? MAX_STORAGE_BYTES);
  if (!Number.isSafeInteger(limit) || limit < MAX_FILE_BYTES || limit > MAX_STORAGE_BYTES) throw new Error("Invalid archive capacity");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.format !== "jiawenlex-originals-94-v1" || manifest.count !== EXPECTED_COUNT || manifest.items?.length !== EXPECTED_COUNT ||
    manifest.bytes !== EXPECTED_BYTES || manifest.pages !== EXPECTED_PAGES || resolve(manifest.directory) !== resolve(values.directory)) throw new Error("Unexpected upload manifest");
  for (const item of manifest.items) {
    if (dirname(resolve(item.path)) !== resolve(manifest.directory) || basename(item.path) !== item.name || !/\.pdf$/i.test(item.name) ||
      !/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isSafeInteger(item.bytes) || item.bytes < 1 || item.bytes > MAX_FILE_BYTES ||
      !Number.isSafeInteger(item.pages) || item.pages < 1 || !Array.isArray(item.partMd5) || item.partMd5.length !== Math.ceil(item.bytes / PART_BYTES) ||
      item.partMd5.some((part) => !/^[a-f0-9]{32}$/.test(part)) || multipartTag(item.partMd5) !== item.multipartEtag) throw new Error("Invalid PDF manifest entry");
  }
  const admin = createClient(required("NEXT_PUBLIC_SUPABASE_URL"), process.env.SUPABASE_SECRET_KEY || required("SUPABASE_SERVICE_ROLE_KEY"), { auth: { autoRefreshToken: false, persistSession: false } });
  async function requireOwner() {
    const profile = checkResult(await admin.from("profiles").select("id,status").eq("id", owner).maybeSingle());
    if (!profile || profile.status !== "active") throw new Error("Upload owner is no longer an active member");
  }
  await requireOwner();
  const client = new S3Client({ endpoint: endpoint.origin, region: required("SOURCE_S3_REGION"), forcePathStyle: true,
    credentials: { accessKeyId: required("SOURCE_S3_ACCESS_KEY_ID"), secretAccessKey: required("SOURCE_S3_SECRET_ACCESS_KEY") },
    requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED", maxAttempts: 3,
  });
  await client.send(new HeadBucketCommand({ Bucket: bucket }));
  const acl = await client.send(new GetBucketAclCommand({ Bucket: bucket }));
  if ((acl.Grants ?? []).some((grant) => /AllUsers|AuthenticatedUsers/.test(grant.Grantee?.URI ?? ""))) throw new Error("The original archive bucket must be private");
  const summary = { startedAt: new Date().toISOString(), uploaded: 0, alreadyPresent: 0, failed: [], documents: [] };
  emit({ uploadStarted: true, files: manifest.items.length, bytes: manifest.bytes });
  for (const [index, item] of manifest.items.entries()) {
    if (controller.signal.aborted) break;
    try {
      await requireOwner();
      const digest = await digestFile(item.path);
      if (digest.sha256 !== item.sha256 || digest.multipartEtag !== item.multipartEtag || digest.bytes !== item.bytes) throw new Error("Original file changed; rebuild the inventory");
      let document = checkResult(await admin.from("source_documents").select("*").eq("owner_id", owner).eq("sha256", item.sha256).maybeSingle());
      if (document && (document.byte_size !== item.bytes || (document.page_count !== null && document.page_count !== item.pages) || !document.object_key.startsWith("originals/" + owner + "/" + document.id + "/"))) throw new Error("Existing archive identity conflicts with the original PDF");
      let head = document ? await optionalHead(client, bucket, document.object_key) : null;
      if (head) {
        validateHead(head, item, document, owner);
        checkResult(await admin.from("source_documents").update({ status: "ready", page_count: item.pages }).eq("id", document.id).eq("owner_id", owner));
        checkResult(await admin.from("source_upload_sessions").update({ status: "complete" }).eq("document_id", document.id).eq("owner_id", owner).eq("status", "uploading"));
        summary.alreadyPresent++;
        summary.documents.push({ id: document.id, name: item.name, status: "already_present", sha256: item.sha256 });
        emit({ file: index + 1, total: EXPECTED_COUNT, state: "already_present", name: item.name });
        await saveJson(join(dirname(manifestPath), "results.json"), summary);
        continue;
      }
      if (document?.status === "ready") throw new Error("An archived database entry has no matching stored PDF; automatic replacement paused");
      let session = document ? checkResult(await admin.from("source_upload_sessions").select("*").eq("owner_id", owner).eq("document_id", document.id).maybeSingle()) : null;
      const canResume = session && session.status === "uploading" && Date.parse(session.expires_at) > Date.now();
      if (!canResume) {
        const occupied = await storedBackupBytes(client, bucket, true);
        const active = checkResult(await admin.from("source_upload_sessions").select("expected_size").eq("status", "uploading").gt("expires_at", new Date().toISOString()));
        const reserved = active.reduce((sum, entry) => sum + entry.expected_size, 0);
        if (!Number.isSafeInteger(reserved) || occupied + reserved + item.bytes > limit) throw new Error("Archive capacity reached; upload paused");
        if (!document) {
          const id = randomUUID();
          document = checkResult(await admin.from("source_documents").insert({ id, owner_id: owner, title: item.name.slice(0, -4),
            original_name: item.name, object_key: "originals/" + owner + "/" + id + "/" + safeName(item.name),
            byte_size: item.bytes, sha256: item.sha256, page_count: item.pages, source_title: item.name, content_kind: "unknown" }).select("*").single());
        }
        if (session?.status === "uploading") {
          try { await client.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: document.object_key, UploadId: session.upload_id })); }
          catch (error) { if (error.name !== "NoSuchUpload") throw error; }
        }
        const created = await client.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: document.object_key, ContentType: "application/pdf",
          Metadata: { "document-id": document.id, "owner-id": owner, sha256: item.sha256 } }));
        if (!created.UploadId) throw new Error("No multipart upload ID returned");
        const sessionData = { owner_id: owner, document_id: document.id, object_key: document.object_key, upload_id: created.UploadId,
          expected_size: item.bytes, sha256: item.sha256, part_size: PART_BYTES, status: "uploading", expires_at: new Date(Date.now() + 7 * 86400000).toISOString() };
        session = session ? checkResult(await admin.from("source_upload_sessions").update(sessionData).eq("id", session.id).eq("owner_id", owner).select("*").single())
          : checkResult(await admin.from("source_upload_sessions").insert(sessionData).select("*").single());
      }
      if (session.sha256 !== item.sha256 || session.expected_size !== item.bytes || session.part_size !== PART_BYTES || session.object_key !== document.object_key) throw new Error("Resume identity mismatch");
      const existingParts = await listParts(client, bucket, document, session);
      if ([...existingParts.keys()].some((part) => part < 1 || part > item.partMd5.length)) throw new Error("Unexpected extra multipart parts");
      const completed = [];
      const handle = await open(item.path, "r");
      try {
        for (let number = 1; number <= item.partMd5.length; number++) {
          if (controller.signal.aborted) throw new Error("Upload paused");
          const length = Math.min(PART_BYTES, item.bytes - (number - 1) * PART_BYTES);
          const expectedMd5 = item.partMd5[number - 1], existing = existingParts.get(number);
          let etag = existing?.ETag;
          if (existing?.Size !== length || normalTag(etag) !== expectedMd5) {
            const body = Buffer.allocUnsafe(length);
            let offset = 0;
            while (offset < length) {
              const read = await handle.read(body, offset, length - offset, (number - 1) * PART_BYTES + offset);
              if (!read.bytesRead) throw new Error("Original file ended unexpectedly");
              offset += read.bytesRead;
            }
            if (createHash("md5").update(body).digest("hex") !== expectedMd5) throw new Error("Original part changed since the inventory");
            const result = await client.send(new UploadPartCommand({ Bucket: bucket, Key: document.object_key, UploadId: session.upload_id, PartNumber: number,
              Body: body, ContentLength: length, ContentMD5: Buffer.from(expectedMd5, "hex").toString("base64") }), { abortSignal: controller.signal });
            etag = result.ETag;
            if (normalTag(etag) !== expectedMd5) throw new Error("Uploaded part checksum did not match its original");
          }
          completed.push({ PartNumber: number, ETag: etag });
          emit({ file: index + 1, total: EXPECTED_COUNT, name: item.name, part: number, parts: item.partMd5.length, state: "uploading" });
        }
      } finally { await handle.close(); }
      const after = await stat(item.path);
      if (after.size !== digest.bytes || after.mtimeMs !== digest.mtimeMs) throw new Error("Original file changed during upload");
      await requireOwner();
      await client.send(new CompleteMultipartUploadCommand({ Bucket: bucket, Key: document.object_key, UploadId: session.upload_id, MultipartUpload: { Parts: completed } }), { abortSignal: controller.signal });
      head = await optionalHead(client, bucket, document.object_key);
      if (!head) throw new Error("Completed PDF could not be found");
      validateHead(head, item, document, owner);
      checkResult(await admin.from("source_documents").update({ status: "ready", page_count: item.pages }).eq("id", document.id).eq("owner_id", owner));
      checkResult(await admin.from("source_upload_sessions").update({ status: "complete" }).eq("id", session.id).eq("owner_id", owner));
      summary.uploaded++;
      summary.documents.push({ id: document.id, name: item.name, status: "uploaded", sha256: item.sha256 });
      emit({ file: index + 1, total: EXPECTED_COUNT, state: "verified", name: item.name, bytes: item.bytes, pages: item.pages });
    } catch (error) {
      summary.failed.push({ name: item.name, error: error.message });
      emit({ file: index + 1, state: controller.signal.aborted ? "paused" : "failed", name: item.name, error: error.message });
      if (controller.signal.aborted || /capacity|no longer an active/.test(error.message)) break;
    }
    await saveJson(join(dirname(manifestPath), "results.json"), summary);
  }
  summary.finishedAt = new Date().toISOString();
  await saveJson(join(dirname(manifestPath), "results.json"), summary);
  emit({ uploaded: summary.uploaded, alreadyPresent: summary.alreadyPresent, failed: summary.failed.length, paused: controller.signal.aborted });
  if (summary.failed.length || summary.uploaded + summary.alreadyPresent !== EXPECTED_COUNT) process.exitCode = 1;
}
try { if (mode === "inventory") await inventory(); else await upload(); }
catch (error) { emit({ failed: true, error: error.message }); process.exitCode = 1; }
