import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";

const mode = process.argv[2];
const required = (name) => { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; };
function supabaseServerKey(prefix = "") {
  const value = process.env[`${prefix}SUPABASE_SECRET_KEY`] || process.env[`${prefix}SUPABASE_SERVICE_ROLE_KEY`];
  if (!value) throw new Error(`${prefix}SUPABASE_SECRET_KEY is required`);
  return value;
}
const s3 = new S3Client({ endpoint: required("BACKUP_S3_ENDPOINT"), region: required("BACKUP_S3_REGION"), forcePathStyle: true, credentials: { accessKeyId: required("BACKUP_S3_ACCESS_KEY_ID"), secretAccessKey: required("BACKUP_S3_SECRET_ACCESS_KEY") } });
const bucket = required("BACKUP_S3_BUCKET");
const secret = required("BACKUP_ENCRYPTION_SECRET");
if (secret.length < 32) throw new Error("BACKUP_ENCRYPTION_SECRET needs at least 32 random characters");
const key = createHash("sha256").update(secret).digest();
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function encrypt(plain) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  return Buffer.concat([Buffer.from("JLEX1"), iv, cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
}
function decrypt(data) {
  if (data.subarray(0, 5).toString() !== "JLEX1") throw new Error("Unrecognized backup format");
  const iv = data.subarray(5, 17);
  const tag = data.subarray(-16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data.subarray(17, -16)), decipher.final()]);
}
async function put(name, plain) { await s3.send(new PutObjectCommand({ Bucket: bucket, Key: name, Body: encrypt(plain), ContentType: "application/octet-stream" })); }
async function get(name) {
  const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: name }));
  return decrypt(Buffer.from(await object.Body.transformToByteArray()));
}
async function list(prefix, delimiter) {
  let token; const objects = []; const prefixes = [];
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, Delimiter: delimiter, ContinuationToken: token }));
    objects.push(...(page.Contents ?? []).map((item) => item.Key));
    prefixes.push(...(page.CommonPrefixes ?? []).map((item) => item.Prefix));
    token = page.NextContinuationToken;
  } while (token);
  return { objects, prefixes };
}
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "inherit", "inherit"], windowsHide: true });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}
async function storagePaths(client, bucketName, prefix = "") {
  const paths = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await client.storage.from(bucketName).list(prefix, { limit: 100, offset });
    if (error) throw error;
    for (const entry of data ?? []) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id) paths.push(path);
      else paths.push(...await storagePaths(client, bucketName, path));
    }
    if (!data || data.length < 100) break;
  }
  return paths;
}
async function completeSnapshots() {
  const prefixes = (await list("snapshots/", "/")).prefixes.sort();
  const complete = [];
  for (const prefix of prefixes) {
    const keys = (await list(prefix)).objects;
    if (keys.includes(`${prefix}manifest.jlex`)) complete.push(prefix);
  }
  return complete;
}
async function latestSnapshot() {
  const names = await completeSnapshots();
  if (!names.length) throw new Error("No complete snapshots found");
  return names.at(-1);
}
async function backup() {
  const dir = await mkdtemp(join(tmpdir(), "jiawenlex-backup-"));
  try {
    const dumpPath = join(dir, "database.dump");
    await run("pg_dump", ["--format=custom", "--no-owner", "--no-acl", "--file", dumpPath, "--dbname", required("DATABASE_URL")]);
    const dump = await readFile(dumpPath);
    const prefix = `snapshots/${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(4).toString("hex")}/`;
    await put(`${prefix}database.jlex`, dump);
    const client = createClient(required("NEXT_PUBLIC_SUPABASE_URL"), supabaseServerKey(), { auth: { persistSession: false } });
    const files = [];
    for (const bucketName of ["study-files", "study-audio"]) {
      for (const path of await storagePaths(client, bucketName)) {
        const { data, error } = await client.storage.from(bucketName).download(path);
        if (error) throw error;
        const bytes = Buffer.from(await data.arrayBuffer());
        const objectKey = `${prefix}files/${files.length}.jlex`;
        await put(objectKey, bytes);
        files.push({ bucket: bucketName, path, objectKey, sha256: hash(bytes), bytes: bytes.length });
      }
    }
    const manifest = { version: 1, at: new Date().toISOString(), database: { objectKey: `${prefix}database.jlex`, sha256: hash(dump), bytes: dump.length }, files };
    // The manifest is uploaded last. Its presence marks a complete snapshot.
    await put(`${prefix}manifest.jlex`, Buffer.from(JSON.stringify(manifest)));
    // Retain four complete snapshots. An interrupted upload without a manifest is never
    // considered a backup and cannot displace the last usable recovery point.
    const old = (await completeSnapshots()).slice(0, -4);
    for (const previous of old) {
      const keys = (await list(previous)).objects;
      for (let i = 0; i < keys.length; i += 1000) await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })) } }));
    }
    console.log(`Encrypted snapshot complete: ${prefix}, ${files.length} file(s)`);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
async function verify() {
  const prefix = await latestSnapshot();
  const manifest = JSON.parse((await get(`${prefix}manifest.jlex`)).toString());
  const dump = await get(manifest.database.objectKey);
  if (hash(dump) !== manifest.database.sha256) throw new Error("Database dump checksum mismatch");
  for (const file of manifest.files) if (hash(await get(file.objectKey)) !== file.sha256) throw new Error(`File checksum mismatch: ${file.path}`);
  const dir = await mkdtemp(join(tmpdir(), "jiawenlex-verify-"));
  try { const path = join(dir, "database.dump"); await writeFile(path, dump); await run("pg_restore", ["--list", path]); }
  finally { await rm(dir, { recursive: true, force: true }); }
  console.log(`Snapshot verified: ${prefix}, ${manifest.files.length} file(s)`);
}
function quotedUuid(value) {
  if (!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value)) throw new Error("Invalid tombstone UUID");
  return `'${value}'::uuid`;
}
async function replayDeletions() {
  if (process.env.RESTORE_CONFIRM !== "fresh-recovery-project") throw new Error("Set RESTORE_CONFIRM=fresh-recovery-project only after restoring a disposable recovery database");
  const url = required("RECOVERY_DATABASE_URL");
  const names = (await list("deletions/")).objects.filter((name) => name.endsWith(".jlex"));
  const events = [];
  for (const name of names) events.push(JSON.parse((await get(name)).toString()));
  events.sort((a, b) => a.at.localeCompare(b.at));
  const sql = ["begin;"];
  for (const item of events) {
    const id = quotedUuid(item.entityId);
    if (item.entity === "account") {
      sql.push(`update public.materials set owner_id = (select id from public.profiles where role = 'admin' and status = 'active' and id <> ${id} order by created_at limit 1) where owner_id = ${id} and visibility = 'shared' and approval = 'approved' and license_name <> '' and exists (select 1 from public.profiles where role = 'admin' and status = 'active' and id <> ${id});`);
      sql.push(`delete from auth.users where id = ${id};`);
    }
    else if (item.entity === "member_removed") sql.push(`update public.profiles set status = 'removed' where id = ${id};`);
    else if (["materials", "practice_attempts", "vocabulary", "share_grants", "writing_drafts"].includes(item.entity)) sql.push(`delete from public.${item.entity} where id = ${id};`);
    else if (item.entity === "purged_attempt") sql.push(`update public.practice_attempts set answer_body = null, feedback = null, transcript = null, recording_path = null, saved_recording = false, purged_at = now() where id = ${id};`);
    else throw new Error(`Unknown tombstone: ${item.entity}`);
  }
  sql.push("commit;");
  const dir = await mkdtemp(join(tmpdir(), "jiawenlex-replay-"));
  try { const path = join(dir, "deletions.sql"); await writeFile(path, sql.join("\n")); await run("psql", ["--set", "ON_ERROR_STOP=1", "--dbname", url, "--file", path]); }
  finally { await rm(dir, { recursive: true, force: true }); }
  console.log(`Replayed ${events.length} deletion event(s) in the recovery database`);
}
async function restoreFiles() {
  if (process.env.RESTORE_CONFIRM !== "fresh-recovery-project") throw new Error("Set RESTORE_CONFIRM=fresh-recovery-project only after replaying deletions in a disposable recovery project");
  const client = createClient(required("RECOVERY_SUPABASE_URL"), supabaseServerKey("RECOVERY_"), { auth: { persistSession: false } });
  const prefix = await latestSnapshot();
  const manifest = JSON.parse((await get(`${prefix}manifest.jlex`)).toString());
  let restored = 0;
  for (const file of manifest.files) {
    const query = file.bucket === "study-files"
      ? client.from("materials").select("id").eq("file_path", file.path).limit(1)
      : client.from("practice_attempts").select("id").eq("recording_path", file.path).is("purged_at", null).limit(1);
    const { data, error } = await query;
    if (error) throw error;
    if (!data?.length) continue;
    const bytes = await get(file.objectKey);
    if (hash(bytes) !== file.sha256) throw new Error(`File checksum mismatch: ${file.path}`);
    const { error: uploadError } = await client.storage.from(file.bucket).upload(file.path, bytes, { upsert: true });
    if (uploadError) throw uploadError;
    restored++;
  }
  console.log(`Restored ${restored} still-authorized file(s)`);
}

if (mode === "backup") await backup();
else if (mode === "verify") await verify();
else if (mode === "replay-deletions") await replayDeletions();
else if (mode === "restore-files") await restoreFiles();
else throw new Error("Usage: node scripts/backup.mjs backup|verify|replay-deletions|restore-files");
