
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { deletionReplaySql, hash } from '../scripts/backup-core.mjs';
import { PGlite } from '@electric-sql/pglite';
const migrations=new URL('../supabase/migrations/',import.meta.url);
const admin='10000000-0000-4000-8000-000000000001', member='10000000-0000-4000-8000-000000000002', session='10000000-0000-4000-8000-000000000003';
const material='10000000-0000-4000-8000-000000000004', attempt='10000000-0000-4000-8000-000000000005';
async function asUser(pg,id){await pg.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:id,role:'authenticated',session_id:session})]);await pg.exec('set local role authenticated');}
async function denied(pg,work,pattern){await pg.exec('savepoint rejection');await assert.rejects(work(),pattern);await pg.exec('rollback to rejection');}
test('Three-phase database regressions',async t=>{
const pg=await PGlite.create();try{
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

await pg.exec("insert into public.invite_control(id,code_hash) values(1,encode(sha256(convert_to('JiawenLex-phase-fixture-invite','UTF8')),'hex'))");
for(const [id,name] of [[admin,'Admin'],[member,'Member']])await pg.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[id,name+'@example.invalid',JSON.stringify({invite_code:'JiawenLex-phase-fixture-invite',display_name:name})]);
await pg.query('insert into auth.sessions(id,user_id) values($1,$2)',[session,admin]);
await pg.query("insert into public.materials(id,owner_id,title,skill,visibility,approval,source_title,license_name,passage,questions) values($1,$2,'Shared fixture','reading','shared','pending','Original','Authorized',$3,$4)",[material,member,'First paragraph.\nSecond paragraph.',JSON.stringify([{id:'q1',prompt:'Prompt fallback',answers:['answer'],evidence:{paragraph:2}}])]);
await t.test('Administrator cannot change another owner collection or audio segments',async()=>{
 await pg.exec('begin');try{await asUser(pg,admin);
 await denied(pg,()=>pg.query("update public.materials set collection_title='Forged' where id=$1",[material]),/Admin may only review/);
 await denied(pg,()=>pg.query("update public.materials set audio_segments='[{\"id\":\"x\",\"start\":0,\"end\":1,\"text\":\"forged\"}]' where id=$1",[material]),/Admin may only review/);
 }finally{await pg.exec('rollback');}
});
await t.test('Administrator can approve and approval produces an immutable revision',async()=>{
 await pg.exec('begin');try{await asUser(pg,admin);await pg.query("update public.materials set approval='approved' where id=$1",[material]);
 assert.equal((await pg.query('select revision from public.materials where id=$1',[material])).rows[0].revision,2);
 assert.equal((await pg.query('select count(*)::int as n from public.material_versions where material_id=$1',[material])).rows[0].n,2);
 await denied(pg,()=>pg.query("update public.material_versions set snapshot='{}' where material_id=$1",[material]),/permission denied/);
 }finally{await pg.exec('rollback');}
});
await pg.query("insert into public.practice_attempts(id,owner_id,material_id,skill,mode) values($1,$2,$3,'reading','practice')",[attempt,member,material]);
await pg.query('insert into public.attempt_reviews(id,owner_id,snapshot) values($1,$2,$3)',[attempt,member,JSON.stringify({id:material,title:'Fixture',skill:'reading',passage:'First paragraph.\nSecond paragraph.',questions:[{id:'q1',prompt:'Prompt fallback',evidence:{paragraph:2}}]})]);
await t.test('Review vocabulary retains the actual evidence paragraph',async()=>{
 await pg.exec('begin');try{await pg.exec('set local role service_role');await pg.query("select public.add_review_word($1,$2,'q1','paragraph','段落')",[member,attempt]);
 assert.equal((await pg.query('select context from public.vocabulary_sources where attempt_id=$1',[attempt])).rows[0].context,'Second paragraph.');
 }finally{await pg.exec('rollback');}
});
await t.test('Vocabulary deduplication collapses spaces and case',async()=>{
 await pg.exec('begin');try{await pg.query("insert into public.vocabulary(owner_id,term,definition) values($1,'Food   BANK','食物银行')",[member]);await pg.exec('set local role service_role');
 await denied(pg,()=>pg.query("select public.add_review_word($1,$2,'q1',' food bank ','食物银行')",[member,attempt]),/duplicate_word_confirmation_required/);
 }finally{await pg.exec('rollback');}
});
await t.test('Admin cannot read member private review or resume state',async()=>{
 await pg.query("insert into public.practice_sessions(owner_id,material_id,skill,state) values($1,$2,'reading','{}')",[member,material]);
 await pg.query("insert into public.micro_sessions(owner_id,material_id,body) values($1,'original:one','{}')",[member]);
 await pg.exec('begin');try{await asUser(pg,admin);
 for(const table of ['attempt_reviews','practice_sessions','micro_sessions'])assert.equal((await pg.query('select count(*)::int as n from public.'+table)).rows[0].n,0);
 await denied(pg,()=>pg.query("select public.add_review_word($1,$2,'q1','word','释义')",[member,attempt]),/permission denied/);
 }finally{await pg.exec('rollback');}
});
await t.test('Yearly purge deletes review context and retains objective summary',async()=>{
 await pg.exec('begin');try{await pg.query("update public.practice_attempts set question_stats='[{\"type\":\"short\",\"count\":1,\"correct\":0}]',answer_body=null,purged_at=now() where id=$1",[attempt]);
 assert.equal((await pg.query('select count(*)::int as n from public.attempt_reviews where id=$1',[attempt])).rows[0].n,0);
 assert.equal((await pg.query('select jsonb_array_length(question_stats) as n from public.practice_attempts where id=$1',[attempt])).rows[0].n,1);
 }finally{await pg.exec('rollback');}
});

await t.test('Objective submission is atomic, idempotent and rejects changed source',async()=>{
 await pg.exec('begin');try{
 const m=(await pg.query('select * from public.materials where id=$1',[material])).rows[0];
 const snap={prompt:m.prompt,revision:m.revision,id:m.id,title:m.title,skill:m.skill,passage:m.passage,transcript:m.transcript,questions:m.questions,question_type:m.question_type,audio_segments:m.audio_segments,audio_path:m.file_path,source_title:m.source_title,license_name:m.license_name};
 const id='10000000-0000-4000-8000-000000000010';
 const payload={id,owner_id:member,material_id:material,mode:'practice',duration_seconds:30,correct_count:1,question_count:1,answer_body:{q1:'answer'},question_stats:[{type:'short',count:1,correct:1}],flagged:['q1']};
 await pg.exec('set local role service_role');
 await pg.query('select public.submit_objective_attempt($1,$2)',[payload,snap]);
 await pg.query('select public.submit_objective_attempt($1,$2)',[{...payload,answer_body:{q1:'changed'}},snap]);
 assert.deepEqual((await pg.query('select answer_body from public.practice_attempts where id=$1',[id])).rows[0].answer_body,{q1:'answer'});
 assert.equal((await pg.query('select material_revision from public.practice_attempts where id=$1',[id])).rows[0].material_revision,m.revision);
 await pg.query("update public.materials set title='Updated title' where id=$1",[material]);
 assert.equal((await pg.query('select snapshot from public.attempt_reviews where id=$1',[id])).rows[0].snapshot.title,m.title);
 const changed={...payload,id:'10000000-0000-4000-8000-000000000011'};
 await denied(pg,()=>pg.query('select public.submit_objective_attempt($1,$2)',[changed,snap]),/Material changed/);
 assert.equal((await pg.query('select count(*)::int as n from public.practice_attempts where id=$1',[changed.id])).rows[0].n,0);
 }finally{await pg.exec('rollback');}
});
await t.test('Writing submission retains the original revision after prompt changes',async()=>{
 await pg.exec('begin');try{
 const id='10000000-0000-4000-8000-000000000012', result='10000000-0000-4000-8000-000000000013';
 await pg.query("insert into public.materials(id,owner_id,title,skill,prompt,source_title,license_name) values($1,$2,'Writing fixture','writing','Original prompt','Original','Authorized')",[id,member]);
 const snap=(await pg.query('select snapshot from public.material_versions where material_id=$1 and revision=1',[id])).rows[0].snapshot;
 await pg.query("update public.materials set prompt='Changed prompt' where id=$1",[id]);
 await pg.exec('set local role service_role');
 await pg.query('select public.submit_response_attempt($1,$2)',[{id:result,owner_id:member,material_id:id,material_revision:1,skill:'writing',mode:'practice',duration_seconds:60,answer_body:{text:'My original response'},saved_recording:false},snap]);
 assert.equal((await pg.query('select material_revision from public.practice_attempts where id=$1',[result])).rows[0].material_revision,1);
 assert.equal((await pg.query('select snapshot from public.attempt_reviews where id=$1',[result])).rows[0].snapshot.prompt,'Original prompt');
 }finally{await pg.exec('rollback');}
});
await t.test('Revoking a share immediately removes access to its historical versions',async()=>{
 await pg.exec('begin');try{
 const id='10000000-0000-4000-8000-000000000014', grant='10000000-0000-4000-8000-000000000015';
 await pg.query("insert into public.materials(id,owner_id,title,skill,source_title,license_name) values($1,$2,'Private fixture','reading','Original','Authorized')",[id,member]);
 await pg.query("insert into public.share_grants(id,owner_id,recipient_id,target_type,target_id) values($1,$2,$3,'material',$4)",[grant,member,admin,id]);
 await asUser(pg,admin);
 assert.equal((await pg.query('select count(*)::int as n from public.material_versions where material_id=$1',[id])).rows[0].n,1);
 await pg.exec('reset role');await pg.query('update public.share_grants set revoked_at=now() where id=$1',[grant]);
 await asUser(pg,admin);
 assert.equal((await pg.query('select count(*)::int as n from public.material_versions where material_id=$1',[id])).rows[0].n,0);
 }finally{await pg.exec('rollback');}
});
await t.test('Deletion replay removes micro response details while retaining summaries',async()=>{
 const id='10000000-0000-4000-8000-000000000016';
 await pg.query("insert into public.micro_attempts(id,owner_id,unit_key,kind,skill,duration_seconds,item_count,answer_body,self_review,unit_snapshot,criteria_total,criteria_passed) values($1,$2,'original:rewrite','rewrite','writing',60,4,'{\"text\":\"private\"}','{\"review\":true}','{\"title\":\"fixture\"}',10,7)",[id,member]);
 await pg.exec(deletionReplaySql([{entity:'purged_micro_attempt',entityId:id,ownerId:member,at:'2026-09-29T00:00:00Z'}],'snapshots/2026-09-29T00-00-00-000Z-abc12345/',hash(Buffer.from('fixture-ledger'))));
 const row=(await pg.query('select * from public.micro_attempts where id=$1',[id])).rows[0];
 assert.equal(row.answer_body,null);assert.equal(row.self_review,null);assert.equal(row.unit_snapshot,null);
 assert.equal(row.criteria_passed,7);assert.equal(row.item_count,4);assert.ok(row.purged_at);
});

}finally{await pg.close();}});
