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
      const sql = (await fs.readFile(new URL(name, migrations), "utf8"))
        .replace("create extension if not exists pgcrypto;", "")
        .replace("create extension if not exists pg_cron;", "")
        .replace("create extension if not exists pg_net;", "");
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
    await t.test("Original archive and correction rows are service API only", async () => {
      for (const table of ["source_documents", "source_upload_sessions", "source_parse_batches", "source_review_candidates", "source_import_tokens", "question_error_reports"]) {
        const result = await pg.query(
          "select has_table_privilege('anon',$1,'select') as anon_read, has_table_privilege('authenticated',$1,'select') as member_read, has_table_privilege('authenticated',$1,'insert') as member_insert, has_table_privilege('authenticated',$1,'update') as member_update, has_table_privilege('authenticated',$1,'delete') as member_delete",
          ["public." + table],
        );
        assert.deepEqual(result.rows[0], {
          anon_read: false, member_read: false, member_insert: false, member_update: false, member_delete: false,
        });
      }
    });
    await t.test("Question corrections require the owner and reject stale snapshots", async () => {
      const materialId = "00000000-0000-4000-8000-000000000010";
      const originalQuestion = { id: "q1", prompt: "What is the answer?", answers: ["one"], explanation: "Original explanation" };
      const expected = { prompt: originalQuestion.prompt, answers: originalQuestion.answers, explanation: originalQuestion.explanation };
      await pg.exec("begin");
      try {
        await pg.query(
          "insert into public.materials(id,owner_id,title,skill,visibility,approval,questions) values ($1,$2,'Correction fixture','reading','private','approved',$3)",
          [materialId, owner, JSON.stringify([originalQuestion])],
        );
        await pg.exec("set local role service_role");
        const submitted = await pg.query(
          "select * from public.submit_question_error_report($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [materialId, "q1", recipient, "answer", "Answer should include another variant", JSON.stringify(expected), null, JSON.stringify(["one", "a single unit"]), null],
        );
        assert.equal(submitted.rows[0].direct_edit, false);
        const reportId = submitted.rows[0].report_id;
        await denied(
          pg,
          () => pg.query("select public.apply_question_error_report($1,$2,$3)", [reportId, recipient, "Unauthorized edit"]),
          /report_unavailable/,
        );
        await pg.query(
          "select public.apply_question_error_report($1,$2,$3,null,$4)",
          [reportId, owner, null, "Reviewed explanation"],
        );
        const applied = (await pg.query("select questions,revision from public.materials where id=$1", [materialId])).rows[0];
        assert.deepEqual(applied.questions[0].answers, ["one", "a single unit"]);
        assert.equal(applied.questions[0].explanation, "Reviewed explanation");
        assert.equal(applied.revision, 2);
        assert.equal((await pg.query("select status from public.question_error_reports where id=$1", [reportId])).rows[0].status, "applied");

        const updatedQuestion = applied.questions[0];
        const staleExpected = { prompt: updatedQuestion.prompt, answers: updatedQuestion.answers, explanation: updatedQuestion.explanation };
        const stale = await pg.query(
          "select * from public.submit_question_error_report($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [materialId, "q1", recipient, "grammar", "Prompt wording is awkward", JSON.stringify(staleExpected), "Suggested prompt", null, null],
        );
        const staleReportId = stale.rows[0].report_id;
        const changedQuestion = { ...updatedQuestion, prompt: "A newer prompt" };
        await pg.query("update public.materials set questions=$2 where id=$1", [materialId, JSON.stringify([changedQuestion])]);
        await denied(
          pg,
          () => pg.query("select public.apply_question_error_report($1,$2)", [staleReportId, owner]),
          /question_changed_since_report/,
        );
        assert.equal((await pg.query("select status from public.question_error_reports where id=$1", [staleReportId])).rows[0].status, "pending");
        assert.equal((await pg.query("select questions->0->>'prompt' as prompt from public.materials where id=$1", [materialId])).rows[0].prompt, "A newer prompt");
      } finally { await pg.exec("rollback"); }
    });
    await pg.query("insert into auth.sessions(id,user_id) values ($1,$2)", [session, owner]);
    await t.test("Word reviews are idempotent, private and preserve schedules on reimport", async () => {
      await pg.exec("begin");
      try {
        const cardId="10000000-0000-4000-8000-000000000001", eventId="10000000-0000-4000-8000-000000000002";
        const card={term:"test",definition:"测试",example:"",part_of_speech:"n.",tags:["reading"]};
        await pg.exec("set local role service_role");
        await pg.query("select public.import_word_card($1,$2,$3,$4)",[owner,cardId,"fixture-word",JSON.stringify(card)]);
        const first=(await pg.query("select public.record_word_review($1,$2,$3,true,1) as value",[owner,cardId,eventId])).rows[0].value;
        const again=(await pg.query("select public.record_word_review($1,$2,$3,true,1) as value",[owner,cardId,eventId])).rows[0].value;
        assert.deepEqual(again,first);assert.equal(first.interval_days,1);assert.equal(first.streak,1);
        await denied(pg,()=>pg.query("select public.record_word_review($1,$2,$3,false,1)",[owner,cardId,eventId]),/review_event_mismatch/);
        await denied(pg,()=>pg.query("select public.record_word_review($1,$2,$3,true,1)",[recipient,cardId,eventId]),/word_unavailable/);
        const imported=(await pg.query("select public.import_word_card($1,$2,$3,$4) as value",[owner,cardId,"fixture-word",JSON.stringify({...card,tags:["listening"]})])).rows[0].value;
        assert.equal(imported.streak,1);assert.equal(imported.last_reviewed_at,first.last_reviewed_at);
        assert.deepEqual(imported.tags,["listening","reading"]);assert.equal(imported.content_revision,1);
        await pg.query("update public.vocabulary set definition='新的含义' where id=$1",[cardId]);
        assert.equal((await pg.query("select content_revision from public.vocabulary where id=$1",[cardId])).rows[0].content_revision,2);
        await denied(pg,()=>pg.query("select public.record_word_review($1,$2,$3,true,1)",[owner,cardId,"10000000-0000-4000-8000-000000000003"]),/word_changed/);
      } finally {await pg.exec("rollback");}
    });
    await t.test("Word corrections are atomic and do not reset memory progress", async () => {
      await pg.exec("begin");
      try {
        const wordId="20000000-0000-4000-8000-000000000001",reportId="20000000-0000-4000-8000-000000000002";
        await pg.query("insert into public.vocabulary(id,owner_id,term,definition,interval_days,streak) values($1,$2,'original','错误',8,3)",[wordId,owner]);
        await pg.query("insert into public.word_error_reports(id,owner_id,word_id,content_revision,kind,suggestion,snapshot) values($1,$2,$3,1,'meaning',$4,'{}')",[reportId,owner,wordId,JSON.stringify({term:"original",definition:"已更正",example:"",pronunciation_uk:"/test/"})]);
        await pg.exec("set local role service_role");
        await denied(pg,()=>pg.query("select public.apply_word_report($1,$2)",[recipient,reportId]),/report_unavailable/);
        await pg.query("select public.apply_word_report($1,$2)",[owner,reportId]);
        await pg.query("select public.apply_word_report($1,$2)",[owner,reportId]);
        const word=(await pg.query("select * from public.vocabulary where id=$1",[wordId])).rows[0];
        assert.equal(word.definition,"已更正");assert.equal(word.content_revision,2);assert.equal(word.interval_days,8);assert.equal(word.streak,3);
        assert.equal(word.pronunciation_uk,"/test/");
        assert.equal((await pg.query("select status from public.word_error_reports where id=$1",[reportId])).rows[0].status,"applied");
      } finally {await pg.exec("rollback");}
    });
    await t.test("Batch publication rejects unchecked OCR and can share a previously private card", async () => {
      await pg.exec("begin");
      try {
        const doc="40000000-0000-4000-8000-000000000001",batch="40000000-0000-4000-8000-000000000002",checked="40000000-0000-4000-8000-000000000003",unchecked="40000000-0000-4000-8000-000000000004",foreign="40000000-0000-4000-8000-000000000005";
        await pg.query("update public.profiles set role='admin' where id=$1",[owner]);
        await pg.query("insert into public.source_documents(id,owner_id,title,original_name,object_key,byte_size,sha256,page_count,rights_attested_at) values($1,$2,'Fixture','fixture.pdf','fixture-object',1,repeat('1',64),1,now())",[doc,owner]);
        await pg.query("insert into public.source_parse_batches(id,owner_id,document_id,total_pages) values($1,$2,$3,1)",[batch,owner,doc]);
        for(const [id,uid,verified] of [[checked,owner,true],[unchecked,owner,false],[foreign,recipient,true]]) await pg.query("insert into public.source_review_candidates(id,owner_id,document_id,batch_id,fingerprint,physical_page,content_kind,payload) values($1::uuid,$2,$3,$4,encode(sha256(convert_to($1::uuid::text,'UTF8')),'hex'),1,'vocabulary',$5)",[id,uid,doc,batch,JSON.stringify({term:'fixture-'+id,definition:'测试',reviewed_against_pdf:verified,extraction_issues:[],tags:[]})]);
        await signedIn(pg);
        const first=(await pg.query("select public.publish_verified_word_cards($1,false) as result",[[checked,unchecked,foreign]])).rows[0].result;
        assert.deepEqual(first.map(r=>r.published),[true,false,false]);
        const second=(await pg.query("select public.publish_verified_word_cards($1,true) as result",[[checked]])).rows[0].result;assert.equal(second[0].published,true);
        await pg.exec("reset role");
        assert.equal((await pg.query("select count(*)::int as count from public.vocabulary_templates where id=$1",[checked])).rows[0].count,1);
        assert.equal((await pg.query("select status from public.source_review_candidates where id=$1",[unchecked])).rows[0].status,"pending");
        assert.equal((await pg.query("select count(*)::int as count from public.vocabulary where id=$1",[checked])).rows[0].count,1);
      } finally {await pg.exec("rollback");}
    });
    await t.test("Method guides isolate private owner notes under search and sharing", async () => {
      await pg.exec("begin");
      try {
        await pg.query("insert into public.study_guides(id,owner_id,title,category,body) values('30000000-0000-4000-8000-000000000001',$1,'Private guide','plan','A private study plan')",[recipient]);
        await signedIn(pg);
        const found=await pg.query("select id from public.study_guides where title ilike '%guide%'");assert.equal(found.rows.length,0);
        await denied(pg,()=>pg.query("insert into public.study_guides(id,owner_id,title,category,body,visibility,approval,license_name) values('30000000-0000-4000-8000-000000000002',$1,'Public guide','plan','A guide','shared','approved','fixture-license')",[recipient]),/row-level security/);
      } finally {await pg.exec("rollback");}
    });
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
