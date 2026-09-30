"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/supabase";
import type { WorkspaceData } from "@/lib/types";
import type { ViewActions } from "./views";
import { t } from "./workspace";

type Guide = { id: string; title: string; category: string; body: string; skill_tags: string[] };
const categories = ["plan", "writing_method", "answering_strategy", "patterns", "grammar"];
const labels = ["学习计划", "写作方法", "答题技巧", "规律总结", "语法基础"];
export function MethodsView({data,actions}:{data:WorkspaceData;actions:ViewActions}) {
  const lang=data.profile.language;
  const [category,setCategory]=useState(""),[page,setPage]=useState(1),[search,setSearch]=useState("");
  const [skill,setSkill]=useState("");
  const [guides,setGuides]=useState<Guide[]>([]),[count,setCount]=useState(0),[loading,setLoading]=useState(false),[error,setError]=useState("");
  const [opened,setOpened]=useState<string|null>(null);
  useEffect(()=>{if(!actions.client)return;let active=true;setLoading(true);setError("");void apiFetch(actions.client,`/api/study-guides?page=${page}&category=${category}&skill=${skill}&search=${encodeURIComponent(search)}`).then(value=>{if(active){const result=value as {guides:Guide[];count:number};setGuides(result.guides);setCount(result.count);}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[actions.client,page,category,skill,search]);
  return <div className="page-stack"><div className="page-intro"><div><span className="eyebrow">STUDY GUIDES</span><h2>{t(lang,"备考方法","Study guides")}</h2><p>{t(lang,"把计划、方法与技巧放在一起阅读。这里的内容不作答、不判分。","Read plans, methods and strategies here, without answers or scores.")}</p></div></div>
    <div className="library-tabs"><button className={!category?"active":""} onClick={()=>{setCategory("");setPage(1);setOpened(null);}}>{t(lang,"全部","All")}</button>{categories.map((key,i)=><button key={key} className={category===key?"active":""} onClick={()=>{setCategory(key);setPage(1);setOpened(null);}}>{t(lang,labels[i],["Plans","Writing methods","Strategies","Patterns","Grammar"][i])}</button>)}</div>
    <label>{t(lang,"搜索标题与内容","Search titles and content")}<input value={search} onChange={e=>{setSearch(e.target.value);setPage(1);setOpened(null);}}/></label>
    <label>{t(lang,"适用科目","Subject")}<select value={skill} onChange={e=>{setSkill(e.target.value);setPage(1);setOpened(null);}}><option value="">{t(lang,"全部科目","All subjects")}</option>{["reading","listening","writing","speaking"].map((key,i)=><option key={key} value={key}>{t(lang,["阅读","听力","写作","口语"][i],key)}</option>)}</select></label>
    {error&&<p className="notice info" role="alert">{error}</p>}{loading&&<p role="status">{t(lang,"正在加载…","Loading…")}</p>}
    {!loading&&!error&&!guides.length&&<section className="card empty-inline"><h3>{t(lang,"暂无已核验的方法笔记","No verified guides yet")}</h3><p>{t(lang,"原始资料仍可在资料库阅读，方法笔记核验后会显示在这里。","Original documents remain in the library. Verified method notes will appear here.")}</p></section>}
    <div className="guide-grid">{guides.map(guide=><article key={guide.id} className="card"><span className="eyebrow">{t(lang,labels[categories.indexOf(guide.category)]??"方法",guide.category)}</span><h3>{guide.title}</h3><p className="muted small">{guide.skill_tags.map(skill=>t(lang,({reading:"阅读",listening:"听力",writing:"写作",speaking:"口语"} as Record<string,string>)[skill]??skill,skill)).join(" · ")}</p><button className="button secondary" aria-expanded={opened===guide.id} onClick={()=>setOpened(opened===guide.id?null:guide.id)}>{opened===guide.id?t(lang,"收起","Collapse"):t(lang,"阅读笔记","Read guide")}</button>{opened===guide.id&&<div className="guide-body">{guide.body}</div>}</article>)}</div>
    {count>20&&<div className="button-row"><button className="button secondary" disabled={loading||page===1} onClick={()=>{setPage(p=>p-1);setOpened(null);}}>{t(lang,"上一页","Previous")}</button><span>{page} / {Math.ceil(count/20)}</span><button className="button secondary" disabled={loading||page*20>=count} onClick={()=>{setPage(p=>p+1);setOpened(null);}}>{t(lang,"下一页","Next")}</button></div>}
  </div>;
}
