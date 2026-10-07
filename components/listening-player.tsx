"use client";
import { useEffect, useRef, useState } from "react";
import type { Language } from "@/lib/types";
import { InlineMessage } from "./learning-ui";

export function ListeningPlayer({ src, language, onStatus, onRetry }: {
  src: string; language: Language; onStatus?: (ready: boolean) => void; onRetry?: () => void;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [failed, setFailed] = useState(false), [retry, setRetry] = useState(0);
  const [speed, setSpeed] = useState(1), [loop, setLoop] = useState(false);
  const label = (zh: string, en: string) => language === "zh" ? zh : en;
  useEffect(() => { setFailed(false); }, [src]);
  return <div className="listening-controls">
    <audio ref={audio} key={`${src}:${retry}`} controls src={src} loop={loop} preload="metadata" className="audio-player"
      aria-label={label("练习录音", "Practice recording")}
      onLoadedMetadata={event => { event.currentTarget.playbackRate = speed; setFailed(false); onStatus?.(true); }}
      onError={() => { setFailed(true); onStatus?.(false); }} />
    {failed && <InlineMessage error><p>{label("音频未能载入，可能是网络中断、链接过期或格式不受支持。", "Audio could not load. Check your connection; the link may have expired or the format may be unsupported.")}</p>
      <button className="button secondary" onClick={() => { setFailed(false); onStatus?.(false); setRetry(value => value + 1); onRetry?.(); }}>{label("重试加载音频", "Retry audio")}</button></InlineMessage>}
    <label>{label("播放速度", "Playback speed")}<select value={speed} onChange={event => { const value = Number(event.target.value); setSpeed(value); if (audio.current) audio.current.playbackRate = value; }}>{[.75,1,1.25,1.5,2].map(value => <option key={value} value={value}>{value}×</option>)}</select></label>
    <label className="checkbox-label"><input type="checkbox" checked={loop} onChange={event => setLoop(event.target.checked)}/>{label("循环播放", "Loop audio")}</label>
  </div>;
}
