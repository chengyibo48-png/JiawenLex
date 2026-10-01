import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
// Rebind only to a separately obtained actual archive catalog. Never create UUIDs.
const [stageArg,catalogArg]=process.argv.slice(2);
if(!stageArg||!catalogArg)throw Error('Usage: node scripts/source-listening-bind.mjs <stage-directory> <actual-source-catalog.json>');
const root=resolve(stageArg),raw=JSON.parse(await readFile(resolve(catalogArg),'utf8'));
const catalog=Array.isArray(raw)?raw:raw.documents;
if(!Array.isArray(catalog))throw Error('Actual catalog must contain documents');
const bySha=new Map();for(const d of catalog){if(!/^[0-9a-f]{64}$/.test(d.sha256)||!(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(d.id)))throw Error('Invalid source identity');if(bySha.has(d.sha256))throw Error('Ambiguous duplicate archive SHA');bySha.set(d.sha256,d);}
await mkdir(join(root,'import-ready'),{recursive:true});let bundles=0;
for(const name of await readdir(join(root,'native'))){if(!/^book-\d+\.json$/.test(name))continue;const book=JSON.parse(await readFile(join(root,'native',name),'utf8'));const source=bySha.get(book.sourceSha256);if(!source||source.status!=='ready'||source.page_count!==book.totalPages)continue;
 const fulltext=JSON.parse(await readFile(join(root,'fulltext',source.sha256+'.json'),'utf8'));const textByPage=new Map(fulltext.pages.map(p=>[p.physicalPage,p.text]));
 const ref=r=>{const d=bySha.get(r.source_sha256);if(!d||d.owner_id!==source.owner_id||r.physical_page<1||r.physical_page>d.page_count)throw Error('Source reference ownership/page mismatch');return{document_id:d.id,physical_page:r.physical_page,role:r.role};};
 const items=book.groups.filter(g=>g.questions.length).map(g=>({physicalPage:g.source_refs[0].physical_page,printedPage:'',sectionTitle:g.title,contentKind:'question',payload:{title:g.title,prompt:g.prompt,skill:g.skill,track:g.track,origin_kind:g.origin_kind,questionType:'listening',passage:'',transcript:'',tags:['listening','资料原题'],questions:g.questions.map(q=>({...q,type:q.type??q.answer_mode,source_document_id:source.id,source_refs:q.source_refs.map(ref),source_printed_page:'',verified:false})),source_refs:g.source_refs.map(ref),reviewed_against_pdf:false,answer_alignment_checked:false,extraction_issues:g.extraction_issues,ai_additions:[],evidence:g.source_refs.filter(r=>textByPage.get(r.physical_page)?.trim()).map(r=>({physical_page:r.physical_page,locator:r.locator,excerpt:textByPage.get(r.physical_page),role:'question'})),candidate_fingerprint:g.fingerprint,local_audio_dependency:g.audio,publication_note:'待核对题目、答案、录音内容；本机音频路径不能作为已上传附件。'}}));
 if(!items.length)continue;
 await writeFile(join(root,'import-ready',source.sha256+'.json'),JSON.stringify({format:'jiawenlex-mineru-v1',parser:'MinerU',parserVersion:'standard+native-listening-staging-v1',sourceDocumentId:source.id,sourceSha256:source.sha256,totalPages:book.totalPages,parsedPages:book.parsedPages,extractionPages:[...new Set(items.flatMap(i=>[...i.payload.source_refs,...i.payload.questions.flatMap(q=>q.source_refs)].map(r=>r.physical_page)))],items},null,2));bundles++;
}
console.log(JSON.stringify({bundles,mode:'local_only',publicationAllowed:false}));
