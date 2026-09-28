"use client";
import { useState } from "react";
import type { Language, VocabularyWord } from "@/lib/types";
import { t } from "./workspace";

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
export function VocabularyQuiz({ words, lang, onReview }: { words: VocabularyWord[]; lang: Language; onReview: (word: VocabularyWord, known: boolean) => Promise<void> }) {
  const [queue, setQueue] = useState<{ word: VocabularyWord; choices: string[] }[]>([]);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [busy, setBusy] = useState(false);
  const definitions = [...new Set(words.map((word) => word.definition.trim()).filter(Boolean))];
  const current = queue[index];
  function start() {
    setQueue(shuffled(words.filter((word) => word.definition.trim())).slice(0, 10).map((word) => ({
      word, choices: shuffled([word.definition.trim(), ...shuffled(definitions.filter((definition) => definition !== word.definition.trim())).slice(0, 3)]),
    })));
    setIndex(0); setAnswer(null); setScore(0);
  }
  async function next() {
    if (!current || answer === null || busy) return;
    setBusy(true);
    try {
      const correct = answer === current.word.definition.trim();
      await onReview(current.word, correct);
      setScore((value) => value + Number(correct)); setIndex((value) => value + 1); setAnswer(null);
    } catch { /* Workspace displays the save error; keep this question available to retry. */ }
    finally { setBusy(false); }
  }
  return <section className="card quiz-card"><div className="card-top"><div><span className="eyebrow">QUICK QUIZ</span><h3>{t(lang, "词义测验", "Meaning quiz")}</h3></div><span className="muted small">{current ? `${index + 1} / ${queue.length}` : ""}</span></div>
    {current ? <><h4 className="quiz-term">{current.word.term}</h4><div className="quiz-choices">{current.choices.map((choice) => <button className={`button secondary ${answer === choice ? "selected" : ""}`} key={choice} disabled={answer !== null} onClick={() => setAnswer(choice)}>{choice}</button>)}</div>
    {answer !== null && <div role="status" className="quiz-result"><p>{answer === current.word.definition.trim() ? t(lang, "答对了", "Correct") : `${t(lang, "参考释义", "Meaning")}: ${current.word.definition}`}</p>{current.word.example && <p>{current.word.example}</p>}<button className="button primary" disabled={busy} onClick={() => void next()}>{t(lang, "保存复习结果并继续", "Save review and continue")}</button></div>}</> :
    <><p className="muted">{queue.length ? t(lang, `本次测验：${score} / ${queue.length}。复习间隔已根据答题结果更新。`, `Quiz: ${score} / ${queue.length}. Review intervals were updated.`) : t(lang, "从个人词表随机选取最多 10 个词。答对记为认识，答错记为不认识。", "Practise up to 10 words from your list. Correct means known; incorrect means not known.")}</p><button className="button secondary" disabled={definitions.length < 2} onClick={start}>{t(lang, queue.length ? "再测一次" : "开始测验", queue.length ? "Try again" : "Start quiz")}</button>{definitions.length < 2 && <p className="muted small">{t(lang, "添加至少两个不同释义的词后即可测验。", "Add at least two words with different meanings.")}</p>}</>}
  </section>;
}
