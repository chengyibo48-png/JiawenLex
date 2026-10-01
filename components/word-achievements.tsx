"use client";

import { useEffect, useRef, useState } from "react";
import { LockKeyhole, Sparkles, X } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { apiFetch } from "@/lib/supabase";
import { Modal } from "./modal";
import { APP_VERSION } from "@/lib/release";
import "./word-achievements.css";

type Progress = { learned: number; unlocked: number; nextTarget: number };
const collectibleArt = [
  { folder: "first", titleZh: "蓝色伙伴", titleEn: "Blue companion", width: 1200, height: 1193 },
  { folder: "second", titleZh: "毛茸伙伴", titleEn: "Furry companion", width: 1198, height: 2048 },
  { folder: "third", titleZh: "樱花同伴", titleEn: "Sakura companions", width: 1199, height: 677 },
  { folder: "fourth", titleZh: "珊瑚伙伴", titleEn: "Coral companion", width: 885, height: 896 },
] as const;

export function WordAchievements({ client, language, refreshKey }: {
  client: SupabaseClient | null; language: string; refreshKey: number;
}) {
  const en = language === "en";
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const viewer = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.source === viewer.current?.contentWindow && event.data?.type === "holo-close") setSelected(null);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  useEffect(() => { if (selected !== null && selected >= (progress?.unlocked ?? 0)) setSelected(null); }, [progress?.unlocked, selected]);
  useEffect(() => {
    let active = true;
    setError("");
    if (!client) { setProgress(null); return; }
    void apiFetch(client, "/api/word-achievements").then(value => {
      if (active) setProgress(value as Progress);
    }).catch(() => {
      if (active) { setProgress(null); setError(en ? "Achievement progress is unavailable. Retry later." : "成就统计暂不可用，请稍后重试；新功能需随版本更新启用。"); }
    });
    return () => { active = false; };
  }, [client, en, refreshKey, retry]);
  const unlocked = progress?.unlocked ?? 0;
  // More artwork can be attached to milestones without changing earned progress.
  const visible = Math.min(6, Math.max(4, unlocked + 1));
  return <section className="card word-achievements" aria-labelledby="word-achievement-title">
    <div className="card-top"><div><h3 id="word-achievement-title"><Sparkles size={20}/>{en ? "Word collection" : "词汇成就 · 闪卡收藏"}</h3><p className="muted">{en ? "One milestone for every 500 distinct words you confirm as known." : "每累计确认认识 500 个不同单词，解锁一张闪卡。"}</p></div>
      <span className="achievement-total">{progress ? `${progress.learned} ${en ? "words" : "词"}` : "—"}</span></div>
    {!client && <p className="notice info">{en ? "Sign in to track your collection. Demo browsing earns no achievements." : "登录后记录成就；演示浏览不解锁闪卡。"}</p>}
    {error && <p className="notice info" role="alert">{error} <button className="text-link" onClick={() => setRetry(n => n + 1)}>{en ? "Retry" : "重试"}</button></p>}
    {client && !error && !progress && <p role="status">{en ? "Loading progress…" : "正在读取成就…"}</p>}
    {progress && <div className="achievement-progress"><progress max={500} value={progress.learned % 500} aria-label={en ? "Next milestone" : "下张闪卡进度"}/><span>{en ? `${progress.nextTarget - progress.learned} words to the next milestone` : `距下张闪卡还差 ${progress.nextTarget - progress.learned} 词`}</span></div>}
    <div className="achievement-shelf">{Array.from({ length: visible }, (_, index) => {
      const earned = index < unlocked;
      const art = collectibleArt[index];
      const ready = !!art;
      return <button key={index} type="button" className={`achievement-card ${earned ? "earned" : "locked"}`} disabled={!earned || !ready}
        onClick={() => { if (earned && ready) setSelected(index); }} aria-label={en ? `Card ${index + 1}, ${(index + 1) * 500} words, ${earned ? "earned" : "locked"}` : `第 ${index + 1} 张，${(index + 1) * 500} 词，${earned ? "已解锁" : "未解锁"}`}>
        <div className="achievement-art">{art ? <img src={`/holo/${art.folder}/thumbnail.jpg?v=${APP_VERSION}`} alt={en ? art.titleEn : art.titleZh} width={art.width} height={art.height} loading="lazy" decoding="async"/> : <Sparkles size={48}/>}<span className="achievement-state">{earned ? <Sparkles size={18}/> : <LockKeyhole size={18}/>}</span></div>
        <strong>{art ? (en ? art.titleEn : art.titleZh) : (en ? "Artwork in preparation" : "图片待制作")}</strong><span>{(index + 1) * 500} {en ? "words" : "词"}</span>
        <small>{earned ? ready ? (en ? "Click to inspect" : "点击旋转查看") : (en ? "Milestone earned · layered artwork pending" : "成就已达成 · 分层闪卡待完成") : (en ? "Locked" : "未解锁")}</small>
      </button>;
    })}</div>
    {unlocked > visible && <p>{en ? `${unlocked} milestones earned` : `已达成 ${unlocked} 个里程碑`}</p>}
    <p className="muted small">{en ? "Repeated recalls and multiple meanings count once per word. Earned milestones stay earned; browsing and audio do not count." : "同一单词的多次复习、多个词义只计一次；已达成成就保留。浏览、揭示释义和播放音频不计数。"}</p>
    {selected !== null && selected < unlocked && collectibleArt[selected] && <Modal label={`${en ? collectibleArt[selected].titleEn : collectibleArt[selected].titleZh}${en ? " holographic card" : "镭射闪卡"}`} onClose={() => setSelected(null)}>
      <div className="card-top"><h3>{en ? collectibleArt[selected].titleEn : collectibleArt[selected].titleZh}</h3><button className="button secondary small" data-modal-initial-focus onClick={() => setSelected(null)} aria-label={en ? "Close" : "关闭"}><X size={18}/></button></div>
      <iframe ref={viewer} tabIndex={0} className={`achievement-viewer ${selected === 1 ? "portrait" : ""}`} src={`/holo/${collectibleArt[selected].folder}/viewer.html?lang=${en ? "en" : "zh"}&v=${APP_VERSION}`} title={en ? "Interactive layered card" : "互动分层闪卡"}/>
      <p className="muted small">{en ? "Move your pointer or drag to rotate. Focus the card and use arrow keys. Reduced motion follows your device setting." : "移动鼠标或触摸拖动旋转；聚焦卡片后可用方向键。减少动态效果遵循设备设置。"}</p>
    </Modal>}
  </section>;
}
