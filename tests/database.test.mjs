import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { deletionReplaySql, hash } from "../scripts/backup-core.mjs";

const migrations = new URL("../supabase/migrations/", import.meta.url);
const fixtureInvite = "JiawenLex-local-fixture-invite";
const owner = "00000000-0000-4000-8000-000000000001";
const recipient = "00000000-0000-4000-8000-000000000002";
const session = "00000000-0000-4000-8000-000000000003";
const taskId = "00000000-0000-4000-8000-000000000004";
const newId = "00000000-0000-4000-8000-000000000005";
const planWeek = "2026-09-28";
async function signedIn(pg) {
  await pg.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: owner, role: "authenticated", session_id: session })]);
  await pg.exec("set local role authenticated");
}
async function denied(pg, work, message) {
  await pg.exec("savepoint expected_failure");
  await assert.rejects(work(), message);
  await pg.exec("rollback to expected_failure");
}
test("Local PostgreSQL migration and V1 access controls", async (t) => {
  const pg = await PGlite.create();
  try {
    await pg.exec(`
      create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin;
      create schema auth; create schema storage;
      grant usage on schema auth, storage to anon, authenticated, service_role, supabase_auth_admin;
      create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
      create table auth.sessions(id uuid primary key, user_id uuid references auth.users(id), not_after timestamptz);
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub', '')::uuid $$;
      create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint);
      create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
      alter table storage.objects enable row level security;
    `);
    for (const name of (await fs.readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) {
      // No pgcrypto functionality is used: SHA256 and UUID functions are built into PostgreSQL.
      const sql = (await fs.readFile(new URL(name, migrations), "utf8")).replace("create extension if not exists pgcrypto;", "");
      await pg.exec(sql);
    }
    await t.test("Existing invitation, isolation, sharing and member-removal regression suite", async () => {
      const sql = await fs.readFile(new URL("../supabase/tests/access-control.sql", import.meta.url), "utf8");
      await pg.exec(sql);
      assert.equal((await pg.query("select count(*)::int as count from auth.users")).rows[0].count, 0);
    });
    await pg.query("insert into public.invite_control(id,code_hash) values (1,encode(sha256(convert_to($1,'UTF8')),'hex'))", [fixtureInvite]);
    for (const [id, name] of [[owner, "Owner"], [recipient, "Recipient"]]) {
      await pg.query("insert into auth.users(id,email,raw_user_meta_data) values ($1,$2,$3)", [id, name + "@example.invalid", JSON.stringify({ invite_code: fixtureInvite, display_name: name })]);
    }
    await pg.query("insert into auth.sessions(id,user_id) values ($1,$2)", [session, owner]);
    await pg.query("insert into public.study_tasks(id,owner_id,week_start,planned_date,skill,title,minutes,status,source) values ($1,$2,$3,$3,'reading','Original task',30,'todo','rule')", [taskId, owner, planWeek]);
    await t.test("Invalid replacement rolls back deletion", async () => {
      await pg.exec("begin");
      try {
        await signedIn(pg);
        const row = { id: newId, owner_id: owner, week_start: planWeek, planned_date: planWeek, skill: "reading", title: "", minutes: 30, status: "todo", source: "rule" };
        await denied(pg, () => pg.query("select public.replace_weekly_plan($1,$2,$3)", [planWeek, [taskId], JSON.stringify([row])]), /title|check constraint/);
        assert.equal((await pg.query("select title from public.study_tasks where id=$1", [taskId])).rows[0].title, "Original task");
      } finally { await pg.exec("rollback"); }
    });
    await t.test("Valid replacement preserves completed, manual and AI tasks", async () => {
      await pg.exec("begin");
      try {
        await signedIn(pg);
        await pg.query("insert into public.study_tasks(owner_id,week_start,planned_date,skill,title,minutes,status,source) values ($1,$2,$2,'writing','Done',30,'done','rule'),($1,$2,$2,'writing','Manual',30,'todo','manual'),($1,$2,$2,'writing','AI',30,'todo','ai')", [owner, planWeek]);
        const row = { id: newId, owner_id: owner, week_start: planWeek, planned_date: planWeek, skill: "reading", title: "New task", minutes: 30, status: "todo", source: "rule" };
        await pg.query("select public.replace_weekly_plan($1,$2,$3)", [planWeek, [taskId], JSON.stringify([row])]);
        assert.deepEqual((await pg.query("select title from public.study_tasks order by title")).rows.map((row) => row.title), ["AI", "Done", "Manual", "New task"]);
      } finally { await pg.exec("rollback"); }
    });
    await t.test("Concurrent completion prevents stale replacement", async () => {
      await pg.exec("begin");
      try {
        await signedIn(pg);
        await pg.query("update public.study_tasks set status='done' where id=$1", [taskId]);
        await denied(pg, () => pg.query("select public.replace_weekly_plan($1,$2,'[]')", [planWeek, [taskId]]), /plan_conflict/);
        assert.equal((await pg.query("select status from public.study_tasks where id=$1", [taskId])).rows[0].status, "done");
      } finally { await pg.exec("rollback"); }
    });
    await t.test("Session revocation immediately denies RLS and file-access lookup", async () => {
      await pg.exec("begin");
      try {
        await signedIn(pg);
        assert.equal((await pg.query("select count(*)::int as count from public.profiles")).rows[0].count, 1);
        await pg.exec("reset role"); await pg.query("delete from auth.sessions where id=$1", [session]);
        await pg.exec("set local role service_role");
        assert.equal((await pg.query("select public.session_active($1,$2) as active", [owner, session])).rows[0].active, false);
        await pg.exec("set local role authenticated");
        assert.equal((await pg.query("select count(*)::int as count from public.profiles")).rows[0].count, 0);
        await denied(pg, () => pg.query("select * from public.list_members()"), /inactive account/);
        await denied(pg, () => pg.query("select public.session_active($1,$2)", [owner, session]), /permission denied/);
      } finally { await pg.exec("rollback"); }
    });
    await t.test("Members cannot attach another owner's files or audio", async () => {
      await pg.exec("begin");
      try {
        await signedIn(pg);
        await denied(pg, () => pg.query("insert into public.materials(owner_id,title,skill,file_path) values ($1,'Forged file','reading',$2)", [owner, recipient + "/private.pdf"]), /materials_file_owner/);
        await denied(pg, () => pg.query("insert into public.practice_attempts(owner_id,skill,mode,recording_path) values ($1,'speaking','practice',$2)", [owner, recipient + "/private.webm"]), /attempts_recording_owner/);
      } finally { await pg.exec("rollback"); }
    });
    await t.test("AI reservations count toward budget before provider completion", async () => {
      await pg.exec("begin");
      try {
        await pg.query("update public.profiles set ai_enabled=true,monthly_budget_cny=10 where id=$1", [owner]);
        await pg.exec("set local role service_role");
        await pg.query("select public.reserve_ai_usage($1,'deepseek','writing_feedback',6,false,null)", [owner]);
        await denied(pg, () => pg.query("select public.reserve_ai_usage($1,'deepseek','writing_feedback',5,false,null)", [owner]), /budget_confirmation_required/);
        await pg.query("select public.reserve_ai_usage($1,'deepseek','writing_feedback',5,true,null)", [owner]);
        assert.equal(Number((await pg.query("select sum(estimated_cny) as cost from public.ai_usage")).rows[0].cost), 11);
      } finally { await pg.exec("rollback"); }
    });
    await t.test("Yearly purge keeps deduplicated themes and question summaries", async () => {
      await pg.exec("begin");
      try {
        await pg.query("insert into public.practice_attempts(id,owner_id,skill,mode,feedback,question_stats) values ($1,$2,'writing','practice',$3,$4)", [newId, owner, JSON.stringify({ tags: ["grammar", "grammar", "cohesion"] }), JSON.stringify([{ type: "short", count: 3, correct: 2 }])]);
        await pg.query("update public.practice_attempts set feedback=null,answer_body=null,purged_at=now() where id=$1", [newId]);
        const row = (await pg.query("select feedback_tags,question_stats from public.practice_attempts where id=$1", [newId])).rows[0];
        assert.deepEqual([...row.feedback_tags].sort(), ["cohesion", "grammar"]);
        assert.deepEqual(row.question_stats, [{ type: "short", count: 3, correct: 2 }]);
      } finally { await pg.exec("rollback"); }
    });
    await t.test("Recovery replays account deletion while retaining authorized attachments", async () => {
      const materialId = "00000000-0000-4000-8000-000000000009";
      await pg.query("insert into public.materials(id,owner_id,title,skill,visibility,approval,source_title,license_name,file_path,file_name) values ($1,$2,'Licensed group material','reading','shared','pending','Fixture source','Owner permission',$3,'notes.pdf')", [materialId, recipient, recipient + "/notes.pdf"]);
      await pg.exec("begin"); await signedIn(pg);
      await pg.query("update public.materials set approval='approved' where id=$1", [materialId]);
      await pg.exec("commit");
      await pg.query("insert into public.practice_attempts(owner_id,skill,mode,answer_body,feedback,submitted_at) values ($1,'writing','practice',$2,$3,now()-interval '366 days')", [owner, JSON.stringify({ essay: "expired essay" }), JSON.stringify({ tags: ["cohesion"] })]);
      const events = [{ entity: "account", entityId: recipient, ownerId: recipient, at: "2026-09-29T00:00:00Z" }];
      const replay = deletionReplaySql(events, "snapshots/fixture/", hash(Buffer.from("ledger")));
      await pg.exec(replay);
      await pg.exec(replay); // Retried recovery must be idempotent.
      const retained = (await pg.query("select owner_id,file_path from public.materials where id=$1", [materialId])).rows[0];
      assert.equal(retained.owner_id, owner);
      assert.equal(retained.file_path, `${owner}/retained-${materialId}/notes.pdf`);
      const mapping = (await pg.query("select old_path,new_path from private.jiawenlex_recovery_files")).rows[0];
      assert.equal(mapping.old_path, recipient + "/notes.pdf");
      assert.equal(mapping.new_path, retained.file_path);
      assert.equal((await pg.query("select count(*)::int as n from auth.users where id=$1", [recipient])).rows[0].n, 0);
      assert.equal((await pg.query("select count(*)::int as n from auth.sessions")).rows[0].n, 0);
      const summary = (await pg.query("select answer_body,feedback,feedback_tags,purged_at from public.practice_attempts where owner_id=$1", [owner])).rows[0];
      assert.equal(summary.answer_body, null); assert.equal(summary.feedback, null);
      assert.deepEqual(summary.feedback_tags, ["cohesion"]); assert.ok(summary.purged_at);
    });
    await t.test("Restoring a revoked AI key deletes that version and preserves newer replacements", async () => {
      await pg.query("insert into public.provider_keys(owner_id,kind,provider,encrypted_key,iv,updated_at) values ($1,'text','deepseek','fixture-ciphertext','fixture-iv','2026-09-01T00:00:00Z')", [owner]);
      const event = { entity: "provider_key", entityId: owner, ownerId: owner, keyKind: "text", updatedBefore: "2026-09-01T00:00:00Z", at: "2026-09-02T00:00:00Z" };
      const replay = deletionReplaySql([event], "snapshots/fixture/", hash(Buffer.from("ledger-key")));
      await pg.exec(replay);
      assert.equal((await pg.query("select count(*)::int n from public.provider_keys")).rows[0].n, 0);
      await pg.query("insert into public.provider_keys(owner_id,kind,provider,encrypted_key,iv,updated_at) values ($1,'text','deepseek','new-fixture-ciphertext','fixture-iv','2026-09-03T00:00:00Z')", [owner]);
      await pg.exec(replay);
      assert.equal((await pg.query("select count(*)::int n from public.provider_keys")).rows[0].n, 1);
    });
  } finally { await pg.close(); }
});
