import { sourceAnswerRows } from "./source-answer-tables.mjs";
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
const base=resolve(process.argv[2]??'.source-archive/cambridge-reading-20261002');
const inventory=JSON.parse(await readFile(join(base,'inventory.json'),'utf8'));
const out=join(base,'reading-drafts');await mkdir(out,{recursive:true});const known=new Set(await readdir(join(base,'fulltext')));
const clean=s=>s.replace(/\*\*/g,'').replace(/&amp;/g,'&').trim();
const report=[];
for(const file of inventory.unique.filter(f=>f.inRequestedScope&&f.classification==='reading')){
 if(!known.has(`${file.sha256}.json`))continue;
 const parsed=JSON.parse(await readFile(join(base,'fulltext',`${file.sha256}.json`),'utf8'));if(parsed.truncated)continue;
 const pieces=parsed.content.split(/<!--\s*page (\d+) of (\d+)\s*-->/);const pages=[];
 for(let i=1;i<pieces.length;i+=3)pages.push({page:Number(pieces[i]),total:Number(pieces[i+1]),text:pieces[i+2].trim()});
 const questionHeading=/^(?:#{1,6}\s*)?\*{0,2}Questions\s+\d+\s*[–-]\s*\d+[^\n]*$/im;
 const answerPages=new Set(pages.filter(p=>/\|\s*(?:题号|#|Box|Question|No\.?)\s*\|[^\n]*(?:答案|Answer)/i.test(p.text)||/^\s*\d{1,2}\.\s*[A-Z]+\s+\d{1,2}\./m.test(p.text)).map(p=>p.page));
 const bodies=pages.filter(p=>!answerPages.has(p.page));
 const firstQuestion=bodies.find(p=>questionHeading.test(p.text));
 const firstHeadingIndex=firstQuestion?.text.search(questionHeading)??-1;
 const passagePages=bodies.filter(p=>!firstQuestion||p.page<firstQuestion.page);
 const passageParts=passagePages.map(p=>p.text);
 if(firstQuestion&&firstHeadingIndex>0){passageParts.push(firstQuestion.text.slice(0,firstHeadingIndex));passagePages.push(firstQuestion);}
 const passage=passageParts.join('\n\n');
 const expected=parsed.content.match(/Questions\s+\*{0,2}(\d+)\s*[–-]\s*(\d+)\*{0,2}[^\n]*which are based/i);
 const range=expected?[Number(expected[1]),Number(expected[2])]:null;
 const answers=new Map();
 for(const page of pages.filter(p=>answerPages.has(p.page))){
  for(const [id, answer] of sourceAnswerRows(page.text)) answers.set(id,{...answer,page:page.page});
  for(const m of page.text.matchAll(/(?:^|\s)(\d{1,2})\.\s*([^\n]+?)(?=\s+\d{1,2}\.\s|$)/gm))if(m[2].trim().length<=100)answers.set(m[1],{value:m[2].trim(),explanation:'',page:page.page,excerpt:m[0]});
 }
 const questions=[],seen=new Set();
 const evidence=(page,excerpt,role,id)=>({physical_page:page,locator:`doc:${file.sha256.slice(0,7)}/tier:standard/page:${page}`,excerpt,role,...(id?{question_id:id}:{})});
 const refs=(page,role)=>({document_sha256:file.sha256,physical_page:page,role});
 for(const page of bodies.filter(p=>firstQuestion&&p.page>=firstQuestion.page)){
  const source=page.page===firstQuestion.page?page.text.slice(firstHeadingIndex):page.text;
  const matches=[...source.matchAll(/^(?:\*\*)?(\d{1,2})(?:\*\*)?[.\s]+([^\n]+)/gm)];
  for(let k=0;k<matches.length;k++){
   const m=matches[k],id=m[1],n=Number(id);if(seen.has(id)||range&&(n<range[0]||n>range[1]))continue;
   const rawPrompt=source.slice(m.index,matches[k+1]?.index??source.length).trim();const nextGroup=rawPrompt.search(questionHeading);const prompt=(nextGroup>=0?rawPrompt.slice(0,nextGroup):rawPrompt).trim();if(prompt.length>4000)continue;
   const a=answers.get(id);let value=a?.value??'';const judgment=/^(TRUE|FALSE|NOT GIVEN|YES|NO|NG|T|F)$/i.test(value);
   if(judgment)value=({NG:'NOT GIVEN',T:'TRUE',F:'FALSE'})[value.toUpperCase()]??value.toUpperCase();
   const yesNo=/\bYES\b/i.test(source)&&/\bNO\b/i.test(source), trueFalse=/\bTRUE\b/i.test(source)&&/\bFALSE\b/i.test(source);
   const choices=judgment?(yesNo&&!trueFalse?['YES','NO','NOT GIVEN']:trueFalse&&!yesNo?['TRUE','FALSE','NOT GIVEN']:undefined):undefined;
   const q={id,type:judgment?'Judgment':'Source text response',prompt:clean(prompt),origin_kind:'source',answer_mode:choices?'single_choice':'text',...(choices?{choices}:{}),answers:value?[value]:[],explanation:a?.explanation??'',source_physical_page:page.page,source_printed_page:'',verified:false,requires_figure:false,source_refs:[refs(page.page,'question'),...passagePages.map(p=>refs(p.page,'passage')),...(a?[refs(a.page,'answer')]:[])],evidence:[evidence(page.page,prompt,'question'),...(a?[evidence(a.page,a.excerpt,'answer',id)]:[])]};
   questions.push(q);seen.add(id);
  }
 }

 // Notes/summary blanks often appear inside a sentence, not at the start of a line.
 // Use explicit question-group ranges; never reinterpret article dates as question IDs.
 for(const page of bodies.filter(p=>firstQuestion&&p.page>=firstQuestion.page)){
  const groups=[...page.text.matchAll(/^(?:#{1,6}\s*)?\*{0,2}Questions\s+(\d+)\s*[–-]\s*(\d+)[^\n]*$/gim)];
  for(let g=0;g<groups.length;g++){
   const group=groups[g],section=page.text.slice(group.index+group[0].length,groups[g+1]?.index??page.text.length);
   if(/Choose\s+(?:\*{0,2})?(?:TWO|THREE|FOUR)\s+(?:\*{0,2})?(?:letters|answers)/i.test(section))continue;
   const limit=section.match(/(?:Choose|Write)\s+\*{0,2}(?:NO MORE THAN|ONE WORD|TWO WORDS)[^\n]+/i)?.[0];
   for(let n=Number(group[1]);n<=Number(group[2]);n++){
    const id=String(n);if(seen.has(id))continue;
    const marker=new RegExp(`(?<![a-zA-Z0-9])${id}(?![a-zA-Z0-9])`);
    const block=section.split(/\n\s*\n/).find(b=>marker.test(b)&&/[a-zA-Z]/.test(b)&&!/^(?:#{1,6}|Choose|Write|Complete|In boxes|Look at|Reading Passage|Questions)\b/i.test(b.trim())&&!b.trim().startsWith('#'));
    if(!block||block.length>4000)continue;
    const a=answers.get(id);
    questions.push({id,type:'Notes / summary response',prompt:clean(block),origin_kind:'source',answer_mode:'text',answers:a?[a.value]:[],explanation:a?.explanation??'',...(limit?{answer_limit_text:clean(limit)}:{}),source_physical_page:page.page,source_printed_page:'',verified:false,requires_figure:false,source_refs:[refs(page.page,'question'),...passagePages.map(p=>refs(p.page,'passage')),...(a?[refs(a.page,'answer')]:[])],evidence:[evidence(page.page,block,'question'),...(a?[evidence(a.page,a.excerpt,'answer',id)]:[])]});seen.add(id);
   }
  }
 }
 questions.sort((a,b)=>Number(a.id)-Number(b.id));
 const missing=range?Array.from({length:range[1]-range[0]+1},(_,i)=>String(range[0]+i)).filter(id=>!seen.has(id)):[];
 const issues=['尚未对照原页核验题干、答案及选项','真实归档文档 UUID 未绑定'];if(missing.length)issues.push(`待补原题号：${missing.join(', ')}`);if(!passage.trim())issues.push('完整文章边界需核验');if(!questions.length)issues.push('尚未提取完整题干：不可把文章改名冒充原题');
 const content={format:'jiawenlex-unreviewed-draft-v1',sourceSha256:file.sha256,sourcePath:file.path,parser:'MinerU',parserVersion:'4.0.10-standard+structured-draft',totalPages:pages[0]?.total,parsedPages:pages.length,extractionPages:[],skill:'reading',origin_kind:'source',title:file.name,passage,questions,expectedQuestionRange:range,missingQuestionNumbers:missing,sourcePages:pages.map(p=>({physicalPage:p.page,role:answerPages.has(p.page)?'answer':firstQuestion&&p.page>=firstQuestion.page?'question':'passage',content:p.text})),reviewed_against_pdf:false,answer_alignment_checked:false,extraction_issues:issues};
 await writeFile(join(out,`${file.sha256}.json`),JSON.stringify(content,null,2));report.push({sourceSha256:file.sha256,name:file.name,questions:questions.length,missing,needsReview:true});
}
await writeFile(join(base,'reading-draft-summary.json'),JSON.stringify({files:report.length,questions:report.reduce((n,r)=>n+r.questions,0),report},null,2));console.log(JSON.stringify({files:report.length,questions:report.reduce((n,r)=>n+r.questions,0),notPublished:true}));
