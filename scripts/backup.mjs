import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, relative, isAbsolute } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { encryptionKey, encrypt, decrypt, hash, snapshotPrefix, validateManifest, validateBytes, assertRecoveryTarget, deletionReplaySql, verifyThenPrune, recoveryTables, recoveryTableData } from "./backup-core.mjs";

import { backupLimits, storedBackupBytes, assertBackupCapacity, removeBackupSnapshot } from "../lib/backup-capacity.ts";

const mode = process.argv[2];
if (!["backup", "verify", "replay-deletions", "restore-files", "download", "restore-database"].includes(mode)) throw new Error("Usage: node scripts/backup.mjs backup|verify|download|restore-database|replay-deletions|restore-files");
const required = (name) => { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; };
function supabaseServerKey(prefix = "") {
  const value = process.env[`${prefix}SUPABASE_SECRET_KEY`] || process.env[`${prefix}SUPABASE_SERVICE_ROLE_KEY`];
  if (!value) throw new Error(`${prefix}SUPABASE_SECRET_KEY is required`);
  return value;
}
const s3 = new S3Client({ endpoint: required("BACKUP_S3_ENDPOINT"), region: required("BACKUP_S3_REGION"), forcePathStyle: true, credentials: { accessKeyId: required("BACKUP_S3_ACCESS_KEY_ID"), secretAccessKey: required("BACKUP_S3_SECRET_ACCESS_KEY") } });
const bucket = required("BACKUP_S3_BUCKET");
const key = encryptionKey(required("BACKUP_ENCRYPTION_SECRET"));
const limits = backupLimits(process.env);
let occupiedBytes = null, snapshotWriteBytes = 0;
async function put(name, plain, { snapshot = true, metadata } = {}) {
  const body = encrypt(plain, key);
  if (mode === "backup" && snapshot) assertBackupCapacity(snapshotWriteBytes, body.length, limits.snapshotBytes);
  if (occupiedBytes === null) occupiedBytes = await storedBackupBytes(s3, bucket, limits.versioned);
  assertBackupCapacity(occupiedBytes, body.length, limits.storageBytes);
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: name, Body: body, ContentType: "application/octet-stream", ...(metadata ? { Metadata: metadata } : {}) }));
  occupiedBytes += body.length;
  if (mode === "backup" && snapshot) snapshotWriteBytes += body.length;
}
async function get(name) {
  const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: name }));
  return decrypt(Buffer.from(await object.Body.transformToByteArray()), key);
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
function run(command, args, databaseUrl, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, ...extraEnv };
    if (databaseUrl) {
      const url = new URL(databaseUrl);
      Object.assign(env, { PGHOST: url.hostname, PGPORT: url.port || "5432", PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGSSLMODE: url.searchParams.get("sslmode") || "require", PGCONNECT_TIMEOUT: "20" });
    }
    // Do not put database passwords in process arguments or echo restored data.
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], env, windowsHide: true });
    let stdout = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", () => {});
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve(stdout) : reject(new Error(`${command} exited ${code}; check database access and PostgreSQL client version`)));
  });
}
async function cleanTemp(dir) {
  const absolute = resolve(dir), parent = resolve(tmpdir()), rel = relative(parent, absolute);
  if (!rel || isAbsolute(rel) || rel.startsWith("..") || !/^jiawenlex-(backup|verify|replay)-[^\\/]+$/.test(rel)) throw new Error("Refusing to remove an unexpected temporary directory");
  await rm(absolute, { recursive: true, force: true });
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
    if (keys.includes(`${prefix}manifest.jlex`) && keys.includes(`${prefix}verified.jlex`)) complete.push(prefix);
  }
  return complete;
}
function sourceReader() {
  return {
    client: new S3Client({
      endpoint: required("SOURCE_S3_ENDPOINT"),
      region: required("SOURCE_S3_REGION"),
      forcePathStyle: true,
      credentials: { accessKeyId: required("SOURCE_BACKUP_S3_ACCESS_KEY_ID"), secretAccessKey: required("SOURCE_BACKUP_S3_SECRET_ACCESS_KEY") },
    }),
    bucket: required("SOURCE_S3_BUCKET"),
  };
}
function sourceRestorer() {
  return {
    client: new S3Client({
      endpoint: required("SOURCE_S3_ENDPOINT"),
      region: required("SOURCE_S3_REGION"),
      forcePathStyle: true,
      credentials: { accessKeyId: required("SOURCE_RESTORE_S3_ACCESS_KEY_ID"), secretAccessKey: required("SOURCE_RESTORE_S3_SECRET_ACCESS_KEY") },
    }),
    bucket: required("SOURCE_S3_BUCKET"),
  };
}
async function latestSnapshot() {
  if (process.env.SNAPSHOT_PREFIX) return snapshotPrefix(process.env.SNAPSHOT_PREFIX);
  const names = await completeSnapshots();
  if (!names.length) throw new Error("No complete snapshots found");
  return names.at(-1);
}
async function backup() {
  const dir = await mkdtemp(join(tmpdir(), "jiawenlex-backup-"));
  let activePrefix, verified = false;
  try {
    const dumpPath = join(dir, "database.dump");
    await run("pg_dump", ["--format=custom", "--no-owner", "--no-subscriptions", "--exclude-schema=cron", "--exclude-schema=net", "--exclude-schema=vault", "--exclude-table-data=auth.sessions", "--exclude-table-data=auth.refresh_tokens", "--exclude-table-data=public.source_import_tokens", "--exclude-table-data=public.source_upload_sessions", "--file", dumpPath], required("DATABASE_URL"));
    const dump = await readFile(dumpPath);
    const prefix = `snapshots/${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(4).toString("hex")}/`;
    activePrefix = prefix;
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
        files.push({ bucket: bucketName, path, objectKey, sha256: hash(bytes), bytes: bytes.length, ...(data.type && /^[\w.+-]+\/[\w.+-]+$/.test(data.type) ? { contentType: data.type } : {}) });
      }
    }
    const { data: sourceRows, error: sourceRowsError } = await client.from("source_documents").select("object_key,sha256,byte_size").eq("status", "ready").order("object_key");
    if (sourceRowsError) throw sourceRowsError;
    const sourceStore = sourceRows?.length ? sourceReader() : null;
    const sources = [];
    for (const row of sourceRows ?? []) {
      const bytes = Number(row.byte_size);
      if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > 536870912 || !/^[a-f\d]{64}$/.test(row.sha256)) throw new Error("Invalid source document metadata in database snapshot");
      const objectKey = `source-objects/${row.sha256}.jlex`;
      let alreadyStored = false;
      try {
        const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
        if (head.ContentLength !== bytes + 33 || head.Metadata?.sha256 !== row.sha256 || head.Metadata?.bytes !== String(bytes)) {
          const previous = validateBytes(await get(objectKey), { bytes, sha256: row.sha256 });
          if (previous.length !== bytes) throw new Error("Existing source backup object is invalid");
        }
        alreadyStored = true;
      } catch (error) {
        const status = error?.$metadata?.httpStatusCode;
        if (status !== 404 && error?.name !== "NotFound" && error?.name !== "NoSuchKey") throw error;
      }
      if (!alreadyStored) {
        const sourceObject = await sourceStore.client.send(new GetObjectCommand({ Bucket: sourceStore.bucket, Key: row.object_key }));
        const original = validateBytes(Buffer.from(await sourceObject.Body.transformToByteArray()), { bytes, sha256: row.sha256 });
        await put(objectKey, original, { snapshot: false, metadata: { sha256: row.sha256, bytes: String(bytes) } });
        validateBytes(await get(objectKey), { bytes, sha256: row.sha256 });
      }
      sources.push({ sourceKey: row.object_key, objectKey, sha256: row.sha256, bytes });
    }
    const manifest = { version: 3, at: new Date().toISOString(), database: { objectKey: `${prefix}database.jlex`, sha256: hash(dump), bytes: dump.length }, files, sources };
    // Upload, download and verify the new snapshot before it can displace an old one.
    await put(`${prefix}manifest.jlex`, Buffer.from(JSON.stringify(manifest)));
    await verifyThenPrune(prefix, {
      verify: async (selected) => { await verify(selected, { verifySources: false }); verified = true; },
      snapshots: completeSnapshots,
      remove: (previous) => removeBackupSnapshot(s3, bucket, limits.versioned, previous),
    });
    console.log(`Encrypted snapshot complete: ${prefix}, ${files.length} file(s)`);
  } catch (error) {
    if (activePrefix && !verified) {
      try { await removeBackupSnapshot(s3, bucket, limits.versioned, activePrefix); }
      catch { console.warn("Incomplete snapshot cleanup failed; existing verified backups were retained. Check storage before retrying."); }
    }
    throw error;
  } finally { await cleanTemp(dir); }
}
async function readManifest(prefix) {
  return validateManifest(JSON.parse((await get(`${prefix}manifest.jlex`)).toString()), prefix);
}
async function verify(selectedPrefix, { verifySources = true } = {}) {
  const prefix = selectedPrefix ?? await latestSnapshot();
  const manifest = await readManifest(prefix);
  const dump = validateBytes(await get(manifest.database.objectKey), manifest.database);
  for (const file of manifest.files) validateBytes(await get(file.objectKey), file);
  for (const source of manifest.sources ?? []) {
    if (verifySources) validateBytes(await get(source.objectKey), source);
    else {
      const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: source.objectKey }));
      if (head.ContentLength !== source.bytes + 33 || head.Metadata?.sha256 !== source.sha256 || head.Metadata?.bytes !== String(source.bytes))
        throw new Error("Source archive object is missing or has invalid metadata; run a full snapshot verification");
    }
  }
  const dir = await mkdtemp(join(tmpdir(), "jiawenlex-verify-"));
  try { const path = join(dir, "database.dump"); await writeFile(path, dump); await run("pg_restore", ["--list", path]); }
  finally { await cleanTemp(dir); }
  await put(`${prefix}verified.jlex`, Buffer.from(JSON.stringify({ at: new Date().toISOString(), manifestHash: hash(Buffer.from(JSON.stringify(manifest))) })));
  console.log(`Snapshot verified: ${prefix}, ${manifest.files.length} file(s)`);
}
async function readLedger() {
  const names = (await list("deletions/")).objects.filter((name) => name.endsWith(".jlex"));
  const events = [];
  for (const name of names.sort()) events.push(JSON.parse((await get(name)).toString()));
  return { events, fingerprint: hash(Buffer.from(JSON.stringify(events))) };
}
async function replayDeletions() {
  assertRecoveryTarget(process.env);
  const prefix = snapshotPrefix(required("SNAPSHOT_PREFIX"));
  await verify(prefix);
  const ledger = await readLedger();
  const sql = deletionReplaySql(ledger.events, prefix, ledger.fingerprint);
  const dir = await mkdtemp(join(tmpdir(), "jiawenlex-replay-"));
  try { const path = join(dir, "deletions.sql"); await writeFile(path, sql); await run("psql", ["--set", "ON_ERROR_STOP=1", "--file", path], required("RECOVERY_DATABASE_URL")); }
  finally { await cleanTemp(dir); }
  console.log(`Replayed ${ledger.events.length} deletion event(s) in the recovery database`);
}
async function restoreFiles() {
  assertRecoveryTarget(process.env);
  const prefix = snapshotPrefix(required("SNAPSHOT_PREFIX"));
  const ledger = await readLedger();
  const state = JSON.parse((await run("psql", ["-tA", "--set", "ON_ERROR_STOP=1", "--command", "select json_build_object('snapshot',snapshot,'ledgerHash',ledger_hash,'files',(select coalesce(json_agg(f),'[]') from private.jiawenlex_recovery_files f)) from private.jiawenlex_recovery_state where id=true"], required("RECOVERY_DATABASE_URL"))).trim() || "null");
  if (state?.snapshot !== prefix || state?.ledgerHash !== ledger.fingerprint) throw new Error("Replay current deletions for the selected snapshot before restoring files");
  const mappings = new Map(state.files.map((row) => [row.old_path, row.new_path]));
  const client = createClient(required("RECOVERY_SUPABASE_URL"), supabaseServerKey("RECOVERY_"), { auth: { persistSession: false } });
  const manifest = await readManifest(prefix);
  let restored = 0;
  for (const file of manifest.files) {
    const destination = file.bucket === "study-files" ? mappings.get(file.path) ?? file.path : file.path;
    const query = file.bucket === "study-files"
      ? client.from("materials").select("id").eq("file_path", destination).limit(1)
      : client.from("practice_attempts").select("id").eq("recording_path", destination).eq("saved_recording", true).is("purged_at", null).gte("submitted_at", new Date(Date.now() - 365 * 86400000).toISOString()).limit(1);
    const { data, error } = await query;
    if (error) throw error;
    if (!data?.length) continue;
    const bytes = validateBytes(await get(file.objectKey), file);
    const { error: uploadError } = await client.storage.from(file.bucket).upload(destination, bytes, { upsert: true, contentType: file.contentType });
    if (uploadError) throw uploadError;
    restored++;
  }
  let restoredSources = 0;
  if (manifest.sources?.length) {
    const destination = sourceRestorer();
    for (const source of manifest.sources) {
      const { data: document, error } = await client.from("source_documents").select("id,owner_id,object_key,sha256,byte_size")
        .eq("object_key", source.sourceKey).eq("sha256", source.sha256).eq("byte_size", source.bytes).eq("status", "ready").maybeSingle();
      if (error) throw error;
      // Deletion replay removes the database row, so old private originals cannot reappear.
      if (!document) continue;
      const bytes = validateBytes(await get(source.objectKey), source);
      try {
        const existing = await destination.client.send(new GetObjectCommand({ Bucket: destination.bucket, Key: source.sourceKey }));
        validateBytes(Buffer.from(await existing.Body.transformToByteArray()), source);
      } catch (error) {
        const status = error?.$metadata?.httpStatusCode;
        if (status !== 404 && error?.name !== "NotFound" && error?.name !== "NoSuchKey") throw error;
        await destination.client.send(new PutObjectCommand({ Bucket: destination.bucket, Key: source.sourceKey, Body: bytes, ContentType: "application/pdf", Metadata: { "document-id": document.id, "owner-id": document.owner_id, sha256: source.sha256 } }));
        restoredSources++;
      }
    }
  }
  console.log(`Restored ${restored} authorized attachment(s) and ${restoredSources} original PDF(s)`);
}

async function download() {
  const prefix = snapshotPrefix(required("SNAPSHOT_PREFIX"));
  await verify(prefix);
  const manifest = await readManifest(prefix);
  // The plaintext dump contains private data. Choose a new file in a private location.
  await writeFile(required("RECOVERY_DUMP_PATH"), validateBytes(await get(manifest.database.objectKey), manifest.database), { flag: "wx", mode: 0o600 });
  console.log("Verified database dump downloaded; keep it private and remove it after the recovery drill");
}
async function restoreDatabase() {
  assertRecoveryTarget(process.env);
  const prefix = snapshotPrefix(required("SNAPSHOT_PREFIX"));
  await verify(prefix);
  const url = required("RECOVERY_DATABASE_URL");
  const emptinessSql = "select sum(n)::int from (" + [...recoveryTables.map((table) => `select count(*) n from public.${table}`), "select count(*) n from auth.users", "select count(*) n from auth.identities", "select count(*) n from auth.sessions"].join(" union all ") + ") counts";
  const count = Number((await run("psql", ["-tA", "--set", "ON_ERROR_STOP=1", "--command", emptinessSql], url)).trim());
  if (count !== 0) throw new Error("Recovery database must have the project migrations installed and all application/Auth tables empty");
  const manifest = await readManifest(prefix);
  const dir = await mkdtemp(join(tmpdir(), "jiawenlex-replay-"));
  try {
    const dumpPath = join(dir, "database.dump"), listPath = join(dir, "recovery.list");
    await writeFile(dumpPath, validateBytes(await get(manifest.database.objectKey), manifest.database));
    await writeFile(listPath, recoveryTableData(await run("pg_restore", ["--list", dumpPath])));
    // Target migrations already install the exact grants, policies and Auth/Storage hooks.
    // Restore data only; never recreate Supabase-managed schemas or platform cron/Vault.
    await run("pg_restore", ["--single-transaction", "--exit-on-error", "--data-only", "--no-owner", "--no-acl", "--use-list", listPath, dumpPath], url, { PGOPTIONS: "-c session_replication_role=replica" });
  } finally { await cleanTemp(dir); }
  await replayDeletions();
  console.log("Recovery database restored and current deletions replayed; restore files next");
}

if (mode === "backup") await backup();
else if (mode === "verify") await verify();
else if (mode === "replay-deletions") await replayDeletions();
else if (mode === "restore-files") await restoreFiles();
else if (mode === "download") await download();
else if (mode === "restore-database") await restoreDatabase();
else throw new Error("Usage: node scripts/backup.mjs backup|verify|replay-deletions|restore-files");
