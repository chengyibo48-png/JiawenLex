import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {z,ZodError} from 'zod';
const owner='00000000-0000-4000-8000-000000000001',id='00000000-0000-4000-8000-000000000002',wordId='00000000-0000-4000-8000-000000000003';
class HttpError extends Error{constructor(status,message){super(message);this.status=status;}}
function fixture({version=1,race=false,failDetails=false,throwDetails=false,revoked=false}={}){
 const review={id,owner_id:owner,version,notes:{other:{reason:'meaning',note:'Retain other question'}},snapshot:{questions:[{id:'q1'}]}};
 const word={id:wordId,owner_id:owner,term:'Word',interval_days:14,streak:3};
 const source={id:'source',owner_id:owner,word_id:wordId,attempt_id:id,question_id:'q1'};
 const task={id:wordId,owner_id:owner,planned_date:'2026-11-01'};
 const tables={attempt_reviews:[review],vocabulary:[word],vocabulary_sources:[source],study_tasks:[task]};
 const admin={rpc:async()=>({data:wordId,error:null}),from(table){const filters=[];let patch;return {
  select(){return this;},eq(key,value){filters.push(row=>row[key]===value);return this;},
  update(value){patch=value;return this;},ilike(){return this;},limit(){return this;},
  async execute(single){
   if(throwDetails&&table!=='attempt_reviews')throw new Error('Transport failed after commit');
   if(failDetails&&table!=='attempt_reviews')return {data:null,error:new Error('Read unavailable')};
   if(race&&patch){review.version=2;review.notes.q1={reason:'other',note:'Other page changed this'};}
   const matched=tables[table].filter(row=>filters.every(filter=>filter(row)));
   if(patch)for(const row of matched)Object.assign(row,patch);
   return {data:single?(matched[0]?structuredClone(matched[0]):null):structuredClone(matched),error:null};
  },maybeSingle(){return this.execute(true);},single(){return this.execute(true);},then(resolve,reject){return this.execute(false).then(resolve,reject);}
 };}};
 const context={exports:{},Request,Response,Date,console,require(name){
  if(name==='next/server')return {NextResponse:{json:(body,init)=>Response.json(body,init)}};
  if(name==='zod')return {z};
  if(name==='@/lib/review')return {normalizeTerm:term=>term.trim().replace(/\s+/g,' ').toLowerCase()};
  if(name==='@/lib/server-auth')return {HttpError,requireUser:async()=>{if(revoked)throw new HttpError(401,'Expired');return {userId:owner,admin};},apiError:error=>Response.json({error:error.message},{status:error instanceof HttpError?error.status:error instanceof ZodError?400:500})};
  throw Error(name);
 }};
 const compiled=stripTypeScriptTypes(fs.readFileSync(new URL('../app/api/reviews/route.ts',import.meta.url),'utf8')).replace(/^import \{ (.*?) \} from "(.*?)";/gm,(_,names,name)=>`const { ${names} } = require("${name}");`).replace(/export async function (GET|POST)/g,(_,method)=>`exports.${method} = async function ${method}`);
 vm.runInNewContext(compiled,context);
 return {review,post:body=>context.exports.POST(new Request('http://localhost/api/reviews',{method:'POST',body:JSON.stringify({id,questionId:'q1',...body})}))};
}
test('Saved review note returns its authoritative row and retains other question notes',async()=>{
 const f=fixture(),res=await f.post({action:'note',version:1,reason:'meaning',note:'Saved note'}),body=await res.json();
 assert.equal(res.status,200);assert.equal(body.review.version,2);assert.equal(body.review.notes.q1.note,'Saved note');assert.equal(body.review.notes.other.note,'Retain other question');
});
test('Conflicts before and during compare-and-swap include the latest review without overwriting it',async()=>{
 for(const options of [{version:2},{race:true}]){const f=fixture(options),res=await f.post({action:'note',version:1,reason:'meaning',note:'Local pending'}),body=await res.json();assert.equal(res.status,409);assert.equal(body.review.version,2);assert.notEqual(body.review.notes.q1?.note,'Local pending');}
});
test('Word and schedule responses extend legacy id and expose owner-scoped authoritative records',async()=>{
 const f=fixture();const word=await (await f.post({action:'word',term:'Word',definition:'meaning',mergeId:wordId})).json();assert.equal(word.id,wordId);assert.equal(word.word.owner_id,owner);assert.equal(word.word.interval_days,14);assert.equal(word.source.question_id,'q1');assert.equal(word.added,false);
 const task=await (await f.post({action:'schedule',date:'2026-11-01',minutes:10})).json();assert.equal(task.id,wordId);assert.equal(task.task.planned_date,'2026-11-01');
});
test('A committed RPC remains successful when details fail to refresh',async()=>{
 for(const options of [{failDetails:true},{throwDetails:true}]){const f=fixture(options);for(const action of [{action:'word',term:'new',definition:'meaning'},{action:'schedule',date:'2026-11-01',minutes:10}]){const res=await f.post(action),body=await res.json();assert.equal(res.status,200);assert.equal(body.id,wordId);assert.equal(body.refreshRequired,true);}}
});
test('Missing questions, invalid calendar dates and revoked sessions cannot write',async()=>{
 assert.equal((await fixture().post({action:'note',questionId:'missing',version:1,reason:'',note:''})).status,404);
 assert.equal((await fixture().post({action:'schedule',date:'2026-02-30',minutes:10})).status,400);
 assert.equal((await fixture({revoked:true}).post({action:'schedule',date:'2026-11-01',minutes:10})).status,401);
});
