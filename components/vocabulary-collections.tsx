"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Headphones, PenLine, Mic, GraduationCap, Layers, Star, Library } from "lucide-react";
import type { WorkspaceData, VocabularyWord } from "@/lib/types";
import type { ViewActions } from "./views";
import { apiFetch } from "@/lib/supabase";
import { WordMemory } from "./word-memory";
import { t } from "./workspace";
const categories = [
 { id:"reading", zh:"阅读词汇", en:"Reading", icon:BookOpen, desc:"学科、场景与同义替换" },
 { id:"listening", zh:"听力词汇", en:"Listening", icon:Headphones, desc:"场景词与答案词" },
 { id:"writing", zh:"写作词汇", en:"Writing", icon:PenLine, desc:"话题表达与词伙" },
 { id:"speaking", zh:"口语词汇", en:"Speaking", icon:Mic, desc:"话题词与日常表达" },
 { id:"academic", zh:"学术核心 AWL", en:"Academic AWL", icon:GraduationCap, desc:"570 个学术核心词" },
 { id:"general", zh:"通用与其他", en:"General", icon:Layers, desc:"未限定科目的词卡" },
 { id:"favorites", zh:"我的收藏", en:"Favorites", icon:Star, desc:"你收藏的词卡" },
 { id:"all", zh:"全部词汇", en:"All cards", icon:Library, desc:"分批浏览所有词卡" },
];
function matches(word:VocabularyWord,id:string):boolean {
 const tags=word.tags??[];const subject=(key:string,text:string)=>tags.some(tag=>tag===key||tag.includes(text));
 return id==='all'||(id==='favorites'?tags.includes('收藏'):id==='academic'?tags.includes('AWL学术核心570'):id==='reading'?subject('reading','阅读'):id==='listening'?subject('listening','听力'):id==='writing'?subject('writing','写作'):id==='speaking'?subject('speaking','口语'):!tags.some(tag=>['reading','listening','writing','speaking','AWL学术核心570'].includes(tag)||/阅读|听力|写作|口语/.test(tag)));
}
type Count = {collection:string;total:number;due:number};
type Page = {words:VocabularyWord[];hasMore:boolean;cursor:string|null};
export function VocabularyCollections({data,actions,manager}:{data:WorkspaceData;actions:ViewActions;manager:(data:WorkspaceData,actions:ViewActions)=>React.ReactNode}) {
 const lang=data.profile.language;
 const [counts,setCounts]=useState<Count[]>([]),[selected,setSelected]=useState<string|null>(null),[words,setWords]=useState<VocabularyWord[]>([]);
 const [more,setMore]=useState(false),[cursor,setCursor]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const generation=useRef(0),lock=useRef(false),active=useRef<string|null>(null),edits=useRef(new Map<string,VocabularyWord>());
 async function loadCounts(){if(!actions.client){setCounts(categories.map(c=>{const rows=data.words.filter(w=>matches(w,c.id));return {collection:c.id,total:rows.length,due:rows.filter(w=>Date.parse(w.due_at)<=Date.now()).length};}));return;}const result=await apiFetch(actions.client,"/api/word-collections") as {collections:Count[]};setCounts(result.collections);}
 useEffect(()=>{let mounted=true;if(!actions.client)void loadCounts();if(actions.client)void apiFetch(actions.client,"/api/word-collections").then(value=>{if(mounted)setCounts((value as {collections:Count[]}).collections);}).catch(e=>{if(mounted)setError(e.message);});return()=>{mounted=false;generation.current++;};},[actions.client,data.profile.id]);
 async function load(id:string,append=false){
  if(lock.current)return;lock.current=true;setBusy(true);setError("");const token=++generation.current;edits.current=new Map();
  try {
   if(!actions.client){setWords(data.words.filter(w=>matches(w,id)));setMore(false);return;}
   const result=await apiFetch(actions.client,`/api/word-collections?collection=${id}${append&&cursor?`&cursor=${cursor}`:""}`) as Page;
   if(token!==generation.current||active.current!==id)return;
   const rows=result.words.map(word=>{
    const edit=edits.current.get(word.id);
    if(!edit)return word;
    if((edit.content_revision??1)<(word.content_revision??1))return word;
    if((edit.content_revision??1)===(word.content_revision??1)&&Date.parse(edit.last_reviewed_at??"1970-01-01")<Date.parse(word.last_reviewed_at??"1970-01-01"))return word;
    return edit;
   });
   setWords(previous=>append?[...new Map([...previous,...rows].map(w=>[w.id,w])).values()]:rows);setMore(result.hasMore);setCursor(result.cursor);
  }catch(e){if(token===generation.current)setError(e instanceof Error?e.message:"加载失败");}
  finally{if(token===generation.current){lock.current=false;setBusy(false);}}
 }
 function choose(id:string){active.current=id;setSelected(id);setWords([]);setCursor(null);setMore(false);void load(id);}
 function back(){generation.current++;lock.current=false;active.current=null;setBusy(false);setError("");setSelected(null);void loadCounts().catch(e=>setError(e.message));}
 const localActions:ViewActions={...actions,
  acceptWord:word=>{edits.current.set(word.id,word);setWords(previous=>previous.map(w=>w.id===word.id?word:w).filter(w=>active.current!=="favorites"||w.tags.includes("收藏")));actions.acceptWord?.(word);},
  refresh:async()=>{await actions.refresh();await loadCounts();if(active.current)await load(active.current);},
  upsert:async(...args)=>{await actions.upsert(...args);if(!actions.client&&args[1]==="words"){const word=args[2] as unknown as VocabularyWord;setWords(previous=>[...previous.filter(w=>w.id!==word.id),word].filter(w=>matches(w,active.current??"all")));}else if(active.current)await load(active.current);},
  remove:async(...args)=>{await actions.remove(...args);if(!actions.client&&args[1]==="words")setWords(previous=>previous.filter(w=>w.id!==args[2]));else if(active.current)await load(active.current);},
 };
 const localData={...data,words,wordsLoaded:true};
 const category=categories.find(c=>c.id===selected);
 return <div className="page-stack vocabulary-collections">
 {!selected?<><div className="section-intro"><span className="eyebrow">VOCABULARY COLLECTIONS</span><h2>{t(lang,"选择词卡分类","Choose a collection")}</h2><p className="muted">{t(lang,"按科目开始，每次只加载 250 张。跨科目词卡会出现在多个分类，复习记录共用。","Start by subject. Load 250 cards at a time. Cards in multiple collections share the same review history.")}</p></div>
 <div className="word-collection-grid">{categories.map(c=>{const count=counts.find(n=>n.collection===c.id);const Icon=c.icon;return <button key={c.id} className={`word-collection-tile collection-${c.id}`} onClick={()=>choose(c.id)} disabled={busy}><span className="collection-icon"><Icon size={26}/></span><strong>{t(lang,c.zh,c.en)}</strong><span className="muted">{t(lang,c.desc,c.en)}</span><span className="collection-count">{count?Number(count.total).toLocaleString():"—"} {t(lang,"张词卡","cards")}<ArrowRight size={18}/></span>{count&&<small>{Number(count.due).toLocaleString()} {t(lang,"张待复习","due")}</small>}</button>;})}</div>
 {error&&<div className="card" role="alert"><p>{error}</p><button className="button secondary" onClick={()=>void loadCounts().then(()=>setError("")).catch(e=>setError(e.message))}>{t(lang,"重试","Retry")}</button></div>}</>:<>
 <div className="collection-topbar"><button className="button secondary" onClick={back}><ArrowLeft size={18}/>{t(lang,"词卡分类","Collections")}</button><strong>{category&&t(lang,category.zh,category.en)}</strong><button className="text-link" disabled={busy} onClick={()=>void load(selected)}>{t(lang,"刷新分类","Refresh collection")}</button><span className="muted">{t(lang,`已加载 ${words.length} 张`,`${words.length} loaded`)}</span></div>
 {error&&<p role="alert">{error}<button className="button secondary" onClick={()=>void load(selected,words.length>0)}>{t(lang,"重试","Retry")}</button></p>}
 {busy&&!words.length?<section className="card" role="status">{t(lang,"正在加载这一类词卡…","Loading this collection…")}</section>:<WordMemory key={selected} data={localData} actions={localActions} manager={more?<p className="muted">{t(lang,"词表按批加载；加载完整分类后可管理词表。","Load the complete collection to manage its list.")}</p>:manager(localData,localActions)}/>}
 {more&&<section className="card collection-more"><p>{t(lang,"当前仅展示已加载的词卡；还有更多可继续学习。","Only loaded cards are shown. More cards are available.")}</p><button disabled={busy} className="button primary" onClick={()=>void load(selected,true)}>{t(lang,busy?"正在加载…":"再加载 250 张",busy?"Loading…":"Load 250 more")}</button></section>}
 </>}
 </div>;
}
