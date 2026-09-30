import {
  createHash,
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

export const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function encryptionKey(secret) {
  if (!secret || secret.length < 32)
    throw new Error(
      "BACKUP_ENCRYPTION_SECRET needs at least 32 random characters",
    );
  return createHash("sha256").update(secret).digest();
}
export function encrypt(plain, key) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  return Buffer.concat([
    Buffer.from("JLEX1"),
    iv,
    cipher.update(plain),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
}
export function decrypt(data, key) {
  if (data.length < 33 || data.subarray(0, 5).toString() !== "JLEX1")
    throw new Error("Unrecognized backup format");
  const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(5, 17));
  decipher.setAuthTag(data.subarray(-16));
  return Buffer.concat([
    decipher.update(data.subarray(17, -16)),
    decipher.final(),
  ]);
}
export function snapshotPrefix(value) {
  if (typeof value !== "string" || !/^snapshots\/[A-Za-z0-9-]+\/$/.test(value))
    throw new Error("Invalid SNAPSHOT_PREFIX");
  return value;
}
export function validateManifest(manifest, prefix) {
  snapshotPrefix(prefix);
  if (
    ![1, 2, 3].includes(manifest?.version) ||
    !Number.isFinite(Date.parse(manifest.at)) ||
    !Array.isArray(manifest.files)
  )
    throw new Error("Invalid backup manifest");
  if (manifest.version >= 3 && !Array.isArray(manifest.sources))
    throw new Error("Invalid source document manifest");
  const entries = [manifest.database, ...manifest.files];
  const keys = new Set(),
    paths = new Set();
  for (let index = 0; index < entries.length; index++) {
    const item = entries[index];
    const expected =
      index === 0
        ? `${prefix}database.jlex`
        : `${prefix}files/${index - 1}.jlex`;
    if (
      !item ||
      item.objectKey !== expected ||
      keys.has(item.objectKey) ||
      !/^[a-f\d]{64}$/.test(item.sha256) ||
      !Number.isSafeInteger(item.bytes) ||
      item.bytes < 0
    )
      throw new Error("Invalid backup entry");
    keys.add(item.objectKey);
    if (index) {
      if (
        !["study-files", "study-audio"].includes(item.bucket) ||
        typeof item.path !== "string" ||
        !/^[a-f\d-]{36}\//i.test(item.path) ||
        item.path
          .split("/")
          .some((part) => !part || part === "." || part === "..") ||
        /[\\\x00-\x1f]/.test(item.path) ||
        paths.has(`${item.bucket}/${item.path}`)
      )
        throw new Error("Invalid backup file path");
      if (
        item.contentType &&
        (typeof item.contentType !== "string" ||
          !/^[\w.+-]+\/[\w.+-]+$/.test(item.contentType))
      )
        throw new Error("Invalid backup content type");
      paths.add(`${item.bucket}/${item.path}`);
    }
  }
  const sources = manifest.sources ?? [];
  const sourceKeys = new Set();
  for (const source of sources) {
    if (
      !source ||
      typeof source.sourceKey !== "string" ||
      !/^originals\/[a-f\d-]{36}\/[a-f\d-]{36}\/[^/\\\x00-\x1f]+\.pdf$/i.test(source.sourceKey) ||
      source.sourceKey.split("/").some((part) => !part || part === "." || part === "..") ||
      !/^[a-f\d]{64}$/.test(source.sha256) ||
      source.objectKey !== `source-objects/${source.sha256}.jlex` ||
      !Number.isSafeInteger(source.bytes) || source.bytes < 1 || source.bytes > 536870912 ||
      sourceKeys.has(source.sourceKey)
    ) throw new Error("Invalid source document backup entry");
    sourceKeys.add(source.sourceKey);
  }
  return manifest;
}
export function validateBytes(bytes, entry) {
  if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256)
    throw new Error("Backup integrity check failed");
  return bytes;
}
export async function verifyThenPrune(prefix, { verify, snapshots, remove }) {
  await verify(prefix);
  const expired = (await snapshots()).sort().slice(0, -4);
  for (const item of expired) await remove(item);
}
export const recoveryTables = [
  "profiles",
  "study_tasks",
  "materials",
  "practice_attempts",
  "vocabulary",
  "writing_drafts",
  "practice_sessions",
  "share_grants",
  "share_comments",
  "ai_usage",
  "invite_control",
  "provider_keys",
  "transcription_jobs",
  "reminder_deliveries",
  "deletion_events",
  "attempt_reviews",
  "vocabulary_sources",
  "spelling_sessions",
  "material_versions",
  "micro_sessions",
  "micro_attempts",
  "source_documents",
  "source_parse_batches",
  "source_review_candidates",
  "source_page_audit",
  "question_error_reports",
  "study_guides",
  "vocabulary_templates",
  "vocabulary_review_events",
  "word_error_reports",
];
export function recoveryTableData(toc) {
  const selected = [],
    found = new Set();
  for (const line of toc.split("\n")) {
    const match = /^\d+;\s+\d+\s+\d+\s+TABLE DATA\s+(\w+)\s+(\w+)\s+/.exec(
      line,
    );
    if (!match) continue;
    const [, schema, table] = match;
    if (schema === "public") {
      if (!recoveryTables.includes(table))
        throw new Error(
          "Unexpected application table in backup; review recovery scope first",
        );
      found.add(table);
      selected.push(line);
    } else if (schema === "auth" && ["users", "identities"].includes(table))
      selected.push(line);
  }
  if (
    recoveryTables.some(
      (table) =>
        ![
          "practice_sessions",
          "attempt_reviews",
          "vocabulary_sources",
          "spelling_sessions",
          "material_versions",
          "micro_sessions",
          "micro_attempts",
        ].includes(table) && !found.has(table),
    )
  )
    throw new Error("Backup lacks required application tables");
  return selected.join("\n") + "\n";
}
function databaseRef(value) {
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new Error("PostgreSQL connection URL required");
  const direct = /^db\.([a-z\d]+)\.supabase\.co$/.exec(url.hostname)?.[1];
  const pooled = /^postgres\.([a-z\d]+)$/.exec(
    decodeURIComponent(url.username),
  )?.[1];
  return direct ?? pooled;
}
export function assertRecoveryTarget(env) {
  if (env.RESTORE_CONFIRM !== "fresh-recovery-project")
    throw new Error("Recovery requires RESTORE_CONFIRM=fresh-recovery-project");
  const source = new URL(env.NEXT_PUBLIC_SUPABASE_URL),
    target = new URL(env.RECOVERY_SUPABASE_URL);
  const project = (url) =>
    url.protocol === "https:" &&
    /^([a-z\d]+)\.supabase\.co$/.exec(url.hostname)?.[1];
  const sourceRef = project(source),
    targetRef = project(target);
  if (
    !sourceRef ||
    !targetRef ||
    sourceRef === targetRef ||
    databaseRef(env.RECOVERY_DATABASE_URL) !== targetRef ||
    databaseRef(env.DATABASE_URL) !== sourceRef
  )
    throw new Error(
      "Recovery must use a separate Supabase project and matching database URLs",
    );
}
const entities = new Set([
  "account",
  "member_removed",
  "materials",
  "practice_attempts",
  "vocabulary",
  "share_grants",
  "writing_drafts",
  "practice_sessions",
  "purged_attempt",
  "micro_attempts",
  "micro_sessions",
  "purged_micro_attempt",
  "provider_key",
  "source_documents",
]);
function uuid(value) {
  if (
    typeof value !== "string" ||
    !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value)
  )
    throw new Error("Invalid tombstone UUID");
  return `'${value}'::uuid`;
}
export function deletionReplaySql(events, prefix, ledgerHash) {
  snapshotPrefix(prefix);
  if (!/^[a-f\d]{64}$/.test(ledgerHash))
    throw new Error("Invalid deletion ledger fingerprint");
  const sql = [
    "begin;",
    "create schema if not exists private;",
    `create table if not exists private.jiawenlex_recovery_files (old_path text primary key, new_path text not null);`,
    `create table if not exists private.jiawenlex_recovery_state (id boolean primary key default true check (id), snapshot text not null, ledger_hash text not null);`,
    "revoke all on private.jiawenlex_recovery_files, private.jiawenlex_recovery_state from public, anon, authenticated;",
  ];
  const ordered = [...events].sort((a, b) =>
    String(a.at).localeCompare(String(b.at)),
  );
  for (const item of ordered) {
    if (!entities.has(item.entity) || !Number.isFinite(Date.parse(item.at)))
      throw new Error("Invalid deletion event");
    const id = uuid(item.entityId);
    uuid(item.ownerId);
    if (item.entity === "account") {
      // Preserve authorized group material and transfer its attachment namespace together.
      sql.push(
        `insert into private.jiawenlex_recovery_files(old_path,new_path) select m.file_path, a.id::text || '/retained-' || m.id::text || '/' || regexp_replace(coalesce(m.file_name,'attachment'),'[\\/[:cntrl:]]','-','g') from public.materials m cross join lateral (select id from public.profiles where role='admin' and status='active' and id<>${id} order by created_at limit 1) a where m.owner_id=${id} and m.visibility='shared' and m.approval='approved' and m.license_name<>'' and m.file_path is not null on conflict(old_path) do update set new_path=excluded.new_path;`,
      );
      sql.push(
        `update public.materials m set owner_id=a.id, file_path=case when m.file_path is null then null else (select new_path from private.jiawenlex_recovery_files where old_path=m.file_path) end from (select id from public.profiles where role='admin' and status='active' and id<>${id} order by created_at limit 1) a where m.owner_id=${id} and m.visibility='shared' and m.approval='approved' and m.license_name<>'';`,
      );
      sql.push(`delete from auth.users where id=${id};`);
    } else if (item.entity === "provider_key") {
      if (
        !["text", "asr"].includes(item.keyKind) ||
        !Number.isFinite(Date.parse(item.updatedBefore)) ||
        item.entityId !== item.ownerId
      )
        throw new Error("Invalid provider key deletion");
      sql.push(
        `delete from public.provider_keys where owner_id=${id} and kind='${item.keyKind}' and updated_at<='${new Date(item.updatedBefore).toISOString()}'::timestamptz;`,
      );
    } else if (item.entity === "member_removed")
      sql.push(`update public.profiles set status='removed' where id=${id};`);
    else if (item.entity === "purged_micro_attempt")
      sql.push(
        `update public.micro_attempts set answer_body=null,self_review=null,unit_snapshot=null,purged_at=now() where id=${id};`,
      );
    else if (item.entity === "purged_attempt")
      sql.push(
        `update public.practice_attempts set answer_body=null,feedback=null,transcript=null,recording_path=null,saved_recording=false,purged_at=now() where id=${id};`,
      );
    else if (
      ["writing_drafts", "practice_sessions", "micro_sessions"].includes(
        item.entity,
      ) &&
      item.updatedBefore
    ) {
      if (!Number.isFinite(Date.parse(item.updatedBefore)))
        throw new Error("Invalid draft deletion cutoff");
      sql.push(
        `delete from public.${item.entity} where id=${id} and updated_at<='${new Date(item.updatedBefore).toISOString()}'::timestamptz;`,
      );
    } else sql.push(`delete from public.${item.entity} where id=${id};`);
  }
  // Expiry also applies when the backup predates a retention run. Summary fields survive.
  sql.push(
    "update public.practice_attempts set answer_body=null,feedback=null,transcript=null,recording_path=null,saved_recording=false,purged_at=now() where submitted_at<now()-interval '365 days' and purged_at is null;",
  );
  sql.push(
    "delete from public.attempt_reviews r using public.practice_attempts a where r.id=a.id and a.purged_at is not null;",
  );
  sql.push(
    "update public.micro_attempts set answer_body=null,self_review=null,unit_snapshot=null,purged_at=now() where submitted_at<now()-interval '365 days' and purged_at is null;",
  );
  sql.push(
    "delete from public.micro_sessions where updated_at<now()-interval '365 days';",
  );
  sql.push(
    "delete from public.writing_drafts where updated_at<now()-interval '365 days';",
  );
  sql.push(
    "delete from public.practice_sessions where updated_at<now()-interval '365 days';",
  );
  sql.push(
    "delete from public.transcription_jobs where created_at<now()-interval '365 days' or (not save_recording and created_at<now()-interval '24 hours');",
  );
  // Restored sessions must never reactivate previously issued access tokens.
  sql.push("delete from auth.sessions;");
  sql.push(
    `insert into private.jiawenlex_recovery_state(id,snapshot,ledger_hash) values(true,'${prefix}','${ledgerHash}') on conflict(id) do update set snapshot=excluded.snapshot,ledger_hash=excluded.ledger_hash;`,
    "commit;",
  );
  return sql.join("\n");
}
