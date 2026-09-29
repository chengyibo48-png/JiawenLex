"use client";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/supabase";
import { materialStamp } from "@/lib/practice-sessions";
import { validSegments } from "@/lib/review";
import type { Material, WorkspaceData } from "@/lib/types";
import type { ViewActions } from "./views";
import { t } from "./workspace";
export function IntensiveListening({
  material,
  url,
  data,
  actions,
  onGuard,
  onExpose,
}: {
  material: Material;
  url: string | null;
  data: WorkspaceData;
  actions: ViewActions;
  onGuard: (guard: (() => Promise<boolean>) | null) => void;
  onExpose: () => void;
}) {
  const lang = data.profile.language,
    audio = useRef<HTMLAudioElement>(null),
    playedMs = useRef(0),
    playing = useRef(false),
    lastTick = useRef<number | null>(null),
    attemptId = useRef(crypto.randomUUID()),
    lock = useRef(false),
    everTranscript = useRef(false);
  const [duration, setDuration] = useState(0),
    [position, setPosition] = useState(0),
    [seconds, setSeconds] = useState(0),
    [speed, setSpeed] = useState(1),
    [a, setA] = useState<number | null>(null),
    [b, setB] = useState<number | null>(null),
    [repeat, setRepeat] = useState(false),
    [segmentIndex, setSegmentIndex] = useState(-1),
    [transcript, setTranscript] = useState(false),
    [shortcuts, setShortcuts] = useState(false),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false),
    [message, setMessage] = useState("");
  const segments = validSegments(material.audio_segments ?? [], duration);
  function settle(nextPlaying?: boolean) {
    const now = performance.now();
    if (lastTick.current !== null)
      playedMs.current += Math.max(0, now - lastTick.current);
    if (nextPlaying !== undefined) playing.current = nextPlaying;
    lastTick.current =
      playing.current &&
      audio.current &&
      !audio.current.paused &&
      !audio.current.ended &&
      document.visibilityState !== "hidden" &&
      !saved
        ? now
        : null;
    setSeconds(Math.floor(playedMs.current / 1000));
  }
  const settleRef = useRef(settle);
  settleRef.current = settle;
  useEffect(() => {
    const id = setInterval(() => settleRef.current(), 500);
    const visibility = () => settleRef.current();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  const guard = async () => {
    audio.current?.pause();
    settle();
    return (
      saved ||
      playedMs.current < 1000 ||
      window.confirm(
        t(
          lang,
          "精听尚未记录完成。离开会放弃本次用时，题目作答仍会保留。继续离开？",
          "This listening session is not saved. Discard its elapsed time and leave? Question answers remain saved.",
        ),
      )
    );
  };
  useEffect(() => {
    onGuard(guard);
    return () => onGuard(null);
  });
  useEffect(() => {
    if (saved || seconds < 1) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [seconds, saved]);
  const selectSegment = (index: number) => {
    const s = segments[index];
    if (!s || !audio.current) return;
    audio.current.currentTime = s.start;
    setSegmentIndex(index);
    setA(s.start);
    setB(s.end);
    setRepeat(true);
    setMessage("");
  };
  useEffect(() => {
    if (!shortcuts) return;
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const target = e.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        target?.closest("input,textarea,select,button,a,[role='dialog']")
      )
        return;
      const node = audio.current;
      if (!node || saved) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (node.paused)
          void node
            .play()
            .catch(() =>
              setMessage(
                t(
                  lang,
                  "请点击音频播放器开始播放",
                  "Start playback using the audio controls",
                ),
              ),
            );
        else node.pause();
      }
      if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
        e.preventDefault();
        node.currentTime = Math.max(
          0,
          Math.min(
            node.duration,
            node.currentTime + (e.code === "ArrowRight" ? 5 : -5),
          ),
        );
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shortcuts, saved, lang]);
  async function finish() {
    if (lock.current || saved) return;
    audio.current?.pause();
    settle();
    if (playedMs.current < 1000) {
      setMessage(
        t(
          lang,
          "请先播放音频再记录精听完成",
          "Play the audio before recording completion",
        ),
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    try {
      if (!actions.client) {
        await actions.upsert("practice_attempts", "attempts", {
          id: attemptId.current, owner_id: data.profile.id, material_id: material.id,
          material_revision: material.revision ?? 1, skill: "listening", mode: "practice",
          duration_seconds: Math.floor(playedMs.current / 1000), learning_kind: "intensive",
          answer_exposed: everTranscript.current, correct_count: null, question_count: null,
          answer_body: null, feedback: null, transcript: null, recording_path: null,
          saved_recording: false, question_stats: [], submitted_at: new Date().toISOString(), purged_at: null,
        });
      } else await apiFetch(actions.client, "/api/learning", {
        method: "POST",
        body: JSON.stringify({
          id: attemptId.current,
          materialId: material.id,
          materialStamp: materialStamp(material),
          mode: "practice",
          durationSeconds: Math.floor(playedMs.current / 1000),
          intensive: true,
          answerExposed: everTranscript.current,
        }),
      });
      await actions.refresh();
      setSaved(true);
      setMessage(
        t(
          lang,
          "精听已记录；仅计入精听用时，不生成题目正确率",
          "Intensive listening saved separately, without an answer accuracy score",
        ),
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "保存失败 / Save failed");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const validLoop =
    a !== null && b !== null && a >= 0 && b > a && b <= duration;
  return (
    <section className="card intensive-listening">
      <div className="card-top">
        <div>
          <h3>{t(lang, "精听工作台", "Intensive listening")}</h3>
          <p className="muted small">
            {t(
              lang,
              "播放、停顿、再听；题目作答保留在原会话中。只记录页面可见时的实际播放用时。",
              "Pause and listen again. Question answers remain in their session. Time records playback while this page is visible.",
            )}
          </p>
        </div>
        <span className="timer-pill">
          {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
        </span>
      </div>
      {url ? (
        <audio
          ref={audio}
          controls
          className="audio-player"
          src={url}
          onLoadedMetadata={(e) => {
            setDuration(e.currentTarget.duration);
            e.currentTarget.playbackRate = speed;
          }}
          onPlay={(event) => {
            if (saved || busy) event.currentTarget.pause();
          }}
          onPlaying={(event) => {
            if (saved || busy) event.currentTarget.pause();
            else settle(true);
          }}
          onPause={() => settle(false)}
          onWaiting={() => settle(false)}
          onSeeking={() => settle(false)}
          onEnded={() => {
            settle(false);
            if (repeat && validLoop && audio.current && !saved) {
              audio.current.currentTime = a!;
              void audio.current
                .play()
                .catch(() =>
                  setMessage(
                    t(
                      lang,
                      "请点击播放器继续循环",
                      "Use the player to resume looping",
                    ),
                  ),
                );
            }
          }}
          onError={() =>
            setMessage(
              t(
                lang,
                "音频加载失败，可返回题目后重新打开或检查附件。",
                "Audio failed to load. Reopen the material or check its attachment.",
              ),
            )
          }
          onTimeUpdate={(e) => {
            const node = e.currentTarget;
            setPosition(node.currentTime);
            if (
              repeat &&
              validLoop &&
              (node.currentTime >= b! || node.currentTime < a!)
            )
              node.currentTime = a!;
          }}
        />
      ) : (
        <p className="empty-text">
          {t(
            lang,
            "未找到可播放音频，请在资料库添加授权音频附件。",
            "Add an authorised audio attachment in the library.",
          )}
        </p>
      )}
      <div className="audio-tools">
        <label>
          {t(lang, "播放速度", "Playback speed")}
          <select
            value={speed}
            disabled={saved || busy}
            onChange={(e) => {
              const value = Number(e.target.value);
              setSpeed(value);
              if (audio.current) audio.current.playbackRate = value;
            }}
          >
            {[0.5, 0.75, 1, 1.25, 1.5].map((v) => (
              <option value={v} key={v}>
                {v}×
              </option>
            ))}
          </select>
        </label>
        <button
          className="button secondary small"
          disabled={!duration || saved || busy}
          onClick={() => {
            setA(position);
            setSegmentIndex(-1);
            setRepeat(false);
          }}
        >
          {t(lang, "设 A 起点", "Set A")}: {a?.toFixed(1) ?? "—"}
        </button>
        <button
          className="button secondary small"
          disabled={!duration || a === null || saved || busy}
          onClick={() => {
            if (position <= a!) {
              setMessage(t(lang, "B 终点须晚于 A 起点", "B must come after A"));
              return;
            }
            setB(position);
            setSegmentIndex(-1);
          }}
        >
          {t(lang, "设 B 终点", "Set B")}: {b?.toFixed(1) ?? "—"}
        </button>
        <button
          className="button secondary small"
          aria-pressed={repeat}
          disabled={!validLoop || saved || busy}
          onClick={() => {
            setRepeat(!repeat);
            if (!repeat && audio.current) audio.current.currentTime = a!;
          }}
        >
          {repeat
            ? t(lang, "停止循环", "Stop looping")
            : t(lang, "A/B 循环", "A/B loop")}
        </button>
      </div>
      {segments.length > 0 ? (
        <>
          <div className="button-row">
            <button
              className="button secondary small"
              disabled={segmentIndex <= 0 || saved}
              onClick={() => selectSegment(segmentIndex - 1)}
            >
              {t(lang, "上一段", "Previous segment")}
            </button>
            <button
              className="button secondary small"
              disabled={segmentIndex >= segments.length - 1 || saved}
              onClick={() => selectSegment(segmentIndex + 1)}
            >
              {t(lang, "下一段", "Next segment")}
            </button>
          </div>
          <div className="audio-segments">
            {segments.map((s, i) => (
              <button
                disabled={saved}
                key={s.id}
                className={`audio-segment ${i === segmentIndex ? "active" : ""}`}
                onClick={() => selectSegment(i)}
              >
                <span>
                  {s.start.toFixed(1)}–{s.end.toFixed(1)}s
                </span>
                {transcript
                  ? s.text
                  : t(lang, `片段 ${i + 1}`, `Segment ${i + 1}`)}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="muted small">
          {t(
            lang,
            "没有有效的人工时间戳，当前使用整段音频。你可以手动设置 A/B，资料库支持标注分段。",
            "No valid manual timestamps; using the full track. Set A/B yourself or annotate segments in the library.",
          )}
        </p>
      )}
      <div className="button-row">
        <button
          className="button secondary small"
          aria-expanded={transcript}
          onClick={() => {
            setTranscript(!transcript);
            if (!transcript) {
              everTranscript.current = true;
              onExpose();
            }
          }}
        >
          {transcript
            ? t(lang, "隐藏文字稿", "Hide transcript")
            : t(lang, "显示文字稿", "Show transcript")}
        </button>
        <label className="audio-shortcuts">
          <input
            type="checkbox"
            checked={shortcuts}
            onChange={(e) => setShortcuts(e.target.checked)}
          />
          {t(
            lang,
            "启用快捷键：空格播放/暂停，左右跳转 5 秒",
            "Shortcuts: Space play/pause, arrows seek 5s",
          )}
        </label>
      </div>
      {transcript && (
        <div className="snapshot-original">
          {material.transcript ||
            t(lang, "尚未添加文字稿", "No transcript supplied")}
        </div>
      )}
      <div className="button-row">
        <button
          className="button primary"
          disabled={busy || saved || !url}
          onClick={() => void finish()}
        >
          {busy
            ? t(lang, "保存中…", "Saving…")
            : saved
              ? t(lang, "已记录完成", "Completion saved")
              : t(lang, "记录本次精听完成", "Save listening completion")}
        </button>
        {saved && (
          <button
            className="button secondary"
            onClick={() => {
              attemptId.current = crypto.randomUUID();
              playedMs.current = 0;
              lastTick.current = null;
              setSeconds(0);
              setSaved(false);
              setMessage("");
            }}
          >
            {t(lang, "开始新一轮精听", "Start another listening session")}
          </button>
        )}
      </div>
      {message && (
        <p role="status" className="review-message">
          {message}
        </p>
      )}
    </section>
  );
}
