import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); } catch (error) {
    if (specifier.startsWith('./') && context.parentURL?.includes('/lib/') && !specifier.endsWith('.ts')) return next(specifier + '.ts', context);
    throw error;
  }
} });
const { loadWorkspace, loadVocabulary } = await import('../lib/supabase.ts');

function fixture({size = 2100, cap = 1000, counts = true, failCount = false} = {}) {
  const calls = [];
  const words = Array.from({length:size}, (_,i) => ({id:String(i).padStart(6,'0'), owner_id:'member', term:`academic-${i}`, definition:'meaning', example:'sentence', tags:[], due_at:'2020-01-01', interval_days:0}));
  const tables = {profiles:[{id:'member',status:'active'}], vocabulary:words};
  const client = {
    rpc: async () => ({data:[],error:null}),
    from(table) {
      const opts = {table, head:false, count:false, cursor:null, limit:1000};
      const query = {
        select(columns, options) {opts.columns=columns;opts.head=!!options?.head;opts.count=!!options?.count;return query;},
        eq(key,value) {opts[key]=value;return query;}, lte() {return query;},
        order() {return query;}, limit(value) {opts.limit=value;return query;},
        gt(key,value) {opts.cursor=value;return query;},
        then(resolve,reject) {
          calls.push({...opts});
          if (opts.head) return Promise.resolve({data:null,count:words.length,error:failCount?new Error('count unavailable'):null}).then(resolve,reject);
          const all=tables[table]??[], rows=all.filter(row => opts.cursor===null || row.id>opts.cursor).slice(0,Math.min(cap,opts.limit));
          return Promise.resolve({data:rows,error:null,count:opts.count&&counts?all.length:null}).then(resolve,reject);
        },
      };return query;
    },
  };return {client,calls,words};
}

test('Dashboard loads an exact due count without downloading any vocabulary bodies', async () => {
  const {client,calls}=fixture({size:17847});
  const data=await loadWorkspace(client,'member',{includeWords:false});
  assert.equal(data.wordsLoaded,false);assert.equal(data.wordDueCount,17847);assert.deepEqual(data.words,[]);
  const reads=calls.filter(c=>c.table==='vocabulary');assert.equal(reads.length,1);
  assert.equal(reads[0].head,true);assert.equal(reads[0].owner_id,'member');assert.equal(reads[0].columns,'id');
  // One request per other table; no additional empty terminal pages.
  assert.equal(calls.length,15);
});
test('Vocabulary entry loads every word even when the API cap is smaller than the requested page',async()=>{
  const {client,calls,words}=fixture({cap:300});
  assert.deepEqual(await loadVocabulary(client),words);
  assert.equal(calls.length,7);assert.equal(calls[0].count,true);assert.equal(calls[1].count,false);
});
test('Missing counts retain safe keyset pagination rather than truncating data',async()=>{
  const {client,words}=fixture({cap:300,counts:false});assert.deepEqual(await loadVocabulary(client),words);
});
test('Existing eager loader remains compatible and inactive accounts cannot enter',async()=>{
  const {client,words}=fixture();const data=await loadWorkspace(client,'member');assert.equal(data.wordsLoaded,true);assert.deepEqual(data.words,words);
  await assert.rejects(loadWorkspace(client,'removed',{includeWords:false}),/账号已停用/);
});
test('Failed due counts report an error rather than misleading zero',async()=>{
  await assert.rejects(loadWorkspace(fixture({failCount:true}).client,'member',{includeWords:false}),/count unavailable/);
});

test('Dashboard counts due words without mutating the word list or review schedules',async()=>{
  const {countDueWords}=await import('../lib/study.ts');
  const words=[{id:'future',due_at:'2030-01-01'}, {id:'due',due_at:'2020-01-01'}, {id:'bad',due_at:'invalid'}];
  const before=structuredClone(words);assert.equal(countDueWords(words,Date.parse('2026-10-01')),1);assert.deepEqual(words,before);
});

test('Same-login loads share a request, but quick re-login starts fresh and old completion cannot clear it',async()=>{
  const {createSessionRequestQueue}=await import('../lib/session-requests.ts');
  const queue=createSessionRequestQueue();let finishOld,finishNew,calls=0;
  const old=queue.run('member',0,()=>{calls++;return new Promise(resolve=>finishOld=resolve);});
  assert.equal(queue.run('member',0,async()=>{throw Error('duplicate');}),old);
  await Promise.resolve();queue.reset();
  const fresh=queue.run('member',1,()=>{calls++;return new Promise(resolve=>finishNew=resolve);});
  assert.notEqual(fresh,old);await Promise.resolve();finishOld();await old;
  assert.equal(queue.run('member',1,async()=>{throw Error('old request released the new one');}),fresh);
  finishNew();await fresh;assert.equal(calls,2);
  await queue.run('other-member',2,async()=>{calls++;});assert.equal(calls,3);
});

test('Confirmed task saves survive older background replies without admitting another owner',async()=>{
  const {mergeConfirmedRows}=await import('../lib/session-requests.ts');
  const old=[{id:'task',owner_id:'member',status:'todo'}];
  const changed={...old[0],status:'done'};
  const result=mergeConfirmedRows(old,new Map([['task',changed],['new',{id:'new',owner_id:'member',status:'todo'}],['foreign',{id:'foreign',owner_id:'other',status:'done'}]]),'member');
  assert.equal(result[0].status,'done');assert.deepEqual(result.map(row=>row.id),['task','new']);assert.equal(old[0].status,'todo');
});
