// Source-preserving proposals. OCR and extraction do not approve a candidate.
export const cleanSourceLine = value => value.replace(/^\s*(?:#{1,6}\s*|[-*]\s+)?/, '').replace(/\*\*/g,'').replace(/<\/?(?:u|sup|sub|b|i)>/g,'').trim();
export function glossaryRows(text) {
  const rows=[];
  for(const raw of text.split(/\r?\n/)) {
    const line=cleanSourceLine(raw);
    if(!line||line.length>600||/\||!\[|<!--|https?:|www\.|版权|公众号|范文|题型|题目/.test(line))continue;
    // Some source rows contain two explicit bilingual entries on the same line.
    const segments=line.split(/(?<=[\u3400-\u9fff])\s+(?=[A-Za-z][A-Za-z’' -]*\s*[\u3400-\u9fff])/);
    for(const segment of segments){
      const first=segment.search(/[\u3400-\u9fff]/);if(first<2)continue;
      let english=segment.slice(0,first).replace(/[（(:：\s]+$/,'').trim();const definition=segment.slice(first).trim();
      const pos=english.match(/\s+(n|v|adj|adv)\.$/);if(pos)english=english.slice(0,pos.index).trim();
      if(!/^[A-Za-z][A-Za-z’'.,()=+\-/ ]*$/.test(english)||english.length>120||english.split(/\s+/).length>12)continue;
      if(/[。！？?]/.test(definition)||/第一段|第二段|第三段|目录/.test(definition))continue;
      const alternatives=english.split(/\s*=\s*/);if(alternatives.some(term=>term.trim().length<2))continue;
      for(const value of alternatives){const term=value.trim();if(/^(?:n|v|adj|adv|a|b|c|d)\.?$/i.test(term))continue;
        rows.push({term,definition,part_of_speech:pos?.[1]??'',raw,related_terms:alternatives.filter(v=>v.trim()!==term).map(v=>v.trim())});}
    }
  }
  return rows;
}
const answerLine = raw => {const line=cleanSourceLine(raw);return line&&!/版权|公众号|视频号|杨帅|<!--|!\[|^#{1,6}/.test(raw)&&!/[\u3400-\u9fff]/.test(line)&&line.split(/\s+/).length>4;};
const appendAnswer=(question,page,raw)=>{const line=cleanSourceLine(raw);question.answerLines.push(line);question.answerParts.push({physicalPage:page.physicalPage,raw,text:line});question.answerPages.add(page.physicalPage);};
export function speakingQuestions(pages,part){
  const results=[];let current=null;
  for(const page of pages){const lines=page.text.split(/\r?\n/);
    for(let n=0;n<lines.length;n++){
      const raw=lines[n],line=cleanSourceLine(raw);
      if(part===1){const isQuestion=/^(Do|Does|Did|Are|Is|Was|Were|Have|Has|Had|What|When|Where|Why|Who|How|Would|Can|Could|Will|Should)\b/.test(line)&&/[?？]$/.test(line);
        if(isQuestion){current={prompt:line,physicalPage:page.physicalPage,raw,answerLines:[],answerParts:[],answerPages:new Set()};results.push(current);}
        else if(current&&answerLine(raw))appendAnswer(current,page,raw);
      }else{
        const describe=line.indexOf('Describe ');
        if(describe>=0){let end=n+1;
          while(end<lines.length){const next=cleanSourceLine(lines[end]);if(/^(?:范文|Sample|Model answer|Answer)/i.test(next)||/^(?:I(?:['’]m|['’]d|\s)|The\s|One\s|Well[,\s]|To\s)/.test(next))break;end++;}
          const prompt=[line.slice(describe),...lines.slice(n+1,end).map(cleanSourceLine)].filter(Boolean).join('\n');
          if(prompt.length>3000){current=null;continue;}
          current={prompt,physicalPage:page.physicalPage,raw:lines.slice(n,end).join('\n'),answerLines:[],answerParts:[],answerPages:new Set()};results.push(current);n=end-1;
        }else if(current&&answerLine(raw))appendAnswer(current,page,raw);
      }
    }
  }
  return results;
}
/** Numbered source essays: preserve questions and cross-page reference samples. */
export function writingTasks(pages){
  const tasks=[];let current=null,inPrompt=false;
  for(const page of pages)for(const paragraph of page.text.split(/\n\s*\n/)){
    const text=cleanSourceLine(paragraph);const numbered=text.match(/^(?:#{1,6}\s*)?(\d{1,3})[.、]\s*(?:题目[:：]\s*)?([A-Z][\s\S]+)$/);const unnumbered=text.match(/^(?:题目[:：]\s*)?((?:Some people|Many people|It is|In some|In many|Nowadays|People|The (?:(?:bar |pie |line )?(?:charts?|graphs?)|climographs?|tables?|diagrams?|maps?|two))\b[\s\S]+)$/);const start=numbered??(unnumbered?[null,String(tasks.length+1),unnumbered[1]]:null);
    const taskSignal=/Discuss|agree|disagree|To what extent|What (?:other|are)|Do you think|advantages|disadvantages|Why (?:could|do)|Should|Summari[sz]e|The (?:(?:bar |pie |line )?(?:charts?|graphs?)|climographs?|tables?|diagrams?|maps?|two) below/i;
    if(start&&(taskSignal.test(start[2])||(/^The (?:(?:bar |pie |line )?(?:charts?|graphs?)|climographs?|tables?|diagrams?|maps?|two)\b/i.test(start[2])&&page.physicalPage===1&&/题型/.test(page.text)))&&start[2].length>40){current={number:start[1],prompt:start[2],physicalPage:page.physicalPage,raw:paragraph,promptParts:[{physicalPage:page.physicalPage,raw:paragraph}],answerLines:[],answerParts:[],answerPages:new Set(),requiresFigure:/^The (?:(?:bar |pie |line )?(?:charts?|graphs?)|climographs?|tables?|diagrams?|maps?|two)/i.test(start[2]),figureLocators:[...page.text.matchAll(/!\[(?:Image|Chart|Table) block\]\((doc:[^)]+)\)/g)].map(m=>m[1])};tasks.push(current);inPrompt=true;continue;}
    if(!current||!text)continue;
    if(inPrompt&&/^(?:What|Why|How|Do you|To what extent|Discuss|Summari[sz]e|Write at least)\b/.test(text)&&/[?？.]$/.test(text)&&text.length<600){current.prompt+='\n'+text;current.promptParts.push({physicalPage:page.physicalPage,raw:paragraph});continue;}
    if(/^!\[|^<table|^\|/.test(text))continue;
    inPrompt=false;
    if(/^[\d\s]+$|Compiled by|^\(\d+ words|https?:|!\[|^<|版权/.test(text))continue;
    if(!/[\u3400-\u9fff]/.test(text)&&text.split(/\s+/).length>5){current.answerLines.push(text);current.answerParts.push({physicalPage:page.physicalPage,raw:paragraph,text});current.answerPages.add(page.physicalPage);}
  }
  return tasks;
}
