import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({resolve(specifier,context,next){try{return next(specifier,context);}catch(error){if(specifier.startsWith('./')&&context.parentURL?.includes('/lib/')&&!specifier.endsWith('.ts'))return next(specifier+'.ts',context);throw error;}}});
const { hasLearningActivity, nextCalendarDate, mergeById } = await import('../lib/learning-flow.ts');
const { apiFetch, ApiError } = await import('../lib/supabase.ts');
const { isGradableQuestion, isCorrectAnswer } = await import('../lib/study.ts');
test('Explicitly unchecked questions cannot produce a scored accuracy',()=>{
  const question={id:'q1',prompt:'Unverified',answers:['answer'],verified:false};
  assert.equal(isGradableQuestion(question),false);
  assert.equal(isCorrectAnswer(question,'answer'),false);
  assert.equal(isGradableQuestion({...question,verified:true}),true);
});
const base = {state:{phase:'active',answers:{},elapsedSeconds:0,startedAt:null,flagged:[],revealed:[]}};
test('Untouched practice and empty multiple choice do not take the primary action',()=>{
  assert.equal(hasLearningActivity(base),false);
  assert.equal(hasLearningActivity({state:{...base.state,answers:{q1:'[]',q2:'  '}}}),false);
  for(const patch of [{answers:{q1:'answer'}},{elapsedSeconds:10},{startedAt:123},{flagged:['q1']},{revealed:['q1']}])assert.equal(hasLearningActivity({state:{...base.state,...patch}}),true);
  assert.equal(hasLearningActivity({state:{...base.state,answers:{q1:'answer'},phase:'completed'}}),false);
});
test('Calendar scheduling handles DST boundaries, month/year rollover and invalid input',()=>{
  assert.equal(nextCalendarDate('2026-03-08'),'2026-03-09');
  assert.equal(nextCalendarDate('2026-11-01'),'2026-11-02');
  assert.equal(nextCalendarDate('2026-12-31'),'2027-01-01');
  assert.equal(nextCalendarDate('2028-02-28'),'2028-02-29');
  assert.throws(()=>nextCalendarDate('2026-02-30'));
});
test('Authoritative responses insert new rows in partial lists and replace only matching ids',()=>{
  const rows=[{id:'a',note:'pending elsewhere'},{id:'b',note:'old'}];
  assert.deepEqual(mergeById(rows,{id:'b',note:'saved'}),[rows[0],{id:'b',note:'saved'}]);
  assert.equal(mergeById(rows,{id:'c',note:'new'}).length,3);
  assert.equal(rows[1].note,'old');
  assert.deepEqual(mergeById([],{id:'c'}),[{id:'c'}]);
});
const client={auth:{getSession:async()=>({data:{session:{access_token:'local-test-only'}}})}};
test('Structured HTTP errors keep the conflict response and Error compatibility',async()=>{
  const previous=globalThis.fetch;
  try {
    globalThis.fetch=async()=>new Response(JSON.stringify({error:'Conflict; input retained',review:{id:'review',version:2}}),{status:409});
    await assert.rejects(apiFetch(client,'/api/reviews'),error=>error instanceof Error&&error instanceof ApiError&&error.status===409&&error.body.review.version===2);
    globalThis.fetch=async()=>new Response('unavailable',{status:503});
    await assert.rejects(apiFetch(client,'/api/reviews'),error=>error.status===503&&error.body&&error.message.includes('503'));
  }finally{globalThis.fetch=previous;}
});
test('A committed write with failed follow-up read remains a success requiring refresh',async()=>{
  const previous=globalThis.fetch;
  try{
    globalThis.fetch=async()=>Response.json({id:'saved-id',word:null,refreshRequired:true});
    assert.deepEqual(await apiFetch(client,'/api/reviews',{method:'POST'}),{id:'saved-id',word:null,refreshRequired:true});
  }finally{globalThis.fetch=previous;}
});
