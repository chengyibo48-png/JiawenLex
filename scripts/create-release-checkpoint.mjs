import pg from "pg";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve, relative, isAbsolute } from "node:path";
import { encryptionKey, encrypt, decrypt, hash, validateBytes } from "./backup-core.mjs";

if (!process.env.DATABASE_URL) process.loadEnvFile(".env.local");
const root = fileURLToPath(new URL("../", import.meta.url));
const version = JSON.parse(await readFile(join(root, "release.json"), "utf8")).version;
const u = new URL(process.env.DATABASE_URL);
const project = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
if (!(u.hostname.endsWith(".supabase.com") || u.hostname.endsWith(".supabase.co")) ||
    (!decodeURIComponent(u.username).includes(project) && u.hostname !== `db.${project}.supabase.co`)) throw new Error("Database project mismatch");
u.searchParams.delete("sslmode");
const key = encryptionKey(process.env.BACKUP_ENCRYPTION_SECRET);
const db = new pg.Client({ connectionString: u.toString(), ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
const archive = join(root, ".source-archive");
await mkdir(archive, { recursive: true });
const dir = await mkdtemp(join(archive, `release-checkpoint-v${version}-${new Date().toISOString().slice(0, 10)}-`));
const rel = relative(resolve(archive), resolve(dir));
if (!rel || isAbsolute(rel) || rel.startsWith("..")) throw new Error("Unexpected checkpoint directory");
const dumpPath = join(dir, "database.dump");
const bundledBin = join(root, ".tools", "postgresql17", "bin");
const executable = name => existsSync(join(bundledBin, `${name}.exe`)) ? join(bundledBin, `${name}.exe`) : name;
function run(name, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable(name), args, { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", data => { stdout += data; });
    child.stderr.on("data", () => {});
    child.on("error", () => reject(new Error("PostgreSQL client unavailable")));
    child.on("exit", code => code === 0 ? resolve(stdout) : reject(new Error("PostgreSQL checkpoint operation failed")));
  });
}
try {
  await db.connect();
  await db.query("begin isolation level repeatable read read only");
  const snapshot = (await db.query("select pg_export_snapshot() as snapshot")).rows[0].snapshot;
  const pgEnv = { ...process.env, PGHOST: u.hostname, PGPORT: u.port || "5432", PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password), PGDATABASE: decodeURIComponent(u.pathname.slice(1)), PGSSLMODE: "require", PGCONNECT_TIMEOUT: "20" };
  await run("pg_dump", ["--format=custom", "--no-owner", "--no-subscriptions", "--exclude-schema=cron", "--exclude-schema=net", "--exclude-schema=vault", "--exclude-table-data=auth.sessions", "--exclude-table-data=auth.refresh_tokens", "--exclude-table-data=public.source_import_tokens", "--exclude-table-data=public.source_upload_sessions", `--snapshot=${snapshot}`, "--file", dumpPath], pgEnv);
  const sources = (await db.query("select id,object_key,sha256,byte_size from public.source_documents where status='ready' order by id")).rows;
  await db.query("rollback");
  const dump = await readFile(dumpPath);
  const database = { file: "database.jlex", bytes: dump.length, sha256: hash(dump) };
  await writeFile(join(dir, database.file), encrypt(dump, key), { flag: "wx" });
  validateBytes(decrypt(await readFile(join(dir, database.file)), key), database);
  const listing = await run("pg_restore", ["--list", dumpPath]);
  if (!listing.includes("TABLE DATA public profiles") || !listing.includes("TABLE DATA public source_review_candidates")) throw new Error("Checkpoint lacks required user or review data");
  const manifest = { version: 1, kind: "release-database-checkpoint", releaseVersion: version, project, at: new Date().toISOString(), database, sources, verified: true, storageFilesCopied: false, limitations: ["Stored assets are referenced, not copied. Restore sessions from this checkpoint is intentionally excluded, consistent with the scheduled backup policy."] };
  await writeFile(join(dir, "manifest.jlex"), encrypt(Buffer.from(JSON.stringify(manifest)), key), { flag: "wx" });
  const verified = JSON.parse(decrypt(await readFile(join(dir, "manifest.jlex")), key).toString());
  if (verified.database.sha256 !== database.sha256) throw new Error("Checkpoint manifest verification failed");
  console.log(JSON.stringify({ manifest: relative(root, join(dir, "manifest.jlex")), version, databaseBytes: dump.length, databaseSha256: database.sha256, sourceReferences: sources.length, encryptedRoundTripVerified: true, pgRestoreListVerified: true, storageFilesCopied: false }));
} catch (error) {
  await db.query("rollback").catch(() => {});
  console.error(error.code ?? error.message);
  process.exitCode = 1;
} finally {
  await db.end();
  // This exact file is confined to the checked checkpoint directory above.
  await unlink(dumpPath).catch(() => {});
}
