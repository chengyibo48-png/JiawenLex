"use client";

import { useId, useMemo, useState } from "react";
import type { Feedback, Language } from "@/lib/types";
import { annotationSegments, locateAnnotations } from "@/lib/writing-annotations";

export function AnnotatedResponse({ body, annotations, lang }: {
  body: string; annotations: Feedback["annotations"]; lang: Language;
}) {
  const id = useId();
  const [active, setActive] = useState(0);
  const [pane, setPane] = useState<"response" | "notes">("response");
  const ranges = useMemo(() => locateAnnotations(body, annotations), [body, annotations]);
  const segments = useMemo(() => annotationSegments(body, ranges), [body, ranges]);
  const located = new Set(ranges.map((range) => range.note));
  const text = (zh: string, en: string) => lang === "zh" ? zh : en;
  return <section className="annotated-response">
    <h4>{text("作答与批注", "Response and annotations")}</h4>
    <p className="muted small">{text("点击高亮文字查看对应建议。AI 建议需结合原文判断。", "Select highlighted text to see its note. Review AI suggestions against your answer.")}</p>
    <nav className="annotation-tabs" aria-label={text("批注视图", "Annotation view")}>
      <button aria-pressed={pane === "response"} onClick={() => setPane("response")}>{text("作答", "Response")}</button>
      <button aria-pressed={pane === "notes"} onClick={() => setPane("notes")}>{text("批注", "Notes")} ({annotations.length})</button>
    </nav>
    <div className="annotation-layout">
      <div className={`annotated-text annotation-pane-${pane}`} role="region" aria-label={text("已提交的作答", "Submitted response")}>
        {segments.map((segment, index) => segment.notes.length ? <button key={index}
          className={`annotation-highlight ${segment.notes.includes(active) ? "active" : ""}`}
          aria-label={`${text("查看批注", "View note")} ${segment.notes.map((note) => note + 1).join(", ")}: ${segment.text}`}
          aria-controls={segment.notes.map((note) => `${id}-note-${note}`).join(" ")}
          onClick={() => { setActive(segment.notes[0]); setPane("notes"); }}>
          {segment.text}
        </button> : segment.text)}
      </div>
      <ol className={`annotation-notes annotation-pane-${pane}`} aria-label={text("批注列表", "Annotation list")}>
        {annotations.map((note, index) => <li key={index} id={`${id}-note-${index}`} className={active === index ? "active" : ""}>
          <button className="annotation-selector" aria-pressed={active === index} onClick={() => setActive(index)}>
            {text("批注", "Note")} {index + 1}
          </button>
          <blockquote>{note.quote}</blockquote><p>{note.comment}</p>
          {!located.has(index) && <small className="muted">{text("未在原文定位到这段引用，请核对建议。", "This quote was not found in your answer. Check the suggestion.")}</small>}
        </li>)}
      </ol>
    </div>
  </section>;
}
