"use client";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/supabase";
import { normalizeTerm } from "@/lib/review";
import type { VocabularyWord, WorkspaceData } from "@/lib/types";
import type { ViewActions } from "./views";
import { t } from "./workspace";
export function SpellingPractice({
  words,
  data,
  actions,
}: {
  words: VocabularyWord[];
  data: WorkspaceData;
  actions: ViewActions;
}) {
  const lang = data.profile.language;
  const [queue, setQueue] = useState<VocabularyWord[]>([]),
    [index, setIndex] = useState(0),
    [input, setInput] = useState(""),
    [result, setResult] = useState<boolean | null>(null),
    [wrong, setWrong] = useState<string[]>([]),
    [done, setDone] = useState(false),
    [saved, setSaved] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const sessionId = useRef(crypto.randomUUID()),
    lock = useRef(false);
  const current = queue[index];
  useEffect(() => {
    const pending = queue.length > 0 && !saved;
    actions.registerPracticeGuard(
      async () =>
        !pending ||
        window.confirm(
          t(
            lang,
            "拼写练习尚未保存，放弃当前练习？",
            "Discard this unsaved spelling practice?",
          ),
        ),
    );
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (pending) e.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      actions.registerPracticeGuard(null);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [queue.length, saved, lang]);
  function start(list: VocabularyWord[]) {
    if (
      queue.length &&
      !saved &&
      !window.confirm(
        t(
          lang,
          "放弃当前拼写练习，开始新一轮？",
          "Discard this spelling practice and start again?",
        ),
      )
    )
      return;
    sessionId.current = crypto.randomUUID();
    setQueue(list.slice(0, 10));
    setIndex(0);
    setInput("");
    setResult(null);
    setWrong([]);
    setDone(false);
    setSaved(false);
    setMessage("");
  }
  function check() {
    if (!current || result !== null) return;
    const correct = normalizeTerm(input) === normalizeTerm(current.term);
    setResult(correct);
    if (!correct) setWrong((ids) => [...ids, current.id]);
  }
  async function save() {
    if (lock.current || saved) return;
    lock.current = true;
    setBusy(true);
    try {
      if (!actions.client) {
        await actions.upsert("spelling_sessions", "spellingSessions", {
          id: sessionId.current, owner_id: data.profile.id, total: queue.length,
          correct: queue.length - wrong.length, wrong_word_ids: wrong,
          created_at: new Date().toISOString(),
        });
      } else await apiFetch(actions.client, "/api/reviews", {
        method: "POST",
        body: JSON.stringify({
          action: "spelling",
          id: sessionId.current,
          total: queue.length,
          correct: queue.length - wrong.length,
          wrongWordIds: wrong,
        }),
      });
      await actions.refresh();
      setSaved(true);
      setMessage(
        t(
          lang,
          "拼写统计已保存，熟悉度和复习间隔保持原值",
          "Spelling summary saved. Familiarity and review intervals are preserved",
        ),
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "保存失败 / Save failed");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const previous = data.spellingSessions?.[0];
  return (
    <section className="card spelling-practice">
      <div className="card-top">
        <div>
          <h3>{t(lang, "主动拼写", "Recall the spelling")}</h3>
          <p className="muted small">
            {t(
              lang,
              "根据释义写出词汇。当前场景筛选同样适用于拼写；拼写结果和“认识/不认识”独立。",
              "Spell a word from its meaning. Uses the current tag filter; spelling is separate from familiarity.",
            )}
          </p>
        </div>
        <button
          className="button secondary small"
          disabled={!words.length || busy}
          onClick={() =>
            start([...words].sort((a, b) => a.due_at.localeCompare(b.due_at)))
          }
        >
          {t(lang, "开始 10 词练习", "Practice up to 10 words")}
        </button>
      </div>
      {!queue.length ? (
        <p className="empty-text">
          {words.length
            ? t(
                lang,
                "点击开始，优先练习待复习词。",
                "Start with words due for review.",
              )
            : t(
                lang,
                "这个筛选下没有词汇，请先添加词或切换标签。",
                "No words in this filter. Add words or change tags.",
              )}
          {previous &&
            ` ${t(lang, "最近拼写", "Latest spelling")}: ${previous.correct}/${previous.total}`}
        </p>
      ) : done ? (
        <div className="spelling-summary">
          <h4>
            {t(lang, "本轮总结", "Session summary")}:{" "}
            {queue.length - wrong.length}/{queue.length}
          </h4>
          {wrong.length ? (
            <ul>
              {queue
                .filter((w) => wrong.includes(w.id))
                .map((w) => (
                  <li key={w.id}>
                    <strong>{w.term}</strong> — {w.definition}
                  </li>
                ))}
            </ul>
          ) : (
            <p>{t(lang, "本轮全部拼写正确", "All words spelled correctly")}</p>
          )}
          <div className="button-row">
            <button
              className="button primary"
              disabled={busy || saved}
              onClick={() => void save()}
            >
              {saved
                ? t(lang, "统计已保存", "Summary saved")
                : t(lang, "保存拼写统计", "Save spelling summary")}
            </button>
            {wrong.length > 0 && (
              <button
                className="button secondary"
                disabled={busy || !saved}
                onClick={() => start(queue.filter((w) => wrong.includes(w.id)))}
              >
                {t(lang, "再练错词", "Retry incorrect words")}
              </button>
            )}
          </div>
          {!saved && (
            <p className="muted small">
              {t(
                lang,
                "离开前请保存统计。写出的答案不会存入云端。",
                "Save the summary before leaving. Typed answers are not stored in the cloud.",
              )}
            </p>
          )}
        </div>
      ) : (
        <form
          className="form-stack spelling-card"
          onSubmit={(e) => {
            e.preventDefault();
            check();
          }}
        >
          <span className="muted small">
            {index + 1}/{queue.length}
          </span>
          <strong>{current.definition}</strong>
          <label>
            {t(lang, "拼写答案", "Spell the word")}
            <input
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              value={input}
              disabled={result !== null}
              onChange={(e) => setInput(e.target.value)}
              maxLength={160}
            />
          </label>
          {result === null ? (
            <button
              className="button primary"
              disabled={!input.trim()}
              type="submit"
            >
              {t(lang, "检查拼写", "Check spelling")}
            </button>
          ) : (
            <>
              <p
                role="status"
                className={result ? "spelling-correct" : "spelling-incorrect"}
              >
                {result
                  ? t(lang, "拼写正确", "Correct spelling")
                  : t(lang, "正确拼写：", "Correct spelling: ") + current.term}
              </p>
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  if (index + 1 >= queue.length) setDone(true);
                  else {
                    setIndex(index + 1);
                    setInput("");
                    setResult(null);
                  }
                }}
              >
                {index + 1 >= queue.length
                  ? t(lang, "查看总结", "View summary")
                  : t(lang, "下一个词", "Next word")}
              </button>
            </>
          )}
        </form>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
