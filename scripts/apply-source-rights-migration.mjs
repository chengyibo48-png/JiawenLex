import pg from "pg";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { assertReleaseMutation } from "./release-policy.mjs";
import { encryptionKey, decrypt, validateBytes } from "./backup-core.mjs";

const apply = process.argv.includes("--apply");
if (apply) assertReleaseMutation();
if (!process.env.DATABASE_URL) process.loadEnvFile(".env.local");
const url = new URL(process.env.DATABASE_URL);
const project = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
if (!(url.hostname.endsWith(".supabase.com") || url.hostname.endsWith(".supabase.co")) ||
    (!decodeURIComponent(url.username).includes(project) && url.hostname !== `db.${project}.supabase.co`)) throw new Error("Database project mismatch");
let checkpoint;
if (apply) {
  if (!process.env.RELEASE_CHECKPOINT_MANIFEST) throw new Error("A verified release checkpoint is required");
  const root = fileURLToPath(new URL("../", import.meta.url));
  const path = resolve(root, process.env.RELEASE_CHECKPOINT_MANIFEST);
  const rel = relative(resolve(root, ".source-archive"), path);
  if (!rel || isAbsolute(rel) || rel.startsWith("..")) throw new Error("Checkpoint must be inside the release archive");
  const key = encryptionKey(process.env.BACKUP_ENCRYPTION_SECRET);
  checkpoint = JSON.parse(decrypt(await readFile(path), key).toString());
  const version = JSON.parse(await readFile(join(root, "release.json"), "utf8")).version;
  if (checkpoint.kind !== "release-database-checkpoint" || !checkpoint.verified || checkpoint.project !== project || checkpoint.releaseVersion !== version || checkpoint.database.file !== "database.jlex") throw new Error("Checkpoint does not match this release project");
  validateBytes(decrypt(await readFile(join(dirname(path), checkpoint.database.file)), key), checkpoint.database);
}
url.searchParams.delete("sslmode");
const client = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
const ignoredSourceColumns = ["rights_review_status", "rights_reviewed_at", "rights_reviewed_by", "rights_review_note"];
const identifier = value => '"' + value.replaceAll('"', '""') + '"';

async function protectedState() {
  const tables = (await client.query("select schemaname,tablename from pg_tables where (schemaname='public' and tablename<>'source_rights_audit') or (schemaname='auth' and tablename in ('users','sessions','refresh_tokens')) order by schemaname,tablename")).rows;
  const states = [];
  for (const { schemaname, tablename } of tables) {
    const json = tablename === "source_documents" ? "to_jsonb(t) - $1::text[]" : "to_jsonb(t)";
    const sql = `select count(*)::text as rows,md5(coalesce(string_agg(md5((${json})::text),'' order by md5((${json})::text)),'')) as hash from ${identifier(schemaname)}.${identifier(tablename)} t`;
    const state = (await client.query(sql, tablename === "source_documents" ? [ignoredSourceColumns] : [])).rows[0];
    states.push({ table: `${schemaname}.${tablename}`, ...state });
  }
  return { digest: createHash("sha256").update(JSON.stringify(states)).digest("hex"), tables: states.length };
}

try {
  await client.connect();
  await client.query(apply ? "begin isolation level repeatable read" : "begin isolation level repeatable read read only");
  if (apply) await client.query("select pg_advisory_xact_lock(hashtext('jiawenlex-source-rights-release'))");
  const before = await protectedState();
  const existing = (await client.query("select to_regclass('public.source_rights_audit') is not null as audit, exists(select 1 from information_schema.columns where table_schema='public' and table_name='source_documents' and column_name='rights_review_status') as review")).rows[0];
  if (existing.audit !== existing.review) throw new Error("Partial rights migration; stop for inspection");
  let applied = false;
  if (apply && !existing.audit) {
    const sql = await readFile(new URL("../supabase/migrations/20261005090000_source_rights_review.sql", import.meta.url), "utf8");
    await client.query(sql);
    applied = true;
  }
  const after = await protectedState();
  if (before.digest !== after.digest) throw new Error("Protected data changed; migration rolled back");
  await client.query(apply ? "commit" : "rollback");
  console.log(JSON.stringify({ mode: apply ? "apply" : "audit", applied, rightsSchemaPresent: apply || existing.audit, protectedTables: before.tables, beforeDigest: before.digest, afterDigest: after.digest, checkpointVerified: apply ? !!checkpoint : undefined }));
} catch (error) {
  await client.query("rollback").catch(() => {});
  console.error(error.code ?? "Source rights migration failed; transaction rolled back");
  process.exitCode = 1;
} finally { await client.end(); }
