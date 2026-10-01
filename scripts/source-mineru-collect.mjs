import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile),root='.source-archive/listening-20261001';
const inventory=JSON.parse(await readFile(root+'/inventory.json','utf8'));
await mkdir(root+'/fulltext',{recursive:true});
const call=async args=>JSON.parse((await run('mineru',args,{windowsHide:true,maxBuffer:20e6,timeout:60000})).stdout);
const completed=new Set();
for(const f of inventory.pdfs){try{const d=JSON.parse(await readFile(root+'/fulltext/'+f.sha256+'.json','utf8'));const total=Number(f.parse.page_range.split('-').at(-1));if(d.sha256===f.sha256&&d.totalPages===total&&d.pages.length===total&&d.pages.every((p,i)=>p.physicalPage===i+1))completed.add(f.sha256);}catch(e){if(e.code!=='ENOENT')throw e;}}
console.log('Verified cached documents: '+completed.size);
for(let attempt=0;attempt<40&&completed.size<inventory.pdfs.length;attempt++){
 const statuses=(await call(['list','parses','--tier','standard','--limit','1000','--json'])).parses;
 const progress=[];
 for(const f of inventory.pdfs){
  if(completed.has(f.sha256))continue;
  const p=statuses.find(p=>p.sha256===f.sha256&&p.page_range===f.parse.page_range);
  progress.push({name:f.name,status:p?.status??'missing',error:p?.error_code??null});
  if(p?.status!=='done')continue;
  const total=Number(f.parse.page_range.split('-').at(-1));const pages=new Map();
  for(let first=1;first<=total;first+=15){
   const last=Math.min(first+14,total),center=Math.floor((first+last)/2);
   const r=await call(['read',`doc:${p.short_id}/tier:standard/page:${center}`,'--context','7','--limit','1000000','--json']);
   if(r.sha256!==f.sha256||r.tier!=='standard'||r.truncated)throw Error('Identity or coverage failure '+f.name);
   const markers=[...r.content.matchAll(/<!--\s*page\s+(\d+)\s+of\s+(\d+)\s*-->/g)];
   for(let n=0;n<markers.length;n++){const page=Number(markers[n][1]);if(Number(markers[n][2])!==total)throw Error('Page count mismatch');pages.set(page,{physicalPage:page,locator:`doc:${p.short_id}/tier:standard/page:${page}`,text:r.content.slice(markers[n].index+markers[n][0].length,markers[n+1]?.index??r.content.length).trim()});}
  }
  if(pages.size!==total)throw Error(`Missing physical pages ${f.name}: ${pages.size}/${total}`);
  await writeFile(root+'/fulltext/'+f.sha256+'.json',JSON.stringify({name:f.name,sha256:f.sha256,totalPages:total,parsedPages:pages.size,pages:[...pages.values()].sort((a,b)=>a.physicalPage-b.physicalPage)},null,2));
  completed.add(f.sha256);console.log('Full text cached: '+f.name+' '+total+'/'+total);
 }
 await writeFile(root+'/parse-progress.json',JSON.stringify({at:new Date().toISOString(),completed:[...completed],progress},null,2));
 if(completed.size===inventory.pdfs.length)break;
 if(attempt===39)throw Error('Parsing still pending; restart this collector to resume without reparsing');
 await new Promise(r=>setTimeout(r,30000));
}
