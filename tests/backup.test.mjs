import test from "node:test";
import assert from "node:assert/strict";
import { encryptionKey, encrypt, decrypt, hash, validateManifest, validateBytes, assertRecoveryTarget, deletionReplaySql, verifyThenPrune, recoveryTables, recoveryTableData } from "../scripts/backup-core.mjs";

const prefix = "snapshots/2026-09-29T00-00-00-000Z-abc12345/";
const bytes = Buffer.from("private study response"), key = encryptionKey("fixture-key-at-least-32-characters-long");
const entry = { objectKey: prefix + "database.jlex", sha256: hash(bytes), bytes: bytes.length };
test("Backup encryption rejects corruption, wrong key and truncated data", () => {
  const encrypted = encrypt(bytes, key);
  assert.deepEqual(decrypt(encrypted, key), bytes);
  assert.notDeepEqual(encrypt(bytes, key), encrypted);
  const damaged = Buffer.from(encrypted); damaged[20] ^= 1;
  assert.throws(() => decrypt(damaged, key));
  assert.throws(() => decrypt(encrypted, encryptionKey("another-fixture-key-32-characters-long")));
  assert.throws(() => decrypt(Buffer.from("JLEX1"), key));
});
test("Backup manifest confines reads to its snapshot and checks size plus hash", () => {
  const manifest = { version: 2, at: "2026-09-29T00:00:00Z", database: entry, files: [] };
  assert.equal(validateManifest(manifest, prefix), manifest);
  assert.throws(() => validateManifest({ ...manifest, database: { ...entry, objectKey: "deletions/private.jlex" } }, prefix));
  assert.throws(() => validateBytes(bytes, { ...entry, bytes: 1 }));
  const file = { ...entry, objectKey: prefix + "files/0.jlex", bucket: "study-files", path: "00000000-0000-4000-8000-000000000001/../private.pdf" };
  assert.throws(() => validateManifest({ ...manifest, files: [file] }, prefix));
});
test("A failed new backup cannot delete any previous recovery point", async () => {
  let deleted = [];
  await assert.rejects(verifyThenPrune("new", { verify: async () => { throw Error("checksum"); }, snapshots: async () => ["1", "2", "3", "4", "5"], remove: async (name) => deleted.push(name) }));
  assert.deepEqual(deleted, []);
  const events = [];
  await verifyThenPrune("new", { verify: async () => events.push("verified"), snapshots: async () => ["5", "3", "2", "1", "4"], remove: async (name) => events.push(name) });
  assert.deepEqual(events, ["verified", "1"]);
});
test("Recovery rejects the live project and a mismatched pooler connection", () => {
  const env = { RESTORE_CONFIRM: "fresh-recovery-project", NEXT_PUBLIC_SUPABASE_URL: "https://source.supabase.co", RECOVERY_SUPABASE_URL: "https://recovery.supabase.co", DATABASE_URL: "postgresql://postgres.source:fixture@pooler.supabase.com:5432/postgres", RECOVERY_DATABASE_URL: "postgresql://postgres.recovery:fixture@pooler.supabase.com:5432/postgres" };
  assert.doesNotThrow(() => assertRecoveryTarget(env));
  assert.throws(() => assertRecoveryTarget({ ...env, RECOVERY_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL }));
  assert.throws(() => assertRecoveryTarget({ ...env, RECOVERY_DATABASE_URL: env.DATABASE_URL }));
  assert.throws(() => assertRecoveryTarget({ ...env, RESTORE_CONFIRM: "" }));
});
test("Unrecognized or malformed deletion events fail before SQL execution", () => {
  assert.throws(() => deletionReplaySql([{ entity: "profiles", entityId: "1" }], prefix, hash(bytes)));
  assert.throws(() => deletionReplaySql([{ entity: "materials", entityId: "';drop table materials;--", ownerId: "", at: "2026-09-29T00:00:00Z" }], prefix, hash(bytes)));
});
test("Recovery selects application and account data while excluding platform schemas and sessions", () => {
  const app = recoveryTables.map((table, index) => `${index + 1}; 0 ${1000 + index} TABLE DATA public ${table} postgres`).join("\n");
  const toc = app + "\n50; 0 2000 TABLE DATA auth users supabase_auth_admin\n51; 0 2001 TABLE DATA auth identities supabase_auth_admin\n52; 0 2002 TABLE DATA auth sessions supabase_auth_admin\n53; 0 2003 TABLE DATA vault secrets supabase_admin\n54; 0 2004 TABLE DATA cron job postgres\n55; 0 2005 TABLE DATA storage objects supabase_storage_admin";
  const selected = recoveryTableData(toc);
  assert.match(selected, /auth users/); assert.match(selected, /auth identities/);
  assert.doesNotMatch(selected, /auth sessions|vault secrets|cron job|storage objects/);
  assert.throws(() => recoveryTableData(toc + "\n56; 0 2010 TABLE DATA public unexpected postgres"));
  assert.throws(() => recoveryTableData("50; 0 2000 TABLE DATA auth users postgres"));
});
