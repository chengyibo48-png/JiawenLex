// Authorized local maintenance: use a real short-lived owner session and the application's review API.
// Session secrets never appear in bundles, logs or committed files.
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
const owner=process.argv.find(a=>a.startsWith('--owner='))?.slice(8);
const base=process.argv.find(a=>a.startsWith('--base='))?.slice(7)??'http://localhost:3000';
const selected=process.argv.find(a=>a.startsWith('--sha='))?.slice(6);
const directory=process.argv.includes('--verified')?'verified-bundles':'learning-bundles';
if(!owner||!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base))throw new Error('Explicit owner and local application required');
const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const normal=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const check=r=>{if(r.error)throw new Error(r.error.message);return r.data;};
const profile=check(await admin.from('profiles').select('id,role,status').eq('id',owner).single());
if(profile.role!=='admin'||profile.status!=='active')throw new Error('Active archive-owner administrator required');
const user=check(await admin.auth.admin.getUserById(owner)).user;
let session;
try{
 const link=check(await admin.auth.admin.generateLink({type:'magiclink',email:user.email}));
 session=check(await normal.auth.verifyOtp({token_hash:link.properties.hashed_token,type:'magiclink'})).session;
 if(!session||session.user.id!==owner)throw new Error('Session owner mismatch');
 const request=async(path,body)=>{for(let attempt=0;;attempt++){let response;try{response=await fetch(base+path,{method:'POST',headers:{authorization:`Bearer ${session.access_token}`,'content-type':'application/json'},body:JSON.stringify(body)});}catch(error){if(attempt<2)continue;throw error;}const value=await response.json();if(!response.ok){if(response.status>=500&&attempt<2){await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));continue;}throw new Error(`${path}: ${value.error??response.status}`);}return value;}};
 let imported=0,published=0,pending=0;
 for(const name of (await readdir(`.source-archive/${directory}`)).filter(n=>n.endsWith('.json')&&(!selected||n===selected+'.json'))){
  const bundle=JSON.parse(await readFile(`.source-archive/${directory}/${name}`,'utf8'));
  const source=check(await admin.from('source_documents').select('id,owner_id,sha256,page_count').eq('id',bundle.sourceDocumentId).eq('owner_id',owner).single());
  if(source.sha256!==bundle.sourceSha256||source.page_count!==bundle.totalPages)throw new Error('Original PDF identity mismatch');
  for(let offset=0;offset<bundle.items.length;offset+=100){
   const items=bundle.items.slice(offset,offset+100);
   const hash=createHash('sha256').update(JSON.stringify([source.id,bundle.parserVersion,items.map(i=>i.payload.candidate_fingerprint)])).digest('hex');
   const idempotencyKey=`${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;
   const result=await request(`/api/source-documents/${source.id}/candidates`,{parser:bundle.parser,parserVersion:bundle.parserVersion,totalPages:bundle.totalPages,parsedPages:bundle.parsedPages,sourceSha256:bundle.sourceSha256,idempotencyKey,items});imported+=result.inserted;
  }
  if(directory==='verified-bundles'){
   const publishIds=[];
   for(const item of bundle.items){
    if(item.payload.reviewed_against_pdf!==true||item.payload.extraction_issues.length)throw new Error('Unverified item cannot be published');
    const candidate=check(await admin.from('source_review_candidates').select('id,status,payload').eq('document_id',source.id).eq('owner_id',owner).eq('fingerprint',item.payload.candidate_fingerprint).single());
    if(candidate.status!=='published' && candidate.payload.reviewed_against_pdf!==true){
      const response=await fetch(base+'/api/source-review',{method:'PATCH',headers:{authorization:`Bearer ${session.access_token}`,'content-type':'application/json'},body:JSON.stringify({candidateId:candidate.id,action:'save',payload:item.payload})});
      if(!response.ok)throw new Error('Verified review save failed');
    }
    publishIds.push(candidate.id);
   }
   for(let i=0;i<publishIds.length;i+=20){const result=await request('/api/source-review/batch',{ids:publishIds.slice(i,i+20),shared:true});published+=result.published;pending+=result.remaining;if(result.remaining)console.log(JSON.stringify(result));}
  }
  console.log(`${source.id}: ${bundle.items.length} ${directory==='verified-bundles'?'verified':'pending'} candidates imported`);
 }
 if(process.argv.includes('--publish-existing')){
   const rows=check(await admin.from('source_review_candidates').select('id').eq('owner_id',owner).eq('status','published').not('published_material_id','is',null));
   for(let i=0;i<rows.length;i+=20){const result=await request('/api/source-review/batch',{ids:rows.slice(i,i+20).map(r=>r.id),shared:true});published+=result.published;pending+=result.remaining;console.log(JSON.stringify(result));}
 }
 console.log(JSON.stringify({imported,published,pending}));
}finally{if(session)await normal.auth.signOut({scope:'local'});}
