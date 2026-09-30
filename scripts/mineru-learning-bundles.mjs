// Local MinerU cache -> review bundles. Never changes OCR verification flags.
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const root='.source-archive';
const catalog=JSON.parse(await readFile(`${root}/source-catalog.json`,'utf8'));
const parses=JSON.parse(await readFile(`${root}/parse-manifest.json`,'utf8'));
await mkdir(`${root}/learning-bundles`,{recursive:true});
const normalize=s=>s.normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const posPattern=/(?:adj|adv|prep|conj|pron|aux|num|phr|vi|vt|v|n)\s*\./g;
const manifest=[];
for(const doc of catalog.documents){
  const parsed=JSON.parse(await readFile(`${root}/parsed/${doc.sha256}.json`,'utf8'));
  const parse=parses.find(p=>p.id===doc.id);
  if(!parse?.mineruShortId)throw new Error(`Missing MinerU locator: ${doc.title}`);
  const items=[],keys=new Map();
  const vocabularySource=/词汇|词伙|词伙儿|短语|AWL|Idioms|表达|句式|同义|考点词|答案词|阅读500词|学科词/.test(doc.title);
  const category=/计划|规划/.test(doc.title)?'plan':/写作技巧|写作万能|写作的十二|写作.*句式|高分句型/.test(doc.title)?'writing_method':/语法/.test(doc.title)?'grammar':/阅读胜经|阅读胜典|逻辑|理由|模板|衔接语/.test(doc.title)?'answering_strategy':/总结|思路|规律/.test(doc.title)&&!/20\d\d年.*作文/.test(doc.title)?'patterns':null;
  for(const page of parsed.pages){
    const evidence=excerpt=>({physical_page:page.physicalPage,locator:`doc:${parse.mineruShortId}/tier:standard/page:${page.physicalPage}`,excerpt,role:'vocabulary'});
    if(vocabularySource)for(const raw of page.text.split('\n')){
      let line=raw.trim();
      if(!line||line.length>900||/^\s*(?:#|!|<|\d+$)/.test(line))continue;
      if(line.startsWith('|')){
        const cells=line.split('|').slice(1,-1).map(x=>x.trim());
        const english=cells.findIndex(x=>/^[A-Za-z][A-Za-z'’\- ,/()]*$/.test(x)&&x.length>1&&!/^(List|Unit|Part|Topic|English|Words?)$/i.test(x));
        if(english>=0&&/[\u3400-\u9fff]/.test(cells[english+1]??''))line=`${cells[english]} ${cells[english+1]}`;else continue;
      }
      let firstChinese=line.search(/[\u3400-\u9fff]/);
      if(firstChinese>0 && /[（(]/.test(line[firstChinese-1]))firstChinese--;
      if(firstChinese<1)continue;
      let prefix=line.slice(0,firstChinese),definition=line.slice(firstChinese).trim();
      const ipa=prefix.match(/\[([^\]]+)\]/)?.[0]??'';
      prefix=prefix.replace(/\[[^\]]*\]/g,'');
      const poses=[...prefix.matchAll(posPattern)].map(m=>m[0].replace(/\s+/g,''));
      const term=prefix.replace(posPattern,'').replace(/^[\\*\s\d.、)]+/,'').replace(/[：:&；;，,\s]+$/,'').replace(/\s*&\s*$/,'').trim();
      if(!/^[A-Za-z][A-Za-z'’\- ()/]*$/.test(term)||term.length>100||term.split(' ').length>7||definition.length>650)continue;
      const issues=[];
      if(/(?:[a-z]\s+){4,}[a-z]/i.test(term))issues.push('疑似单词被 OCR 拆成多个字母，需核对');
      if(definition.endsWith('，')||definition.endsWith(',')||/\|/.test(definition))issues.push('释义可能截断或跨栏');
      if(/\b(?:adj|adv|vi|vt|prep|conj|pron|aux|num|n|v)\s*\./.test(definition))issues.push('原行含多个词性或词义，需拆分核对');
      if(/\b(?:example|collocation|translation|synonym)\b/i.test(term))continue;
      const pos=poses.join(' & '),key=digest(['word',normalize(term),pos,normalize(definition)]);
      if(keys.has(key)){keys.get(key).payload.evidence.push(evidence(raw));continue;}
      const payload={term,part_of_speech:pos,pronunciation:ipa,definition,example:'',selection_origin:'source_list',tags:[...doc.skill_tags,doc.title],reviewed_against_pdf:false,evidence:[evidence(raw)],extraction_issues:issues,ai_additions:[],candidate_fingerprint:digest([doc.id,key])};
      const item={physicalPage:page.physicalPage,printedPage:'',sectionTitle:doc.title,contentKind:'vocabulary',payload};items.push(item);keys.set(key,item);
    }
    if(category&&page.text.length>150&&!/目录|CONTENTS|版权|ISBN/.test(page.text.slice(0,500))){
      const body=page.text.replace(/!\[[^\]]*\]\([^)]*\)/g,'').trim();
      const heading=(body.match(/^#{1,3}\s+(.{3,100})/m)?.[1]??doc.title).replace(/<[^>]*>/g,'');
      const issues=[];
      if(/\|/.test(body))issues.push('原页含表格，需人工整理为可读笔记');
      if(/\$|<table|\\frac/.test(body))issues.push('原页含公式或复杂布局，需核对');
      items.push({physicalPage:page.physicalPage,printedPage:'',sectionTitle:heading,contentKind:'note',payload:{title:`${heading} · 笔记 ${page.physicalPage}`,category,body:body.slice(0,45000),skill_tags:doc.skill_tags,reviewed_against_pdf:false,evidence:[{...evidence(page.text),role:'passage'}],extraction_issues:issues,ai_additions:[],candidate_fingerprint:digest([doc.id,'guide',page.physicalPage])}});
    }
  }
  const bundle={format:'jiawenlex-mineru-v1',sourceDocumentId:doc.id,sourceSha256:doc.sha256,parser:'MinerU',parserVersion:'standard+english-extract-v1',totalPages:doc.page_count,parsedPages:parsed.pages.length,extractionPages:[],items};
  if(items.length)await writeFile(`${root}/learning-bundles/${doc.sha256}.json`,JSON.stringify(bundle,null,2));
  manifest.push({id:doc.id,title:doc.title,sha256:doc.sha256,skills:doc.skill_tags,parsedPages:parsed.pages.length,totalPages:doc.page_count,words:items.filter(i=>i.contentKind==='vocabulary').length,guides:items.filter(i=>i.contentKind==='note').length,issues:items.filter(i=>i.payload.extraction_issues.length).length,status:items.length?'pending_review':'native_questions_or_manual_extraction'});
}
await writeFile(`${root}/learning-manifest.json`,JSON.stringify(manifest,null,2));
console.log(JSON.stringify({documents:manifest.length,words:manifest.reduce((n,d)=>n+d.words,0),guides:manifest.reduce((n,d)=>n+d.guides,0),issues:manifest.reduce((n,d)=>n+d.issues,0)}));
