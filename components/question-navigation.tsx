"use client";
import { Flag } from "lucide-react";
import { useRef } from "react";
import type { Language, Question } from "@/lib/types";
import { t } from "./workspace";
import { hasQuestionAnswer, questionNumber } from "@/lib/question-progress";
export function QuestionNavigation({ questions, answers, flagged, current, lang, onJump }: {
  questions: Question[]; answers: Record<string, string>; flagged: string[]; current: string | null; lang: Language; onJump: (id: string) => void;
}) {
  const mobileNav = useRef<HTMLDetailsElement>(null);
  const flaggedCount = questions.filter((q) => flagged.includes(q.id)).length;
  const answered = questions.filter((q) => hasQuestionAnswer(answers[q.id], q)).length;
  const numbers = () => <div className="question-buttons">{questions.map((q, i) => {
    const done = hasQuestionAnswer(answers[q.id], q), marked = flagged.includes(q.id);
    const number = questionNumber(q, i);
    return <button type="button" key={q.id} className={`question-jump ${done ? "answered" : ""} ${current === q.id ? "current" : ""}`}
      aria-current={current === q.id ? "step" : undefined}
      aria-label={`${t(lang, "第", "Question ")}${number}${t(lang, "题", "")}，${done ? t(lang, "已答", "answered") : t(lang, "未答", "unanswered")}${marked ? t(lang, "，稍后", ", flagged") : ""}`}
      onClick={() => { if (mobileNav.current) mobileNav.current.open = false; onJump(q.id); }}><span>{number}</span><small>{done ? t(lang, "已答", "Done") : t(lang, "未答", "Open")}</small>{marked && <Flag size={11} aria-hidden="true" />}</button>;
  })}</div>;
  return <div className="question-navigation">
    <div className="question-navigation-heading"><strong>{t(lang, "答题进度", "Answer progress")}</strong><span>{answered}/{questions.length} {t(lang, "已答", "answered")} · {flaggedCount} {t(lang, "稍后", "flagged")}</span></div>
    <nav className="desktop-question-nav" aria-label={t(lang, "题号导航", "Question navigation")}>{numbers()}</nav>
    <details ref={mobileNav} className="mobile-question-nav"><summary>{t(lang, "打开题号，定位未答题", "Open question navigator")}</summary><nav aria-label={t(lang, "手机题号导航", "Mobile question navigation")}>{numbers()}</nav></details>
  </div>;
}
