"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CircleAlert, Star, Volume2 } from "lucide-react";
import type { VocabularyWord, WorkspaceData } from "@/lib/types";
import type { ViewActions } from "./views";
import { apiFetch } from "@/lib/supabase";
import { dueWords, reviewWord } from "@/lib/study";
import { Modal } from "./modal";
import { t } from "./workspace";
import { WordAchievements } from "./word-achievements";

export function WordMemory({ data, actions, manager, initialMode = "cards", toolOnly = false }: { data: WorkspaceData; actions: ViewActions; manager: ReactNode; initialMode?: "cards"|"overview"|"bank"|"reports"|"achievements"; toolOnly?: boolean }) {
  const lang = data.profile.language;
  const [mode, setMode] = useState<"cards"|"overview"|"bank"|"reports"|"achievements">(initialMode);
  const [search, setSearch] = useState(""), [tag, setTag] = useState(""), [page, setPage] = useState(1);
  const [newLimit, setNewLimit] = useState(20), [revealed, setRevealed] = useState(false), [intent, setIntent] = useState<boolean|null>(null);
  const [hidden, setHidden] = useState<"meaning"|"term"|"none">("meaning"), [showIpa, setShowIpa] = useState(true), [opened, setOpened] = useState<string[]>([]);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [listLoading,setListLoading] = useState(false);
  const [bank, setBank] = useState<VocabularyWord[]>([]), [bankCount, setBankCount] = useState(0);
  const [reports, setReports] = useState<{id:string;word_id:string;term?:string|null;kind:string;note:string;status:string;suggestion?:Record<string,string>}[]>([]);
  const [reportWord, setReportWord] = useState<VocabularyWord|null>(null), [reportKind, setReportKind] = useState("meaning"), [reportNote,setReportNote] = useState("");
  const [correction, setCorrection] = useState({term:"",definition:"",example:"",pronunciation:"",pronunciation_uk:"",pronunciation_us:""});
  const reportEvent = useRef<string|null>(null);
  const reviewEvent = useRef<{wordId:string;known:boolean;id:string}|null>(null), lock = useRef(false);
  const [rehearsal, setRehearsal] = useState<string[]>([]), [done, setDone] = useState(0), [seenToday,setSeenToday] = useState<string[]>([]);
  const [savedWords,setSavedWords] = useState<Record<string,VocabularyWord>>({});
  const [favoriteBusy,setFavoriteBusy] = useState(false);
  // Fresh authoritative rows already include accepted local edits. Do not keep
  // an older favorite/content snapshot over a later collection refresh.
  useEffect(() => { setSavedWords({}); }, [data.words]);
  const [cooldown,setCooldown] = useState<Record<string,number>>({}),[tick,setTick]=useState(Date.now());
  const effectiveWords = useMemo(() => data.words.map(w => savedWords[w.id] &&
    (savedWords[w.id].content_revision ?? 1) === (w.content_revision ?? 1) &&
    new Date(savedWords[w.id].last_reviewed_at ?? 0) >= new Date(w.last_reviewed_at ?? 0)
      ? savedWords[w.id] : w), [data.words, savedWords]);
  const words = useMemo(() => {
    const query = search.toLowerCase();
    return effectiveWords.filter(w => (!tag || w.tags.includes(tag)) &&
      (w.term + " " + w.definition).toLowerCase().includes(query)).sort((a,b) => a.term.localeCompare(b.term));
  }, [effectiveWords, tag, search]);
  const wordById = useMemo(() => new Map(effectiveWords.map(word => [word.id, word])), [effectiveWords]);
  const tags = useMemo(() => [...new Set([...effectiveWords.flatMap(w => w.tags),
    ...(mode === "bank" ? ["AWL学术核心570", ...Array.from({length:10}, (_,i) => `AWL第${i+1}组`), ...bank.flatMap(w => w.tags)] : [])])].sort(), [effectiveWords, mode, bank]);
  const due = useMemo(() => dueWords(words), [words, tick]);
  const queue = useMemo(() => [...due.filter(w => w.interval_days > 0),
    ...due.filter(w => w.interval_days === 0).slice(0, Math.max(0, newLimit - seenToday.length))], [due, newLimit, seenToday.length]);
  // Wake when a word becomes due or rehearsal becomes available, not every second.
  useEffect(() => {
    const now = Date.now();
    const next = Math.min(...Object.values(cooldown).filter(time => time > now),
      ...words.map(word => Date.parse(word.due_at)).filter(time => time > now));
    if (!Number.isFinite(next)) return;
    const timer = window.setTimeout(() => setTick(Date.now()), Math.min(2147483647, Math.max(1, next - now + 10)));
    return () => window.clearTimeout(timer);
  }, [cooldown, words, tick]);
  const current = queue[0] ?? (queue.length===0 ? words.find(w=>rehearsal.includes(w.id) && (cooldown[w.id]??0)<=tick) : undefined);
  const reinforcement = !!current && rehearsal.includes(current.id) && !queue.some(w=>w.id===current.id);
  useEffect(()=>{ if (!window.speechSynthesis) return; const sync=()=>setVoices(window.speechSynthesis.getVoices()); sync(); window.speechSynthesis.addEventListener("voiceschanged",sync); return ()=>{window.speechSynthesis.cancel();window.speechSynthesis.removeEventListener("voiceschanged",sync);}; },[]);
  useEffect(()=>{window.speechSynthesis?.cancel();setRevealed(false);setIntent(null);setError("");reviewEvent.current=null;},[current?.id,mode,tag]);
  useEffect(()=>{setPage(1);setOpened([]);},[search,tag,mode]);
  useEffect(() => {
    const client = actions.client;
    if (!client || (mode !== "bank" && mode !== "reports")) return;
    let active = true;
    const controller = new AbortController();
    const path = mode === "bank" ? `/api/word-bank?page=${page}&search=${encodeURIComponent(search)}&tag=${encodeURIComponent(tag)}` : "/api/word-reports";
    setError(""); setListLoading(true);
    if (mode === "bank") { setBank([]); setBankCount(0); } else setReports([]);
    const timer = window.setTimeout(() => {
      void apiFetch(client, path, { signal: controller.signal }).then(value => {
        if (!active) return;
        const result = value as { words: VocabularyWord[]; count: number; reports: typeof reports };
        if (mode === "bank") { setBank(result.words); setBankCount(result.count); }
        else setReports(result.reports);
      }).catch(error => { if (active) setError(error.message); })
        .finally(() => { if (active) setListLoading(false); });
    }, mode === "bank" && search ? 250 : 0);
    return () => { active = false; window.clearTimeout(timer); controller.abort(); };
  }, [actions.client, mode, page, search, tag]);

  function pronounce(text:string,accent:"en-GB"|"en-US") { const voice=voices.find(v=>v.lang.toLowerCase()===accent.toLowerCase());if(!voice){actions.notify(t(lang,"设备没有对应口音语音","No device voice for this accent"));return;} window.speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(text);utterance.voice=voice;utterance.lang=accent;utterance.onerror=()=>actions.notify(t(lang,"朗读失败，请重试","Playback failed; retry"));window.speechSynthesis.speak(utterance); }
  function audio(word:VocabularyWord) {return <div className="word-pronunciation">{(["en-GB","en-US"] as const).map(accent=><button type="button" className="button secondary small" key={accent} disabled={!voices.some(v=>v.lang.toLowerCase()===accent.toLowerCase())} onClick={()=>pronounce(word.term,accent)}><Volume2 size={15}/>{accent==="en-GB"?"UK":"US"}{accent==="en-GB"?word.pronunciation_uk:word.pronunciation_us}</button>)}<small>{t(lang,"设备朗读 · 缺少口音时不可用","Device voice · unavailable accents disabled")}</small></div>;}
  async function confirm(known:boolean) {
    if(!current||!revealed||lock.current||(known&&intent!==true))return;
    lock.current=true;setBusy(true);setError("");
    try {
      if(!reinforcement) {
        if(reviewEvent.current && reviewEvent.current.known!==known) throw new Error(t(lang,"上次反馈尚未确认，请按原选择重试","Retry the previous choice before changing it"));
        reviewEvent.current??={wordId:current.id,known,id:crypto.randomUUID()};
        let saved:VocabularyWord;
        if(actions.client) {const result=await apiFetch(actions.client,"/api/word-reviews",{method:"POST",body:JSON.stringify({wordId:current.id,eventId:reviewEvent.current.id,known,revision:current.content_revision??1})}) as {word:VocabularyWord};saved=result.word;}
        else {saved=reviewWord(current,known);await actions.upsert("vocabulary","words",saved);}
        setSavedWords(words=>({...words,[current.id]:saved}));
        actions.acceptWord?.(saved);
        setDone(n=>n+1);if(current.interval_days===0)setSeenToday(ids=>[...ids,current.id]);
      }
      setRehearsal(ids=>known?ids.filter(id=>id!==current.id):[...ids.filter(id=>id!==current.id),current.id]);
      if(!known)setCooldown(values=>({...values,[current.id]:Date.now()+60000}));
      reviewEvent.current=null;setRevealed(false);setIntent(null);

    } catch(e){setError(e instanceof Error?e.message:"保存失败");}
    finally{lock.current=false;setBusy(false);}
  }
  function report(word:VocabularyWord){setReportWord(word);setReportNote("");setReportKind("meaning");setCorrection({term:word.term,definition:word.definition,example:word.example,pronunciation:word.pronunciation??"",pronunciation_uk:word.pronunciation_uk??"",pronunciation_us:word.pronunciation_us??""});reportEvent.current=crypto.randomUUID();}
  async function saveReport(){if(!reportWord||!actions.client||busy)return;setBusy(true);try{await apiFetch(actions.client,"/api/word-reports",{method:"POST",body:JSON.stringify({id:reportEvent.current,wordId:reportWord.id,revision:reportWord.content_revision??1,kind:reportKind,note:reportNote,suggestion:correction})});actions.notify(t(lang,"反馈已保存，可在处理记录中应用到个人词卡","Report saved; apply it to your personal card from reports"));setReportWord(null);}catch(e){actions.notify(e instanceof Error?e.message:"报错失败");}finally{setBusy(false);}}
  useEffect(()=>{const handler=(e:KeyboardEvent)=>{if(reportWord||mode!=="cards"||!current||busy||(e.target instanceof HTMLElement&&e.target.closest("dialog,input,textarea,select,button,[contenteditable=true]")))return;if(e.code==="Space"){e.preventDefault();setRevealed(true);}if(e.key==="1"||e.key==="2"){e.preventDefault();if(!revealed){setIntent(e.key==="1");setRevealed(true);}else void confirm(e.key==="1");}};window.addEventListener("keydown",handler);return()=>window.removeEventListener("keydown",handler);});
  const maxPage=Math.max(1,Math.ceil((mode==="bank"?bankCount:words.length)/(mode==="bank"?50:40)));
  useEffect(()=>{if(mode==="overview"&&page>maxPage)setPage(maxPage);},[mode,page,maxPage]);
  const overview=words.slice((page-1)*40,page*40);
  async function toggleFavorite(word:VocabularyWord) {
    if(favoriteBusy||busy||lock.current)return;
    setFavoriteBusy(true);
    try {
      const favorite=!word.tags.includes("收藏");
      if(actions.client){const result=await apiFetch(actions.client,"/api/word-favorites",{method:"POST",body:JSON.stringify({wordId:word.id,favorite})}) as {word:VocabularyWord};setSavedWords(previous=>({...previous,[word.id]:result.word}));actions.acceptWord?.(result.word);}
      else await actions.upsert("vocabulary","words",{...word,tags:favorite?[...word.tags,"收藏"]:word.tags.filter(tag=>tag!=="收藏")});
      actions.notify(t(lang,favorite?"已收藏，复习安排保持不变":"已取消收藏，复习安排保持不变",favorite?"Saved to favorites; review schedule unchanged":"Removed from favorites; review schedule unchanged"));

    }catch(e){actions.notify(e instanceof Error?e.message:t(lang,"收藏未保存，请重试","Favorite was not saved; retry"));}
    finally{setFavoriteBusy(false);}
  }
  const title=mode==="bank"?t(lang,"资料词库","Source word bank"):mode==="reports"?t(lang,"报错记录","Error reports"):mode==="overview"?t(lang,"总览速记","Quick overview"):t(lang,"背单词","Word memory");
  const description=mode==="bank"?t(lang,"找到需要的词卡，加入个人词表后开始记忆。重复加入保留原进度。","Find cards and add them to your list. Re-imports preserve existing progress."):mode==="reports"?t(lang,"查看反馈处理状态；应用修正不会重置复习安排。","Track feedback. Applying corrections preserves review schedules."):t(lang,"先回忆，再核对释义。猜中或记不清请选择不认识。","Recall first, then check. Treat guesses as not known.");
  return <div className="page-stack word-memory"><div className="page-intro"><div><h2>{title}</h2><p>{description}</p></div>{!toolOnly&&<div className="metric-badge"><strong>{done}</strong><span>{t(lang,"本轮已完成","confirmed this session")}</span></div>}</div>
    {!toolOnly&&<div className="library-tabs">{(["cards","overview","bank","reports","achievements"] as const).map((item,index)=><button key={item} aria-pressed={mode===item} className={mode===item?"active":""} onClick={()=>setMode(item)}>{[t(lang,"逐词记忆","Cards"),t(lang,"总览速记","Overview"),t(lang,"资料词库","Source word bank"),t(lang,"报错处理","Reports"),t(lang,"成就闪卡","Achievements")][index]}</button>)}</div>}
    {mode!=="achievements"&&<div className="library-toolbar"><label>{t(lang,mode==="bank"?"搜索资料词库":"搜索已加载词卡",mode==="bank"?"Search source bank":"Search loaded cards")}<input value={search} onChange={e=>setSearch(e.target.value)}/></label>{mode!=="reports"&&<label>{t(lang,"词表 / 标签","List / tag")}<select value={tag} onChange={e=>setTag(e.target.value)}><option value="">{t(lang,"全部","All")}</option>{tags.map(tag=><option key={tag}>{tag}</option>)}</select></label>}{mode==="cards"&&<label>{t(lang,"本轮新词上限","New words this session")}<input type="number" min={1} max={100} value={newLimit} onChange={e=>setNewLimit(Math.min(100,Math.max(1,Number(e.target.value)||20)))}/></label>}</div>}
    {listLoading&&<p role="status">{t(lang,"正在加载…","Loading…")}</p>}
    {error&&<p className="notice info" role="alert">{error}</p>}
    {mode==="cards"&&<section className="card word-focus">{current?<><div className="card-top"><span>{reinforcement?t(lang,"当日巩固 · 不重复延长复习间隔","Rehearsal · no extra interval increase"):t(lang,"主动回忆","Active recall")}</span><div className="word-card-tools"><button className={`word-favorite ${current.tags.includes("收藏")?"is-favorite":""}`} disabled={busy||favoriteBusy} aria-pressed={current.tags.includes("收藏")} onClick={()=>void toggleFavorite(current)}><Star size={18} fill={current.tags.includes("收藏")?"currentColor":"none"}/>{t(lang,current.tags.includes("收藏")?"已收藏":"收藏",current.tags.includes("收藏")?"Saved":"Save")}</button><button className="question-report-button" onClick={()=>report(current)}><CircleAlert size={16}/>{t(lang,"报错","Report")}</button></div></div><h3 className="word-title">{current.term}</h3>{current.pronunciation&&<p>{current.pronunciation}</p>}{audio(current)}{!revealed?<><p className="muted">{t(lang,"先想起对应词义；选择后还需核对并确认。","Recall the meaning; your first choice still needs confirmation.")}</p><div className="button-row"><button className="button primary grow" onClick={()=>{setIntent(true);setRevealed(true);}}>{t(lang,"认识","Known")}</button><button className="button secondary grow" onClick={()=>{setIntent(false);setRevealed(true);}}>{t(lang,"不认识","Not known")}</button></div><button className="text-link" onClick={()=>{setIntent(null);setRevealed(true);}}>{t(lang,"查看释义 · Space","Reveal · Space")}</button></>:<><div className="word-meaning">{current.tags.includes("administrator-approved-unverified")&&<small className="definition-origin">{t(lang,"管理员批准发布 · 词义待原页核验","Administrator approved · Source meaning review pending")}</small>}<span>{current.part_of_speech}</span><p>{current.definition}</p>{current.tags.includes("AWL学术核心570")&&<small className="definition-origin">{t(lang,"释义为AI补充 · 已审核","AI-added meaning · reviewed")}</small>}{current.example&&<p className="word-example">{current.example}</p>}</div><p className="muted small">{intent===true?t(lang,"请确认刚才确实想起了这个词义。","Confirm that you recalled this meaning."):t(lang,"看过释义后才想起，按不认识安排。","If you remembered only after revealing, choose not known.")}</p><div className="button-row"><button disabled={busy||intent!==true} className="button primary grow" onClick={()=>void confirm(true)}>{t(lang,"确认认识","Confirm known")} · {reinforcement?t(lang,"保留原复习日期","Keep review date"):`${current.interval_days<1?1:Math.min(60,current.interval_days*2)} ${t(lang,"天后","days")}`}</button><button disabled={busy} className="button secondary grow" onClick={()=>void confirm(false)}>{t(lang,"不认识 · 稍后再练，明天复习","Not known · rehearse, review tomorrow")}</button></div></>}<p className="muted small">{queue.length} {t(lang,"待记忆","remaining")} · {t(lang,"1 / 2 确认反馈，播放和报错不计学习结果。","1 / 2 confirm. Audio and reporting do not count as recall.")}</p></>:<div className="empty-inline"><strong>{t(lang,"本轮词卡已完成","This session is complete")}</strong><p>{t(lang,"可以从资料词库加入词卡，或调整筛选条件。不认识的词将在一分钟后回来巩固。","Add cards from the source bank or adjust your filter.")}</p></div>}</section>}
    {mode==="overview"&&<section className="card"><div className="button-row"><label>{t(lang,"遮盖","Hide")}<select value={hidden} onChange={e=>{setHidden(e.target.value as typeof hidden);setOpened([]);}}><option value="meaning">{t(lang,"释义","Meaning")}</option><option value="term">{t(lang,"单词","Term")}</option><option value="none">{t(lang,"浏览全部","Browse all")}</option></select></label><label><input type="checkbox" checked={showIpa} onChange={e=>setShowIpa(e.target.checked)}/>{t(lang,"显示音标","Show IPA")}</label></div><p className="muted small">{t(lang,"浏览与揭示不改变复习进度。隐藏单词时同时隐藏音标和朗读。","Browsing does not change review progress. Hidden terms also hide IPA and audio.")}</p><div className="word-overview">{overview.map(w=>{const show=opened.includes(w.id);return <article key={w.id}><div>{hidden!=="term"||show?<><strong>{w.term}</strong>{showIpa&&<small>{w.pronunciation}</small>}{audio(w)}</>:<button className="button secondary small" onClick={()=>setOpened(ids=>[...ids,w.id])}>{t(lang,"揭示单词","Reveal term")}</button>}</div><div>{hidden!=="meaning"||show?<p>{w.part_of_speech} {w.definition}</p>:<button className="button secondary small" onClick={()=>setOpened(ids=>[...ids,w.id])}>{t(lang,"揭示释义","Reveal meaning")}</button>}</div><button className="question-report-button" onClick={()=>report(w)}><CircleAlert size={16}/>{t(lang,"报错","Report")}</button></article>;})}</div></section>}
    {mode==="bank"&&<section className="card"><h3>{t(lang,"已发布资料词卡","Published source cards")}</h3><p className="muted">{t(lang,"加入个人词表后开始记忆；重复加入保留既有复习记录。","Add to your personal list. Re-imports preserve review history.")}</p>{bank.length>0&&<button className="button primary" disabled={busy||listLoading} onClick={()=>{if(!actions.client)return;setBusy(true);void apiFetch(actions.client,"/api/word-bank",{method:"POST",body:JSON.stringify({ids:bank.map(w=>w.id)})}).then(()=>actions.refresh()).then(()=>actions.notify(t(lang,"本页词卡已加入，原有进度保留","Page added; existing progress preserved"))).catch(e=>setError(e.message)).finally(()=>setBusy(false));}}>{t(lang,"加入本页词卡","Add this page")}</button>}{!listLoading&&!bank.length&&<p>{t(lang,"暂无匹配的已发布词卡。","No published cards match.")}</p>}{bank.map(w=><article className="word-bank-row" key={w.id}><div><strong>{w.term}</strong>{w.tags?.includes("administrator-approved-unverified")&&<p className="muted small">{t(lang,"管理员批准发布 · 原页待核验","Administrator approved · Source verification pending")}</p>}<p>{w.part_of_speech} {w.definition}</p></div><button disabled={busy||listLoading} className="button secondary small" onClick={()=>{if(!actions.client)return;setBusy(true);void apiFetch(actions.client,"/api/word-bank",{method:"POST",body:JSON.stringify({ids:[w.id]})}).then(()=>actions.refresh()).then(()=>actions.notify(t(lang,"已加入个人词表","Added to your list"))).catch(e=>setError(e.message)).finally(()=>setBusy(false));}}>{t(lang,"加入词表","Add")}</button></article>)}</section>}
    {mode==="reports"&&<section className="card"><h3>{t(lang,"个人词卡报错记录","Personal card reports")}</h3>{reports.map(r=><article className="word-bank-row" key={r.id}><div><strong>{wordById.get(r.word_id)?.term??r.term??t(lang,"词卡名称不可用","Card name unavailable")}</strong><p>{t(lang,({spelling:"拼写",meaning:"释义",pronunciation:"音标 / 发音",example:"例句",other:"其他"} as Record<string,string>)[r.kind]??r.kind,r.kind)} · {r.note} · {t(lang,r.status==="applied"?"已应用":"待处理",r.status)}</p>{r.suggestion&&<details><summary>{t(lang,"核对建议修改","Review proposed changes")}</summary>{Object.entries(r.suggestion).map(([key,value])=><p key={key}><strong>{t(lang,({term:"单词",definition:"释义",example:"例句",pronunciation:"音标",pronunciation_uk:"英式音标",pronunciation_us:"美式音标"} as Record<string,string>)[key]??key,key)}</strong>：{value||t(lang,"留空","Empty")}</p>)}</details>}</div>{r.status==="pending"&&<button className="button secondary small" disabled={busy} onClick={()=>{if(!actions.client)return;setBusy(true);void apiFetch(actions.client,"/api/word-reports",{method:"PATCH",body:JSON.stringify({id:r.id})}).then(()=>actions.refresh()).then(()=>setReports(items=>items.map(item=>item.id===r.id?{...item,status:"applied"}:item))).catch(e=>setError(e.message)).finally(()=>setBusy(false));}}>{t(lang,"应用到个人词卡","Apply to my card")}</button>}</article>)}{!listLoading&&!reports.length&&<p>{t(lang,"暂无反馈","No reports")}</p>}</section>}
    {(mode==="overview"||mode==="bank")&&<div className="button-row"><button className="button secondary" disabled={listLoading||page===1} onClick={()=>{window.speechSynthesis?.cancel();setOpened([]);setPage(p=>p-1);}}>{t(lang,"上一页","Previous")}</button><span>{page} / {Math.max(1,Math.ceil((mode==="bank"?bankCount:words.length)/(mode==="bank"?50:40)))}</span><button className="button secondary" disabled={listLoading||page*(mode==="bank"?50:40)>=(mode==="bank"?bankCount:words.length)} onClick={()=>{window.speechSynthesis?.cancel();setOpened([]);setPage(p=>p+1);}}>{t(lang,"下一页","Next")}</button></div>}
    {mode==="achievements"&&<WordAchievements client={actions.client} language={lang} refreshKey={done}/>}
    <details className="card"><summary>{t(lang,"管理词表、添加单词与测验","Manage lists, add words and quiz")}</summary>{manager}</details>
    {reportWord&&<Modal label={t(lang,"词卡报错","Report card")} busy={busy} onClose={()=>setReportWord(null)}><div className="question-report-form"><h3>{reportWord.term}</h3><label>{t(lang,"问题类型","Issue")}<select value={reportKind} onChange={e=>setReportKind(e.target.value)}>{["spelling","meaning","pronunciation","example","other"].map(k=><option key={k} value={k}>{t(lang,({spelling:"拼写",meaning:"释义",pronunciation:"音标 / 发音",example:"例句",other:"其他"} as Record<string,string>)[k],k)}</option>)}</select></label>{(["term","definition","example","pronunciation","pronunciation_uk","pronunciation_us"] as const).map(field=><label key={field}>{t(lang,({term:"单词或短语",definition:"释义",example:"例句",pronunciation:"原有音标",pronunciation_uk:"英式音标",pronunciation_us:"美式音标"})[field],field)}<textarea value={correction[field]} onChange={e=>setCorrection(c=>({...c,[field]:e.target.value}))}/></label>)}<label>{t(lang,"问题说明","Note")}<textarea value={reportNote} onChange={e=>setReportNote(e.target.value)}/></label><button className="button primary" disabled={busy||!actions.client} onClick={()=>void saveReport()}>{t(lang,"提交反馈","Send report")}</button></div></Modal>}
  </div>;
}
