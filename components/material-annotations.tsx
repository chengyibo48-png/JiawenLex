"use client";
import type { Material, Question } from "@/lib/types";
import type { AudioSegment, Evidence } from "@/lib/review";
import { t } from "./workspace";
export function MaterialAnnotations({
  material,
  lang,
  onQuestions,
  onSegments,
}: {
  material: Partial<Material>;
  lang: "zh" | "en";
  onQuestions: (q: Question[]) => void;
  onSegments: (segments: AudioSegment[]) => void;
}) {
  const questions = material.questions ?? [],
    segments = material.audio_segments ?? [];
  const update = (qid: string, key: keyof Evidence, value: string) =>
    onQuestions(
      questions.map((q) =>
        q.id !== qid
          ? q
          : {
              ...q,
              evidence: {
                ...q.evidence,
                [key]:
                  key === "quote"
                    ? value
                    : value === ""
                      ? undefined
                      : Number(value),
              },
            },
      ),
    );
  const updateSegment = (id: string, key: keyof AudioSegment, value: string) =>
    onSegments(
      segments.map((s) =>
        s.id !== id
          ? s
          : { ...s, [key]: key === "text" ? value : Number(value) },
      ),
    );
  return (
    <details className="annotation-editor">
      <summary>
        {t(
          lang,
          "原文证据与人工听力分段（可选）",
          "Evidence and manual audio segments (optional)",
        )}
      </summary>
      <p className="muted small">
        {t(
          lang,
          "原文一行视为一段；时间戳单位为秒。只标注你核对过的证据，不会自动生成时间戳。",
          "Each passage line is a paragraph. Timestamps use seconds. Annotate verified evidence; timestamps are not generated automatically.",
        )}
      </p>
      {questions.map((q, i) => (
        <fieldset key={q.id}>
          <legend>
            {t(lang, `第 ${i + 1} 题证据`, `Question ${i + 1} evidence`)}
          </legend>
          <label>
            {t(
              lang,
              "原句引用（须出现在原文或文字稿）",
              "Exact quote from passage or transcript",
            )}
            <textarea
              rows={2}
              maxLength={4000}
              value={q.evidence?.quote ?? ""}
              onChange={(e) => update(q.id, "quote", e.target.value)}
            />
          </label>
          {material.skill === "reading" ? (
            <label>
              {t(lang, "段落序号", "Paragraph number")}
              <input
                type="number"
                min={1}
                step={1}
                value={q.evidence?.paragraph ?? ""}
                onChange={(e) => update(q.id, "paragraph", e.target.value)}
              />
            </label>
          ) : (
            <div className="form-grid">
              <label>
                {t(lang, "证据起点（秒）", "Evidence start (s)")}
                <input
                  type="number"
                  min={0}
                  step="0.1"
                  value={q.evidence?.start ?? ""}
                  onChange={(e) => update(q.id, "start", e.target.value)}
                />
              </label>
              <label>
                {t(lang, "证据终点（秒）", "Evidence end (s)")}
                <input
                  type="number"
                  min={0}
                  step="0.1"
                  value={q.evidence?.end ?? ""}
                  onChange={(e) => update(q.id, "end", e.target.value)}
                />
              </label>
            </div>
          )}
        </fieldset>
      ))}
      {material.skill === "listening" && (
        <>
          <h4>{t(lang, "人工分段", "Manual segments")}</h4>
          {segments.map((s, i) => (
            <fieldset key={s.id}>
              <legend>{t(lang, `片段 ${i + 1}`, `Segment ${i + 1}`)}</legend>
              <div className="form-grid">
                <label>
                  {t(lang, "起点（秒）", "Start (s)")}
                  <input
                    type="number"
                    min={0}
                    step="0.1"
                    value={s.start}
                    onChange={(e) =>
                      updateSegment(s.id, "start", e.target.value)
                    }
                  />
                </label>
                <label>
                  {t(lang, "终点（秒）", "End (s)")}
                  <input
                    type="number"
                    min={0}
                    step="0.1"
                    value={s.end}
                    onChange={(e) => updateSegment(s.id, "end", e.target.value)}
                  />
                </label>
              </div>
              <label>
                {t(lang, "片段文字（可选）", "Segment text (optional)")}
                <textarea
                  maxLength={8000}
                  rows={2}
                  value={s.text}
                  onChange={(e) => updateSegment(s.id, "text", e.target.value)}
                />
              </label>
              <button
                type="button"
                className="text-link danger-text"
                onClick={() =>
                  onSegments(segments.filter((x) => x.id !== s.id))
                }
              >
                {t(lang, "删除片段", "Remove segment")}
              </button>
            </fieldset>
          ))}
          <button
            type="button"
            disabled={segments.length >= 200}
            className="button secondary small"
            onClick={() =>
              onSegments([
                ...segments,
                {
                  id: crypto.randomUUID(),
                  start: segments.at(-1)?.end ?? 0,
                  end: (segments.at(-1)?.end ?? 0) + 5,
                  text: "",
                },
              ])
            }
          >
            {t(lang, "添加分段", "Add segment")}
          </button>
        </>
      )}
    </details>
  );
}
export function annotationError(material: Partial<Material>): string | null {
  const original =
    material.skill === "reading"
      ? (material.passage ?? "")
      : (material.transcript ?? "");
  for (const q of material.questions ?? []) {
    const e = q.evidence;
    if (!e) continue;
    if (e.quote && !original.includes(e.quote))
      return "原句引用必须出现在原文或文字稿 / Quote must exist in original text";
    if (
      e.paragraph !== undefined &&
      (!Number.isInteger(e.paragraph) ||
        e.paragraph < 1 ||
        e.paragraph > original.split("\n").length)
    )
      return "段落序号超出原文范围 / Invalid paragraph";
    if (
      (e.start !== undefined || e.end !== undefined) &&
      (!Number.isFinite(e.start) ||
        !Number.isFinite(e.end) ||
        e.start! < 0 ||
        e.end! <= e.start!)
    )
      return "证据终点必须晚于起点 / Evidence end must follow start";
  }
  if (
    (material.audio_segments ?? []).some(
      (s) =>
        !Number.isFinite(s.start) ||
        !Number.isFinite(s.end) ||
        s.start < 0 ||
        s.end <= s.start,
    )
  )
    return "分段终点必须晚于起点 / Segment end must follow start";
  return null;
}
