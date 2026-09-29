"use client";
import { useMemo, useState } from "react";
import type { WorkspaceData } from "@/lib/types";
import { kindLabel, type LearningKind } from "@/lib/review";
import { skillLabels } from "@/lib/study";
import { t } from "./workspace";
export function LearningInsights({ data }: { data: WorkspaceData }) {
  const lang = data.profile.language,
    [perspective, setPerspective] = useState<LearningKind>("first");
  const own = data.attempts.filter((a) => a.owner_id === data.profile.id),
    objective = own.filter(
      (a) => a.skill === "reading" || a.skill === "listening",
    );
  const selected = objective.filter(
    (a) => (a.learning_kind ?? "legacy") === perspective,
  );
  const rows = useMemo(() => {
    const groups = new Map<
      string,
      {
        skill: "reading" | "listening";
        type: string;
        samples: number;
        count: number;
        correct: number;
        seconds: number;
      }
    >();
    for (const a of selected) {
      if (a.question_count === null) continue;
      for (const g of a.question_stats ?? []) {
        const key = `${a.skill}:${g.type}`,
          row = groups.get(key) ?? {
            skill: a.skill as "reading" | "listening",
            type: g.type,
            samples: 0,
            count: 0,
            correct: 0,
            seconds: 0,
          };
        row.samples++;
        row.count += g.count;
        row.correct += g.correct;
        row.seconds +=
          (a.duration_seconds * g.count) / Math.max(1, a.question_count);
        groups.set(key, row);
      }
    }
    return [...groups.values()];
  }, [data.attempts, perspective]);
  const intensive = objective.filter((a) => a.learning_kind === "intensive");
  const spelling = data.spellingSessions ?? [];
  return (
    <>
      <section className="card learning-insights">
        <div className="card-top">
          <div>
            <h3>
              {t(lang, "首次表现与复习表现", "First attempts and review")}
            </h3>
            <p className="muted small">
              {t(
                lang,
                "看过答案或文字稿后的练习单独显示；早期记录的模式未知。",
                "Answer or transcript exposure is analysed separately. Earlier records have unknown exposure.",
              )}
            </p>
          </div>
        </div>
        <div className="insight-perspectives">
          {(["first", "repeat", "review", "legacy"] as LearningKind[]).map(
            (k) => (
              <button
                key={k}
                aria-pressed={perspective === k}
                className={perspective === k ? "active" : ""}
                onClick={() => setPerspective(k)}
              >
                <span>{kindLabel(k, lang)}</span>
                <strong>
                  {
                    objective.filter((a) => (a.learning_kind ?? "legacy") === k)
                      .length
                  }
                </strong>
              </button>
            ),
          )}
        </div>
        <p className="muted small">
          {t(
            lang,
            `当前口径：${selected.length} 次练习，${selected.reduce((s, a) => s + (a.question_count ?? 0), 0)} 道题；只有至少 2 次、10 题才展示题型趋势。用时为题组用时按题数分摊，不代表逐题计时。`,
            `Current cohort: ${selected.length} attempts, ${selected.reduce((s, a) => s + (a.question_count ?? 0), 0)} questions. Trends require 2 attempts and 10 questions. Time is allocated from set duration, not measured per question.`,
          )}
        </p>
        {rows.length ? (
          <div className="type-stats">
            {rows.map((row) => (
              <div className="type-stat-row" key={`${row.skill}:${row.type}`}>
                <div>
                  <strong>
                    {skillLabels[row.skill][lang]} · {row.type}
                  </strong>
                  <small>
                    {t(
                      lang,
                      `${row.samples} 次 / ${row.count} 题`,
                      `${row.samples} attempts / ${row.count} questions`,
                    )}
                  </small>
                </div>
                <span>
                  {row.samples >= 2 && row.count >= 10
                    ? `${Math.round((row.correct / row.count) * 100)}% · ${(row.seconds / Math.max(1, row.count)).toFixed(0)} ${t(lang, "秒/题（估算）", "s/question (estimated)")}`
                    : t(lang, "继续练习以积累数据", "More practice needed")}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-text">
            {t(
              lang,
              "此口径暂时没有可分析的题型数据",
              "No question-type data for this cohort yet",
            )}
          </p>
        )}
      </section>
      <div className="two-column">
        <section className="card">
          <h3>{t(lang, "精听投入", "Intensive listening time")}</h3>
          <p>
            {intensive.length} {t(lang, "次完成", "completions")} ·{" "}
            {Math.round(
              intensive.reduce((s, a) => s + a.duration_seconds, 0) / 60,
            )}{" "}
            min
          </p>
          <p className="muted small">
            {t(
              lang,
              "精听用时独立统计，不参与客观题正确率。",
              "Listening time stays separate from objective answer accuracy.",
            )}
          </p>
        </section>
        <section className="card">
          <h3>{t(lang, "词汇拼写记录", "Spelling records")}</h3>
          <p>
            {spelling.length} {t(lang, "轮练习", "sessions")} ·{" "}
            {spelling.reduce((s, a) => s + a.correct, 0)}/
            {spelling.reduce((s, a) => s + a.total, 0)}{" "}
            {t(lang, "拼写正确", "spelled correctly")}
          </p>
          <p className="muted small">
            {t(
              lang,
              "拼写统计独立于词汇熟悉度；不推算雅思分数。",
              "Spelling stays separate from familiarity; no IELTS band estimate.",
            )}
          </p>
        </section>
      </div>
    </>
  );
}
