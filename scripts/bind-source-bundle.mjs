import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
// Bind already reviewed local content to actual archived document identities.
// No network, database mutation, inferred IDs, review-flag upgrades or publication.
const [input,mapPath,output] = process.argv.slice(2);
if (!input || !mapPath || !output || resolve(input) === resolve(output)) throw new Error('Usage: node scripts/bind-source-bundle.mjs <reviewed-bundle> <document-map.json> <new-output>');
const bundle=JSON.parse(await readFile(resolve(input),'utf8'));
if(bundle.format !== 'jiawenlex-mineru-v1') throw new Error('Only reviewed MinerU bundles can be bound; unreviewed drafts require inspection first.');
const records=JSON.parse(await readFile(resolve(mapPath),'utf8'));
if(!Array.isArray(records))throw new Error('Document map must be actual archive records [{id,sha256,status,page_count}].');
const ids=new Map();
for(const doc of records){
 if(!/^[0-9a-f]{64}$/.test(doc.sha256??'') || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(doc.id??''))throw new Error('Invalid archive identity');
 if(doc.status!=='ready')continue;
 if(ids.has(doc.sha256)&&ids.get(doc.sha256).id!==doc.id)throw new Error('Ambiguous document SHA-256; select an owner-scoped archive record.');
 ids.set(doc.sha256,doc);
}
const primary=ids.get(bundle.sourceSha256);
if(!primary||primary.page_count!==bundle.totalPages)throw new Error('Primary archived SHA-256/page count mismatch or document not ready.');
if(bundle.sourceDocumentId&&bundle.sourceDocumentId!==primary.id)throw new Error('Primary archived document ID mismatch');
bundle.sourceDocumentId=primary.id;
function bind(value){
 if(!value||typeof value!=='object')return;
 if(value.document_sha256){
  const doc=ids.get(value.document_sha256);
  if(!doc||!Number.isInteger(value.physical_page)||value.physical_page<1||value.physical_page>doc.page_count)throw new Error('Missing dependency document or invalid source page');
  if(value.document_id&&value.document_id!==doc.id)throw new Error('Conflicting source reference');
  value.document_id=doc.id;delete value.document_sha256;
 }
 for(const child of Object.values(value)){if(Array.isArray(child))child.forEach(bind);else bind(child);}
}
bind(bundle);
for(const item of bundle.items){
 if(item.contentKind==='question')for(const q of item.payload.questions){
  const ref=q.source_refs?.find(r=>r.role==='question'&&r.physical_page===q.source_physical_page);
  if(!ref)throw new Error(`Missing primary question reference ${q.id}`);
  if(q.source_document_id&&q.source_document_id!==ref.document_id)throw new Error('Conflicting question source identity');
  q.source_document_id=ref.document_id;
 }
 item.payload.extraction_issues=item.payload.extraction_issues.filter(issue=>issue!=='原文件尚未归档，发布前须按 SHA-256 绑定真实文档 UUID');
}
await writeFile(resolve(output),JSON.stringify(bundle,null,2));
console.log(JSON.stringify({bound:true,sourceDocumentId:primary.id,items:bundle.items.length,publicationPerformed:false}));
