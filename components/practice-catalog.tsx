"use client";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Clock3,
  Headphones,
  Mic,
  Search,
} from "lucide-react";
import { hasLearningActivity } from "@/lib/learning-flow";
import { answeredCount, estimateMinutes, hasListeningAudio, practiceMaterials } from "@/lib/practice-sessions";
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
  const [origin,setOrigin]=useState("");

  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [skill, search, type, tag, status, origin, collection]);
  const all = useMemo(() => practiceMaterials(data).filter(
    (m) =>
      m.skill === skill && (skill !== "listening" || hasListeningAudio(m)) && (!m.training_kind || m.training_kind === "none"),
  ), [data.materials, data.shares, data.profile.id, skill]);
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
  const latestByMaterial = useMemo(() => {
    const index = new Map<string, WorkspaceData["attempts"][number]>();
    for (const attempt of data.attempts) {
      if (attempt.owner_id !== data.profile.id || !attempt.material_id) continue;
      const previous = index.get(attempt.material_id);
      if (!previous || attempt.submitted_at > previous.submitted_at) index.set(attempt.material_id, attempt);
    }
    return index;
  }, [data.attempts, data.profile.id]);
  const activeByMaterial = useMemo(() => new Map(actions.sessions.sessions.filter(hasLearningActivity).map(session => [session.material_id, session])), [actions.sessions.sessions]);
  const latest = (id: string) => latestByMaterial.get(id);
  const active = (id: string) => activeByMaterial.get(id);
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
        (!origin || m.origin_kind === origin) &&
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
  const currentPage = Math.min(page, Math.max(1, Math.ceil(list.length / 40)));
  const pageRows = list.slice((currentPage - 1) * 40, currentPage * 40);
  const reset = () => {
    setSearch("");
    setType("");
    setTag("");
    setStatus("all");setOrigin("");
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
              setOrigin("");
              setType("");
              setTag("");
            }}
          >
            {t(lang, skillLabels[item].zh, skillLabels[item].en)}
          </button>
        ))}
      </div>
      <p className="notice info">{t(lang,({reading:"阅读题保留完整文章；填空、选择与判断按原答案核对。",listening:"这里只展示配套录音的听力题。无录音资料仍保留在资料库和词汇模块。",writing:"按 Task 1 / Task 2 选择；参考范文用于学习，作文不按唯一答案判错。",speaking:"按 Part 1 / Part 2 / Part 3 选择；可录音或填写回答，参考表达不作为唯一答案。"})[skill],({reading:"Read the full passage and answer by question type.",listening:"Only listening sets with recordings appear here. Text-only content remains in the library and vocabulary module.",writing:"Choose Task 1 or Task 2. Sample responses are references, not unique answers.",speaking:"Choose Part 1, 2 or 3. Record or type a response; samples are not unique answers."})[skill])}</p>
      {(search || type || tag || origin || collection || status !== "all") && <button className="button secondary" onClick={reset}>{t(lang,"清除全部筛选","Clear all filters")}</button>}
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
            {[type, tag, origin, status !== "all" ? status : ""].filter(Boolean)
              .length > 0 && (
              <span className="approval-pill">
                {
                  [type, tag, origin, status !== "all" ? status : ""].filter(Boolean)
                    .length
                }
              </span>
            )}
          </summary>
          <div className="catalog-filter-fields">
            <label>{t(lang,"内容来源","Origin")}<select value={origin} onChange={e=>setOrigin(e.target.value)}><option value="">{t(lang,"全部来源","All origins")}</option><option value="source">{t(lang,"资料原题","Source questions")}</option><option value="adapted">{t(lang,"改编练习","Adapted exercises")}</option></select></label>

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
          materials={pageRows}
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
                    {material.origin_kind && <span className="approval-pill">{material.origin_kind === "source" ? t(lang,"资料原题","Source questions") : material.origin_kind === "adapted" ? t(lang,"改编练习","Adapted exercises") : t(lang,"原题与改编","Mixed origins")}</span>}
                    <small>
                      {materialPath(material)} · v{material.revision ?? 1}
                    </small>
                    <span className="approval-pill">
                      {label(state(material.id))}
                    </span>
                  </span>
                  <small>
                    {t(lang,skillLabels[material.skill].zh,skillLabels[material.skill].en)} · {material.questions.length > 0 && material.questions.every(q => q.verified) ? t(lang,"✓ 原资料已核验","✓ Source verified") : t(lang,"待核验","Verification pending")} · {material.skill === "listening" ? (hasListeningAudio(material) ? t(lang,"音频可用","Audio available") : t(lang,"无音频","No audio")) : t(lang,"文本作答","Text response")} · {material.question_type ||
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
                        answeredCount(progress, material)
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
          {pageRows.map((material) => {
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
                      {material.origin_kind === "source" ? t(lang,"资料原题","Source questions") : material.origin_kind === "adapted" ? t(lang,"改编练习","Adapted exercises") : material.origin_kind === "mixed" ? t(lang,"原题与改编","Mixed origins") : t(lang,"个人资料","Personal material")}
                    </span>
                    <span className="approval-pill">
                      {label(state(material.id))}
                    </span>
                  </span>
                  <small>
                    {t(lang,skillLabels[material.skill].zh,skillLabels[material.skill].en)} · {material.questions.length > 0 && material.questions.every(q => q.verified) ? t(lang,"✓ 原资料已核验","✓ Source verified") : t(lang,"待核验","Verification pending")} · {material.skill === "listening" ? (hasListeningAudio(material) ? t(lang,"音频可用","Audio available") : t(lang,"无音频","No audio")) : t(lang,"文本作答","Text response")} · {material.question_type ||
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
                        answeredCount(progress, material)
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
      {list.length > 40 && <div className="button-row">
        <button className="button secondary" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>{t(lang,"上一页","Previous")}</button>
        <span>{currentPage} / {Math.ceil(list.length / 40)} · {list.length} {t(lang,"组练习","sets")}</span>
        <button className="button secondary" disabled={currentPage * 40 >= list.length} onClick={() => setPage(currentPage + 1)}>{t(lang,"下一页","Next")}</button>
      </div>}
    </>
  );
}