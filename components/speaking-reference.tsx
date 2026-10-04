"use client";
import { useEffect, useRef, useState } from "react";
import { t } from "./workspace";
import type { Language } from "@/lib/types";

/** Reference audio never counts as the member's response or successful recall. */
export function SpeakingReference({ url, transcript, lang, loading, onRetry }: {
  url: string | null; transcript: string; lang: Language; loading: boolean; onRetry: () => void;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [speed, setSpeed] = useState(1);
  const [failed, setFailed] = useState(false);
  const [showText, setShowText] = useState(false);
  const [repeat, setRepeat] = useState(false);
  useEffect(() => { setFailed(false); setShowText(false); setSpeed(1); setRepeat(false); }, [url, transcript]);
  return <section className="speaking-reference" aria-label={t(lang, "配套范读", "Reference recording")}>
    <h4>{t(lang, "配套范读与跟读", "Listen and shadow")}</h4>
    <p className="muted small">{t(lang, "先听范读，再录下自己的回答。播放范读不会计为已作答。", "Listen to the reference, then record your own response. Playback does not count as an answer.")}</p>
    {url && !failed ? <audio key={url} ref={audio} src={url} controls preload="metadata" loop={repeat} className="audio-player" onError={() => setFailed(true)} onLoadedMetadata={event => { event.currentTarget.playbackRate = speed; }} /> : <p role="status">{t(lang, loading && !failed ? "正在加载范读…" : "范读暂时无法播放，请重试；你的回答会保留。", loading && !failed ? "Loading reference…" : "Reference unavailable. Retry; your response is preserved.")}</p>}
    <div className="button-row">
      <label>{t(lang, "播放速度", "Playback speed")}<select value={speed} disabled={!url || failed} onChange={event => { const value = Number(event.target.value); setSpeed(value); if (audio.current) audio.current.playbackRate = value; }}>{[0.75,1,1.25,1.5].map(value => <option key={value} value={value}>{value}×</option>)}</select></label>
      <button type="button" className="button secondary small" disabled={!url || failed} onClick={() => { if (!audio.current) return; audio.current.currentTime = 0; void audio.current.play().catch(() => setFailed(true)); }}>{t(lang, "从头重播", "Replay")}</button>
      <button type="button" className="button secondary small" disabled={!url || failed} aria-pressed={repeat} onClick={() => setRepeat(value => !value)}>{t(lang, repeat ? "循环已开启" : "循环播放", repeat ? "Repeat on" : "Repeat")}</button>
      {(!url || failed) && <button type="button" className="button secondary small" onClick={onRetry}>{t(lang, "重新加载范读", "Reload reference")}</button>}
      {transcript.trim() && <button type="button" className="button secondary small" aria-expanded={showText} onClick={() => setShowText(value => !value)}>{t(lang, showText ? "隐藏范读文本" : "查看范读文本", showText ? "Hide reference text" : "Show reference text")}</button>}
    </div>
    {showText && <div className="speaking-reference-text">{transcript}</div>}
  </section>;
}
