import { readFile,writeFile,mkdir,readdir } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { createHash } from 'node:crypto';
// Offline only: no database, network, credentials, or publication side effects.
const root=resolve(process.argv[2]??'.source-archive/listening-20261001');
const inventory=JSON.parse(await readFile(join(root,'inventory.json'),'utf8'));
await mkdir(join(root,'native'),{recursive:true});
const hash=s=>createHash('sha256').update(s).digest('hex');
const clean=s=>s.replace(/<[^>]+>/g,' ').replace(/\$([^$]+)\$/g,'$1').replace(/\\([_$])/g,'$1').replace(/\s+/g,' ').trim();
const summary=[];
for(const name of await readdir(join(root,'fulltext'))){
 const doc=JSON.parse(await readFile(join(root,'fulltext',name),'utf8'));const source=inventory.pdfs.find(f=>f.sha256===doc.sha256);const book=Number(source?.name.match(/【听力(\d+)】/)?.[1]);if(!book)continue;
 const spans=[];let combined='';for(const p of doc.pages){const start=combined.length;combined+=p.text+'\n';spans.push({start,end:combined.length,...p});}
 const pageAt=i=>spans.find(p=>p.start<=i&&i<p.end)??spans.at(-1);
 const refs=(first,last,role)=>spans.filter(p=>p.end>first&&p.start<last).map(p=>({source_sha256:doc.sha256,physical_page:p.physicalPage,locator:p.locator,role}));
 const headings=[...combined.matchAll(/^(?:#{1,6}\s*)?(?:SECTION|PART)\s*([1-4])\s*[,.:]?\s*Questions?\s*(\d+)\s*[-–—]\s*(\d+)/gmi)];
 const keyPages=doc.pages.filter(p=>/^(?:#{1,6}\s*)?Answer\s*Keys\s*$/im.test(p.text) && /(?:^|\n)\s*(?:#+\s*)?TEST\s*\d+\b/i.test(p.text));const firstKey=keyPages[0]?.physicalPage??Infinity;
 const keys=new Map();
 for(const p of doc.pages.filter(p=>p.physicalPage>=firstKey)){
  const test=Number(p.text.match(/(?:^|\n)\s*(?:#+\s*)?TEST\s*(\d+)\b/i)?.[1]);if(!test)continue;
  const add=(id,answer,excerpt)=>{id=Number(id);answer=clean(answer);if(id<1||id>40||!answer)return;const k=`${test}:${id}`;const v={answer,physicalPage:p.physicalPage,locator:p.locator,excerpt};const prior=keys.get(k);if(prior&&prior.answer!==answer){prior.conflict=true;prior.alternatives??=[];prior.alternatives.push(v);}else if(!prior)keys.set(k,v);};
  for(const row of p.text.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)){const cells=[...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(x=>clean(x[1]));for(let i=0;i+1<cells.length;i+=2)if(/^\d{1,2}$/.test(cells[i]))add(cells[i],cells[i+1],row[0]);}
  for(const line of p.text.split('\n')){if(line.trim().startsWith('|')){const cells=line.split('|').slice(1,-1).map(clean);for(let i=0;i+1<cells.length;i+=2)if(/^\d{1,2}$/.test(cells[i]))add(cells[i],cells[i+1],line);}else{const m=line.match(/^\s*(\d{1,2})\s+([^\n]+)$/);if(m)add(m[1],m[2],line);}}
 }
 // Supplement omitted key rows from numbered explanations, keeping conflicts pending.
 let analysisTest=0;
 for(const p of doc.pages.filter(p=>p.physicalPage<firstKey)){
  const heading=p.text.match(/(?:^|\n)\s*(?:#+\s*)?TEST\s*([1-6])\s*(?:\n|$)/i) ?? p.text.match(/听力原文及真题解析[·•]?\s*Test\s*([1-6])\b/i);if(heading)analysisTest=Number(heading[1]);
  if(!analysisTest)continue;
  for(const m of p.text.matchAll(/^(?:#+\s*)?(?:Question\s+(\d{1,2})\s+(?:答案\s*)?|(\d{1,2})\s*答案\s*)([^\n]+)/gmi)){
   const id=Number(m[1]??m[2]),answer=clean(m[3]);if(id<1||id>40||!answer)continue;const k=analysisTest+':'+id;
   const v={answer,physicalPage:p.physicalPage,locator:p.locator,excerpt:m[0],source:'numbered_explanation'};
   const prior=keys.get(k);if(!prior)keys.set(k,v);else if(prior.answer.toLowerCase().replace(/\s+/g,'')!==answer.toLowerCase().replace(/\s+/g,'')){prior.conflict=true;prior.alternatives??=[];prior.alternatives.push(v);}
  }
 }
 let test=0;const groups=[];const boundary=combined.search(/^(?:#+\s*)?TEST\s*1\s*\n\s*\n(?:#+\s*)?(?:SECTION|PART)\s*1\s*\n/gmi);
 const usable=headings.filter(h=>pageAt(h.index).physicalPage<firstKey && (boundary<0||h.index<boundary));
 for(let g=0;g<usable.length;g++){
  const h=usable[g],section=Number(h[1]),first=Number(h[2]),last=Number(h[3]);if(section===1)test++;if(test<1||test>6)continue;
  const next=usable[g+1]?.index??(boundary>h.index?boundary:combined.length);const text=combined.slice(h.index,next).trim();
  const sourcePages=refs(h.index,next,'question');const issues=[];const audio=inventory.audio.filter(a=>a.book===book&&a.test===test&&a.section===section);
  if(audio.length!==1)issues.push(audio.length?'multiple_audio_matches':'missing_audio');else issues.push('audio_content_pairing_unverified');
  if(last-first!==9)issues.push('unexpected_section_question_range');
  const questions=[];
  // Preserve numbering and full section context; never invent a missing prompt.
  for(let id=first;id<=last;id++){
   const marker=new RegExp(`(?:^|\\n|\\|)[ \\t]*(?:[-*•]\\s*)?${id}(?=[ \\t]+[A-Za-z])|(?<!\\d)${id}(?=[ \\t]*[.\\\\_．…]{2,})`,'gm');
   const found=[...text.matchAll(marker)].filter(m=>!/^\s*(?:Questions?|SECTION|PART)/i.test(text.slice(Math.max(0,text.lastIndexOf('\n',m.index)),m.index)));
   if(!found.length){issues.push('question_marker_missing:'+id);continue;}
   if(found.length>1){issues.push('question_marker_ambiguous:'+id);continue;}
   const m=found[0],offset=m.index;const lineStart=text.lastIndexOf('\n',offset)+1;let end=text.indexOf('\n\n',offset);if(end<0)end=text.length;
   let body=text.slice(lineStart,end).trim();
   const nextNumber=body.search(new RegExp(`(?:\\n|\\s)${id+1}\\s+(?=[A-Za-z])`));if(nextNumber>=0)body=body.slice(0,nextNumber).trim();
   const choiceHits=[...body.matchAll(/(?:^|\s)([A-H])\s+(?=[A-Za-z$\\])/g)];const choices=[];
   if(choiceHits.length>=2){for(let c=0;c<choiceHits.length;c++){const start=choiceHits[c].index;const stop=choiceHits[c+1]?.index??body.length;choices.push(clean(body.slice(start,stop)));}}
   const key=keys.get(`${test}:${id}`);const answer_mode=choices.length>=2?'single_choice':'text';let answers=[];const qi=[];
   if(!key)qi.push('source_answer_missing');else if(key.conflict)qi.push('answer_key_conflict');else if(answer_mode==='single_choice'){const match=choices.find(c=>c.startsWith(key.answer+'. ')||c.startsWith(key.answer+' '));if(match)answers=[match];else qi.push('answer_option_alignment_pending');}else if(/^[A-H]$/.test(key.answer)){qi.push('shared_choices_or_matching_structure_pending');}else answers=[key.answer];
   const limits=[...text.slice(0,offset).matchAll(/(?:Write\s+)?NO MORE THAN[^\n]+/gi)];const answerLimit=limits.at(-1)?.[0]?.trim()??'';
   const absolute=h.index+offset;const p=pageAt(absolute);questions.push({id:String(id),prompt:body,answer_limit_text:answerLimit,origin_kind:'source',answer_mode,choices,answers,reference_answers:[],source_sha256:doc.sha256,source_physical_page:p.physicalPage,source_refs:[{source_sha256:doc.sha256,physical_page:p.physicalPage,role:'question'},...(key?[{source_sha256:doc.sha256,physical_page:key.physicalPage,role:'answer'}]:[])],verified:false,extraction_issues:qi,evidence:[{physical_page:p.physicalPage,locator:p.locator,excerpt:body,role:'question'},...(key?[{physical_page:key.physicalPage,locator:key.locator,excerpt:key.excerpt,role:'answer',question_id:String(id)}]:[])]});
  }
  if(/Choose\s+(?:TWO|THREE|FOUR|FIVE)\s+(?:letters|answers)/i.test(text))issues.push('multi_choice_group_requires_set_alignment');
  if(/!\[.*?\]\(|<img\b|label.*(?:map|plan|diagram)/i.test(text))issues.push('figure_or_image_block_needs_original_page_review');
  if(text.length>20000||/(If you have a problem\?){2}/i.test(text))issues.push('ocr_repetition_or_length_anomaly');
  groups.push({fingerprint:hash(`${doc.sha256}:test:${test}:section:${section}`),title:`九分达人听力${book} · Test ${test} · Section ${section}`,skill:'listening',track:'academic',origin_kind:'source',test,section,sourceSha256:doc.sha256,questionRange:[first,last],prompt:text,questions,source_refs:sourcePages,audio:audio.length===1?{sha256:audio[0].sha256,localPath:audio[0].path,pairingStatus:'filename_only_unverified'}:null,reviewed_against_pdf:false,answer_alignment_checked:false,extraction_issues:[...new Set(issues)],publicationStatus:'pending_review_and_source_binding'});
 }
 const words=new Map();
 for(const [k,key] of keys){if(key.conflict||!/^[A-Za-z][A-Za-z’' -]{2,65}$/.test(key.answer)||key.answer.split(' ').length>5)continue;const term=key.answer;const fingerprint=hash(`${doc.sha256}:answer-vocabulary:${term.toLowerCase()}`);if(!words.has(fingerprint))words.set(fingerprint,{physicalPage:key.physicalPage,printedPage:'',sectionTitle:`听力${book}答案词汇`,contentKind:'vocabulary',payload:{term,part_of_speech:'',pronunciation:'',definition:'',example:'',selection_origin:'passage_selection',tags:['listening','答案词汇','需补释义'],reviewed_against_pdf:false,evidence:[{physical_page:key.physicalPage,locator:key.locator,excerpt:key.excerpt,role:'vocabulary'}],extraction_issues:['答案词汇选编；需排除专有名称并核对释义，不宣称必考或高频'],ai_additions:[],candidate_fingerprint:fingerprint}});}
 const coverage=doc.pages.map(p=>({physicalPage:p.physicalPage,parserStatus:'parsed',reviewStatus:'unreviewed',groupFingerprints:groups.filter(g=>g.source_refs.some(r=>r.physical_page===p.physicalPage)).map(g=>g.fingerprint),issues:[...(p.text.includes('If you have a problem?')?['ocr_repetition']:[]),...(!p.text.trim()?['empty_ocr_page_requires_inspection']:[])]}));
 await writeFile(join(root,'native',`book-${book}.json`),JSON.stringify({format:'jiawenlex-native-staging-v1',sourceSha256:doc.sha256,totalPages:doc.totalPages,parsedPages:doc.parsedPages,groups,coverage},null,2));
 if(words.size)await writeFile(join(root,'native',`vocabulary-${book}.json`),JSON.stringify({format:'jiawenlex-mineru-v1',sourceSha256:doc.sha256,parser:'MinerU',parserVersion:'standard+listening-answer-selection-v1',totalPages:doc.totalPages,parsedPages:doc.parsedPages,extractionPages:[...new Set([...words.values()].map(w=>w.physicalPage))],items:[...words.values()]},null,2));
 summary.push({book,pages:doc.totalPages,sections:groups.length,nativeQuestionCandidates:groups.reduce((n,g)=>n+g.questions.length,0),missingQuestionNumbers:groups.reduce((n,g)=>n+g.extraction_issues.filter(i=>i.startsWith('question_marker_missing')).length,0),answerEntries:keys.size,vocabularyCandidates:words.size,ocrAnomalyPages:coverage.filter(p=>p.issues.length).map(p=>p.physicalPage)});
}
await writeFile(join(root,'extraction-summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
