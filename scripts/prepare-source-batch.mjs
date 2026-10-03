import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
// Offline only: no database client, credentials, network, publication or version changes.
const base = resolve(process.argv[2] ?? '.source-archive/cambridge-reading-20261002');
const inventory = JSON.parse(await readFile(join(base, 'inventory.json'), 'utf8'));
const output = join(base, 'drafts'); await mkdir(output, { recursive:true });
const canonical = value => value.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const totals = {documents:0,guides:0,vocabulary:0,adaptedGroups:0,adaptedQuestions:0};
const words = new Map();
const known = new Set(await readdir(join(base,'fulltext')));
for (const file of inventory.unique.filter(file => file.inRequestedScope && file.kind === 'office_ole')) {
  if (!known.has(`${file.sha256}.json`)) continue;
  const parsed = JSON.parse(await readFile(join(base,'fulltext',`${file.sha256}.json`),'utf8'));
  if(parsed.truncated) continue;
  const text = parsed.content;
  const locator = `doc:${file.sha256.slice(0,7)}/tier:flash/page:1`;
  const evidence = (excerpt,role) => ({physical_page:1,locator,excerpt,role});
  const common = { reviewed_against_pdf:false, extraction_issues:['尚未对照源文档完成逐项核验','DOC 页号为解析器虚拟页，需关联归档 PDF 实际页码'], ai_additions:[] };
  const body = text.replace(/<!--[^>]*-->/g,'').replace(/!\[Image block\]\([^)]+\)/g,'').replace(/^同学，想查看[^\n]+\n/gm,'').trim();
  const items = [{physicalPage:1,printedPage:'',sectionTitle:file.name,contentKind:'note',payload:{...common,title:file.name.replace(/\.doc$/i,''),body,category:'writing_method',skill_tags:['writing','speaking'],evidence:[evidence(text,'passage')]}}];
  totals.guides++;
  // Only extract explicitly presented short English list lines, never prose comma fragments.
  for(const match of text.matchAll(/!\[Image block\]\([^)]+\)\s*\n\s*\n([^\n]+)/g)) {
    const line = match[1].trim();
    if(line.length>600 || /[\u3400-\u9fff.!?]/u.test(line) || !/[,，]/.test(line)) continue;
    for(const phrase of line.split(/[,，]/).map(s=>s.trim())) {
      if(!/^[a-zA-Z][a-zA-Z\s/'’()&-]+$/.test(phrase) || phrase.length>100 || phrase.split(/\s+/).length>10) continue;
      const key=canonical(phrase),item={physicalPage:1,printedPage:'',sectionTitle:file.name,contentKind:'vocabulary',payload:{...common,term:phrase,part_of_speech:'',pronunciation:'',definition:'',example:'',selection_origin:'source_list',tags:['写作词伙','观点库',file.name.match(/话题\d+/)?.[0]??''],evidence:[evidence(line,'vocabulary')],extraction_issues:[...common.extraction_issues,'原词伙未提供逐项中文释义','逗号与斜线表达边界需核验']}};
      if(!words.has(key)) words.set(key,{term:phrase,evidence:[]});
      words.get(key).evidence.push({sourceSha256:file.sha256,...evidence(line,'vocabulary')});
      if(!items.some(i=>i.contentKind==='vocabulary'&&canonical(i.payload.term)===key)){items.push(item);totals.vocabulary++;}
    }
  }
  // Translation is adapted training, not an original IELTS examination task.
  const paragraphs=text.split(/\n\s*\n/); let chinese='';const questions=[];
  for(const paragraph of paragraphs){
    const clean=paragraph.trim();
    if(/^\d+\./.test(clean)&&/[\u3400-\u9fff]/u.test(clean)){chinese=clean;continue;}
    if(chinese && /^[A-Z]/.test(clean) && clean.length>180 && clean.length<=4000 && /[.!?]/.test(clean) && !/[\u3400-\u9fff]/u.test(clean)){
      questions.push({id:`adapted-${questions.length+1}`,type:'Translation',prompt:`将以下观点写成英文段落：\n${chinese}`,origin_kind:'adapted',answer_mode:'open',answers:[],reference_answers:[clean],explanation:'资料中的英文表达仅作为参考，不按字符串判分。',source_refs:[{document_sha256:file.sha256,physical_page:1,role:'question'},{document_sha256:file.sha256,physical_page:1,role:'answer'}],verified:false,requires_figure:false,evidence:[evidence(chinese,'question'),evidence(clean,'answer')]});chinese='';
    }
  }
  if(questions.length){items.push({physicalPage:1,printedPage:'',sectionTitle:file.name,contentKind:'question',payload:{...common,title:`改编翻译训练 · ${file.name.replace(/\.doc$/i,'')}`,prompt:'根据资料观点进行英文表达训练；原文参考不代表唯一正确答案。',skill:'writing',track:'academic',origin_kind:'adapted',questionType:'Translation',passage:'',transcript:'',questions,tags:['改编练习','观点表达'],reviewed_against_pdf:false,answer_alignment_checked:false,evidence:questions.flatMap(q=>q.evidence),extraction_issues:[...common.extraction_issues,'需核对中文观点与英文参考的段落配对及源文语言质量','未绑定真实归档文档 UUID']}});totals.adaptedGroups++;totals.adaptedQuestions+=questions.length;}
  // Deliberately NOT an importable reviewed bundle. Rendering/parsing alone is not inspection.
  const bundle={format:'jiawenlex-unreviewed-draft-v1',sourceSha256:file.sha256,sourcePath:file.path,sourceKind:'doc',totalPages:1,parsedPages:1,extractionPages:[],parser:'MinerU',parserVersion:'4.0.10-office-native',items};
  bundle.localFingerprint=fingerprint(bundle);await writeFile(join(output,`${file.sha256}.json`),JSON.stringify(bundle,null,2));totals.documents++;
}
await writeFile(join(base,'vocabulary-context-index.json'),JSON.stringify([...words.values()],null,2));
await writeFile(join(base,'draft-summary.json'),JSON.stringify({...totals,uniqueVocabularyTerms:words.size,publicationStatus:'local_unreviewed',notImported:true},null,2));
console.log(JSON.stringify({...totals,uniqueVocabularyTerms:words.size},null,2));
