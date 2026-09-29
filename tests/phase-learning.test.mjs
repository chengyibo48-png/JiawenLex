
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({resolve(specifier,context,next){try{return next(specifier,context);}catch(error){if(specifier.startsWith('./')&&context.parentURL?.includes('/lib/')&&!specifier.endsWith('.ts'))return next(specifier+'.ts',context);throw error;}}});
const {sessionHasStarted,materialStamp,initialSessionState,sameSessionState,practiceMaterials}=await import('../lib/practice-sessions.ts');
const {newMicroState,parseMicroState,microComplete,materialUnit,topicMatches,originalUnits}=await import('../lib/micro-training.ts');
const {initialDemoData}=await import('../lib/demo.ts');
const {snapshotMaterial}=await import('../lib/review.ts');
test('Material stamp follows immutable revision, prompt and audio changes',()=>{
 const material={...initialDemoData().materials[0],revision:1};
 const stamp=materialStamp(material);
 assert.equal(materialStamp({...material}),stamp);
 for(const patch of [{revision:2},{prompt:'Updated prompt'},{file_path:'new-audio.wav'},{audio_segments:[{id:'1',start:0,end:5,text:'updated'}]}])assert.notEqual(materialStamp({...material,...patch}),stamp);
});
test('Practice state preserves answer, flags and pane without key-order conflicts',()=>{
 const material=initialDemoData().materials[0]; const state=initialSessionState(material);
 state.answers={q1:'volunteers',q2:'food banks'};state.flagged=['q2'];state.mobilePane='passage';
 assert.equal(sameSessionState(state,{...state,answers:{q2:'food banks',q1:'volunteers'}}),true);
 assert.equal(sameSessionState(state,{...state,answers:{q1:'changed'}}),false);
});
test('Unapproved shared materials are not available to other learners',()=>{
 const data=initialDemoData();data.materials[0]={...data.materials[0],owner_id:'someone',approval:'pending'};
 assert.equal(practiceMaterials(data).some(m=>m.id==='sample-reading'),false);
});
test('Every original micro training requires answers and reference review',()=>{
 for(const unit of originalUnits){const state=newMicroState(unit);assert.equal(microComplete(unit,state),false);
 for(const item of unit.items){state.answers[item.id]=item.answers[0];state.revealed.push(item.id);state.checks[item.id]=Object.fromEntries(item.checklist.map((_,n)=>[String(n),false]));}
 assert.equal(microComplete(unit,state),true);assert.deepEqual(parseMicroState(JSON.stringify(state),unit),state);
 state.revealed.pop();assert.equal(microComplete(unit,state),false);
 }
});
test('Micro state rejects corrupt drafts and retains version-conflict inputs',()=>{
 const unit=originalUnits[0],state=newMicroState(unit);
 assert.equal(parseMicroState('broken',unit),null);
 assert.equal(parseMicroState(JSON.stringify({...state,index:999}),unit),null);
 assert.equal(parseMicroState(JSON.stringify({...state,checks:{p1:{0:'yes'}}}),unit),null);
 assert.equal(parseMicroState(JSON.stringify({...state,stamp:'previous-version'}),unit)?.stamp,'previous-version');
});
test('Custom training needs a usable source, permission and full completion standard',()=>{
 const m={...initialDemoData().materials[0],training_kind:'paraphrase',questions:[{id:'x',prompt:'Choose',choices:['a','b'],answers:['a'],explanation:'Because a'}]};
 assert.ok(materialUnit(m));assert.equal(materialUnit({...m,license_name:''}),null);
 assert.equal(materialUnit({...m,questions:[{...m.questions[0],explanation:''}]}),null);
 assert.equal(materialUnit({...m,skill:'writing'}),null);
 assert.equal(topicMatches(originalUnits[0],'paraphrase'),true);
 assert.equal(topicMatches(originalUnits[0],'unrelated'),false);
});
test('Attempt snapshot records source revision and question evidence',()=>{
 const m={...initialDemoData().materials[0],revision:3};const snap=snapshotMaterial(m);
 assert.equal(snap.revision,3);assert.deepEqual(snap.questions,m.questions);assert.equal(snap.license_name,m.license_name);
});

test('Timed practice cannot submit before its clock starts; an expired started session may submit',()=>{
 const state=initialSessionState(initialDemoData().materials[0]);
 assert.equal(sessionHasStarted(state),true);
 state.mode='timed';assert.equal(sessionHasStarted(state),false);
 state.startedAt=Date.now()-21*60*1000;state.deadline=state.startedAt+20*60*1000;
 assert.equal(sessionHasStarted(state),true);
});
