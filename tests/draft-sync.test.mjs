
import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {IDBFactory} from 'fake-indexeddb';
registerHooks({resolve(specifier,context,next){try{return next(specifier,context);}catch(error){if(specifier.startsWith('./')&&context.parentURL?.includes('/lib/')&&!specifier.endsWith('.ts'))return next(specifier+'.ts',context);throw error;}}});
const {syncPendingDrafts}=await import('../lib/draft-sync.ts');
const {saveLocalDraft,readLocalDraft}=await import('../lib/offline-drafts.ts');
const client={auth:{getSession:async()=>({data:{session:{user:{id:'qa'},access_token:'local-fixture'}}})}};
async function fixture(work){globalThis.indexedDB=new IDBFactory();const previous=globalThis.fetch;const nav=Object.getOwnPropertyDescriptor(globalThis,'navigator');Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});try{await work();}finally{globalThis.fetch=previous;if(nav)Object.defineProperty(globalThis,'navigator',nav);else delete globalThis.navigator;}}
test('Background synchronization skips active micro and reading drafts',async()=>fixture(async()=>{
 await saveLocalDraft('qa','micro:builtin:rewrite-clarity','active',3);
 await saveLocalDraft('qa','practice:reading','answers',2);
 await saveLocalDraft('qa','writing','inactive',4,7);
 const requests=[];globalThis.fetch=async(url,options)=>{requests.push({url,...options});return new Response('{}',{status:200});};
 assert.equal(await syncPendingDrafts(client,'qa',()=> 'micro:builtin:rewrite-clarity'),true);
 assert.equal(requests.length,1);assert.equal(requests[0].url,'/api/drafts');assert.ok(requests[0].signal instanceof AbortSignal);
 assert.equal(JSON.parse(requests[0].body).materialRevision,7);
 assert.equal(await readLocalDraft('qa','writing'),null);
 assert.equal((await readLocalDraft('qa','micro:builtin:rewrite-clarity')).body,'active');
 assert.equal((await readLocalDraft('qa','practice:reading')).body,'answers');
}));
test('Conflict responses retain encrypted drafts and later retry can succeed',async()=>fixture(async()=>{
 await saveLocalDraft('qa','micro:builtin:rewrite-clarity','original',2);
 globalThis.fetch=async()=>new Response('{}',{status:409});
 assert.equal(await syncPendingDrafts(client,'qa',()=>null),false);
 assert.equal((await readLocalDraft('qa','micro:builtin:rewrite-clarity')).body,'original');
 globalThis.fetch=async(url,options)=>{assert.equal(url,'/api/micro-sessions');return new Response('{}',{status:200});};
 assert.equal(await syncPendingDrafts(client,'qa',()=>null),true);
 assert.equal(await readLocalDraft('qa','micro:builtin:rewrite-clarity'),null);
}));
test('Network failure releases synchronization lock and preserves local content',async()=>fixture(async()=>{
 await saveLocalDraft('qa','writing','retained',1);
 globalThis.fetch=async()=>{throw new Error('offline');};
 assert.equal(await syncPendingDrafts(client,'qa',()=>null),false);
 assert.equal((await readLocalDraft('qa','writing')).body,'retained');
 globalThis.fetch=async()=>new Response('{}',{status:200});
 assert.equal(await syncPendingDrafts(client,'qa',()=>null),true);
}));
