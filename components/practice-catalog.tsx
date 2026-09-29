"use client";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Clock3,
  Headphones,
  Mic,
  Search,
} from "lucide-react";
import { estimateMinutes, practiceMaterials } from "@/lib/practice-sessions";
import { skillLabels, skills } from "@/lib/study";
import type { Material, Skill, WorkspaceData } from "@/lib/types";
import type { ViewActions } from "./views";
import { MaterialGroups, materialPath } from "./material-organization";
import { t } from "./workspace";

export function PracticeCatalog({
  data,
  actions,
  skill,
  onSkill,
  onSelect,
}: {
  data: WorkspaceData;
  actions: ViewActions;
  skill: Skill;
  onSkill: (skill: Skill) => void;
  onSelect: (material: Material) => void;
}) {
  const lang = data.profile.language;
  const [filtersOpen, setFiltersOpen] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width:850px)");
    const change = () => setFiltersOpen(!media.matches);
    change();
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  const [grouped, setGrouped] = useState(false);
  const [collection, setCollection] = useState("");
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [tag, setTag] = useState("");
  const [status, setStatus] = useState("all");
  const all = practiceMaterials(data).filter(
    (m) =>
      m.skill === skill && (!m.training_kind || m.training_kind === "none"),
  );
  const types = [
    ...new Set(
      all
        .flatMap((m) => [
          m.question_type,
          ...m.questions.map((q) => q.type ?? ""),
        ])
        .filter(Boolean),
    ),
  ].sort();
  const tags = [...new Set(all.flatMap((m) => m.tags))].sort();
  const latest = (id: string) =>
    data.attempts
      .filter((a) => a.owner_id === data.profile.id && a.material_id === id)
      .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))[0];
  const active = (id: string) =>
    actions.sessions.sessions.find((s) => s.material_id === id);
  const state = (id: string) =>
    active(id) ? "active" : latest(id) ? "done" : "new";
  const label = (value: string) =>
    value === "active"
      ? t(lang, "进行中", "In progress")
      : value === "done"
        ? t(lang, "已完成", "Completed")
        : t(lang, "未开始", "Not started");
  const list = all
    .filter(
      (m) =>
        [materialPath(m), m.title, m.question_type, m.tags.join(" "), m.prompt]
          .join(" ")
          .toLowerCase()
          .includes(search.trim().toLowerCase()) &&
        (!collection || m.collection_title === collection) &&
        (!type ||
          m.question_type === type ||
          m.questions.some((q) => q.type === type)) &&
        (!tag || m.tags.includes(tag)) &&
        (status === "all" || state(m.id) === status),
    )
    .sort((a, b) => {
      const aSession = active(a.id),
        bSession = active(b.id);
      if (!!aSession !== !!bSession) return aSession ? -1 : 1;
      const aDate = aSession?.updated_at ?? latest(a.id)?.submitted_at ?? "";
      const bDate = bSession?.updated_at ?? latest(b.id)?.submitted_at ?? "";
      return (
        bDate.localeCompare(aDate) || b.created_at.localeCompare(a.created_at)
      );
    });
  const reset = () => {
    setSearch("");
    setType("");
    setTag("");
    setStatus("all");
    setCollection("");
  };
  return (
    <>
      <div className="page-intro">
        <div>
          <h2>{t(lang, "找一组适合现在的练习", "Find your next practice")}</h2>
          <p>
            {t(
              lang,
              "继续未完成的题组，或按题型与标签选择。",
              "Resume a set or choose by question type and tag.",
            )}
          </p>
        </div>
      </div>
      <div className="skill-tabs">
        {skills.map((item) => (
          <button
            className={skill === item ? "active" : ""}
            key={item}
            aria-pressed={skill === item}
            onClick={() => {
              onSkill(item);
              setType("");
              setTag("");
            }}
          >
            {t(lang, skillLabels[item].zh, skillLabels[item].en)}
          </button>
        ))}
      </div>
      <div className="catalog-toolbar">
        <label className="search-field">
          <Search size={16} />
          <input
            aria-label={t(lang, "搜索练习", "Search practice")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t(
              lang,
              "搜索标题、题型或标签",
              "Search titles, types or tags",
            )}
          />
        </label>
        <details
          className="catalog-filters"
          open={filtersOpen}
          onToggle={(e) => setFiltersOpen(e.currentTarget.open)}
        >
          <summary>
            {t(lang, "筛选条件", "Filters")}
            {[type, tag, status !== "all" ? status : ""].filter(Boolean)
              .length > 0 && (
              <span className="approval-pill">
                {
                  [type, tag, status !== "all" ? status : ""].filter(Boolean)
                    .length
                }
              </span>
            )}
          </summary>
          <div className="catalog-filter-fields">
            <label>
              {t(lang, "题型", "Question type")}
              <select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">{t(lang, "全部题型", "All types")}</option>
                {types.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              {t(lang, "标签", "Tag")}
              <select value={tag} onChange={(e) => setTag(e.target.value)}>
                <option value="">{t(lang, "全部标签", "All tags")}</option>
                {tags.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              {t(lang, "练习状态", "Practice status")}
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="all">
                  {t(lang, "全部状态", "All statuses")}
                </option>
                {["active", "new", "done"].map((value) => (
                  <option key={value} value={value}>
                    {label(value)}
                  </option>
                ))}
              </select>
            </label>
            <button className="button secondary small" onClick={reset}>
              {t(lang, "清除筛选", "Clear filters")}
            </button>
          </div>
        </details>
        <label>
          {t(lang, "合集", "Collection")}
          <select
            value={collection}
            onChange={(e) => setCollection(e.target.value)}
          >
            <option value="">{t(lang, "全部合集", "All collections")}</option>
            {[
              ...new Set(all.map((m) => m.collection_title).filter(Boolean)),
            ].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <button
          className="button secondary small"
          aria-pressed={grouped}
          onClick={() => setGrouped(!grouped)}
        >
          {grouped ? t(lang, "列表", "List") : t(lang, "合集", "Collections")}
        </button>
        <span className="muted small" role="status">
          {list.length} {t(lang, "组练习", "sets")}
        </span>
      </div>
      {grouped ? (
        <MaterialGroups
          materials={list}
          lang={lang}
          render={(material) => {
            const progress = active(material.id),
              last = latest(material.id);
            return (
              <button
                className="practice-set card"
                key={material.id}
                onClick={() => onSelect(material)}
              >
                <span className={`practice-set-icon skill-${material.skill}`}>
                  {skill === "listening" ? (
                    <Headphones size={22} />
                  ) : skill === "speaking" ? (
                    <Mic size={22} />
                  ) : (
                    <BookOpen size={22} />
                  )}
                </span>
                <span>
                  <span className="catalog-card-top">
                    <strong>{material.title}</strong>
                    <small>
                      {materialPath(material)} · v{material.revision ?? 1}
                    </small>
                    <span className="approval-pill">
                      {label(state(material.id))}
                    </span>
                  </span>
                  <small>
                    {material.question_type ||
                      t(lang, "单项练习", "Skill practice")}{" "}
                    ·{" "}
                    {material.questions.length
                      ? `${material.questions.length} ${t(lang, "题", "questions")}`
                      : t(lang, "开放作答", "Open response")}
                  </small>
                  <small>
                    <Clock3 size={12} /> {t(lang, "预计", "About")}{" "}
                    {estimateMinutes(material)} min ·{" "}
                    {material.source_title ||
                      t(lang, "个人资料", "Personal material")}
                  </small>
                  {progress ? (
                    <small>
                      {t(lang, "已答", "Answered")}{" "}
                      {
                        progress.state.questionIds.filter((id) =>
                          progress.state.answers[id]?.trim(),
                        ).length
                      }
                      /{progress.state.questionIds.length} ·{" "}
                      {t(lang, "继续作答", "Resume")}
                    </small>
                  ) : (
                    last && (
                      <small>
                        {t(lang, "最近练习", "Last practised")}{" "}
                        {new Date(last.submitted_at).toLocaleDateString(
                          lang === "zh" ? "zh-CN" : "en-US",
                          { timeZone: data.profile.timezone },
                        )}
                      </small>
                    )
                  )}
                </span>
                <ArrowRight size={18} />
              </button>
            );
          }}
        />
      ) : (
        <div className="practice-list">
          {list.map((material) => {
            const progress = active(material.id),
              last = latest(material.id);
            return (
              <button
                className="practice-set card"
                key={material.id}
                onClick={() => onSelect(material)}
              >
                <span className={`practice-set-icon skill-${material.skill}`}>
                  {skill === "listening" ? (
                    <Headphones size={22} />
                  ) : skill === "speaking" ? (
                    <Mic size={22} />
                  ) : (
                    <BookOpen size={22} />
                  )}
                </span>
                <span>
                  <span className="catalog-card-top">
                    <strong>{material.title}</strong>
                    <span className="approval-pill">
                      {label(state(material.id))}
                    </span>
                  </span>
                  <small>
                    {material.question_type ||
                      t(lang, "单项练习", "Skill practice")}{" "}
                    ·{" "}
                    {material.questions.length
                      ? `${material.questions.length} ${t(lang, "题", "questions")}`
                      : t(lang, "开放作答", "Open response")}
                  </small>
                  <small>
                    <Clock3 size={12} /> {t(lang, "预计", "About")}{" "}
                    {estimateMinutes(material)} min ·{" "}
                    {material.source_title ||
                      t(lang, "个人资料", "Personal material")}
                  </small>
                  {progress ? (
                    <small>
                      {t(lang, "已答", "Answered")}{" "}
                      {
                        progress.state.questionIds.filter((id) =>
                          progress.state.answers[id]?.trim(),
                        ).length
                      }
                      /{progress.state.questionIds.length} ·{" "}
                      {t(lang, "继续作答", "Resume")}
                    </small>
                  ) : (
                    last && (
                      <small>
                        {t(lang, "最近练习", "Last practised")}{" "}
                        {new Date(last.submitted_at).toLocaleDateString(
                          lang === "zh" ? "zh-CN" : "en-US",
                          { timeZone: data.profile.timezone },
                        )}
                      </small>
                    )
                  )}
                </span>
                <ArrowRight size={18} />
              </button>
            );
          })}
        </div>
      )}
      {!list.length && (
        <div className="card empty-inline">
          <BookOpen size={25} />
          <strong>
            {t(
              lang,
              all.length ? "没有匹配的练习" : "这科还没有练习资料",
              all.length
                ? "No matching sets"
                : "No material for this skill yet",
            )}
          </strong>
          <p>
            {t(
              lang,
              "可清除筛选，或添加自创及有授权的资料。",
              "Clear filters or add original or authorised material.",
            )}
          </p>
          <div className="button-row">
            <button className="button secondary" onClick={reset}>
              {t(lang, "清除筛选", "Clear filters")}
            </button>
            <button
              className="button primary"
              onClick={() => actions.setView("library")}
            >
              {t(lang, "打开资料库", "Open library")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
