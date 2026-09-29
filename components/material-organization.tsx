"use client";
import { useEffect, useState, type ReactNode } from "react";
import type { Material, Language, WorkspaceData } from "@/lib/types";
import type { TrainingKind } from "@/lib/micro-training";
import { materialUnit, trainingNames } from "@/lib/micro-training";
import type { ViewActions } from "./views";
import { t } from "./workspace";
export interface MaterialVersion {
  id: string;
  material_id: string;
  revision: number;
  snapshot: Omit<Material, "owner_id">;
  created_at: string;
}
export const materialPath = (material: Material) =>
  [material.collection_title, material.set_title, material.part_title]
    .filter(Boolean)
    .join(" / ");
export function MaterialGroups({
  materials,
  lang,
  render,
}: {
  materials: Material[];
  lang: Language;
  render: (material: Material) => ReactNode;
}) {
  const groups = new Map<string, Material[]>();
  for (const material of materials) {
    const key = material.collection_title ?? "";
    groups.set(key, [...(groups.get(key) ?? []), material]);
  }
  return (
    <div className="material-groups">
      {[...groups]
        .sort(([a], [b]) => (a && b ? a.localeCompare(b) : a ? -1 : 1))
        .map(([collection, rows]) => {
          const sets = new Map<string, Material[]>();
          for (const row of rows) {
            const key = row.set_title ?? "";
            sets.set(key, [...(sets.get(key) ?? []), row]);
          }
          return (
            <section key={collection} className="material-collection">
              <h3>
                {collection || t(lang, "独立资料", "Independent materials")}{" "}
                <span className="muted small">{rows.length}</span>
              </h3>
              {[...sets]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([set, parts]) =>
                  !set ? (
                    <div key="independent">{parts.map(render)}</div>
                  ) : (
                    <details key={set} className="material-set" open>
                      <summary>
                        {set || t(lang, "未分组题组", "Ungrouped sets")} ·{" "}
                        {parts.length}
                      </summary>
                      {parts
                        .sort(
                          (a, b) =>
                            (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
                            (a.part_title ?? "").localeCompare(
                              b.part_title ?? "",
                            ) ||
                            a.title.localeCompare(b.title),
                        )
                        .map(render)}
                    </details>
                  ),
                )}
            </section>
          );
        })}
    </div>
  );
}
export function MaterialOrganizationEditor({
  material,
  lang,
  onChange,
}: {
  material: Partial<Material>;
  lang: Language;
  onChange: <K extends keyof Material>(key: K, value: Material[K]) => void;
}) {
  const kind = material.training_kind ?? "none";
  return (
    <fieldset className="organization-editor">
      <legend>
        {t(lang, "组织方式与训练用途", "Organisation and training purpose")}
      </legend>
      <div className="form-grid">
        <label>
          {t(lang, "合集（可选）", "Collection (optional)")}
          <input
            maxLength={160}
            value={material.collection_title ?? ""}
            onChange={(e) => onChange("collection_title", e.target.value)}
          />
        </label>
        <label>
          {t(lang, "题组（有合集时填写）", "Set (within collection)")}
          <input
            maxLength={160}
            value={material.set_title ?? ""}
            onChange={(e) => onChange("set_title", e.target.value)}
          />
        </label>
        <label>
          {t(lang, "部分（有题组时填写）", "Part (within set)")}
          <input
            maxLength={160}
            value={material.part_title ?? ""}
            onChange={(e) => onChange("part_title", e.target.value)}
          />
        </label>
        <label>
          {t(lang, "部分排序", "Part order")}
          <input
            type="number"
            min={0}
            max={9999}
            value={material.sort_order ?? 0}
            onChange={(e) => onChange("sort_order", Number(e.target.value))}
          />
        </label>
        <label>
          {t(lang, "资料用途", "Purpose")}
          <select
            value={kind}
            onChange={(e) => {
              const value = e.target.value as TrainingKind;
              onChange("training_kind", value);
              if (value !== "none") {
                onChange(
                  "skill",
                  value === "paraphrase"
                    ? "reading"
                    : value === "rewrite"
                      ? "writing"
                      : "speaking",
                );
                onChange("track", "academic");
              }
            }}
          >
            {Object.entries(trainingNames).map(([value, names]) => (
              <option key={value} value={value}>
                {names[lang === "zh" ? 0 : 1]}
              </option>
            ))}
          </select>
        </label>
        {kind !== "none" && (
          <>
            <label>
              {t(lang, "预计训练分钟", "Estimated minutes")}
              <input
                type="number"
                min={1}
                max={20}
                value={material.training_minutes ?? 5}
                onChange={(e) =>
                  onChange("training_minutes", Number(e.target.value))
                }
              />
            </label>
            <label>
              {t(
                lang,
                "关联反馈主题（逗号分隔）",
                "Feedback themes (comma separated)",
              )}
              <input
                value={(material.training_topics ?? []).join(",")}
                onChange={(e) =>
                  onChange(
                    "training_topics",
                    e.target.value
                      .split(/[,，]/)
                      .map((v) => v.trim())
                      .filter(Boolean),
                  )
                }
              />
            </label>
          </>
        )}
      </div>
      {kind !== "none" && (
        <p className="muted small">
          {t(
            lang,
            "微训练必须有来源和许可、参考表达、解释，以及选择项或逐项自评标准。完成后才进入微训练目录。",
            "Micro training needs source, permission, references, explanations and choices or self-check criteria before appearing in the catalogue.",
          )}
        </p>
      )}
    </fieldset>
  );
}
export function MicroQuestionFields({
  material,
  questionId,
  lang,
  onChange,
}: {
  material: Partial<Material>;
  questionId: string;
  lang: Language;
  onChange: <K extends keyof Material>(key: K, value: Material[K]) => void;
}) {
  const question = material.questions?.find((q) => q.id === questionId),
    kind = material.training_kind ?? "none";
  if (!question || kind === "none") return null;
  const field = kind === "paraphrase" ? "choices" : "checklist";
  return (
    <label>
      {kind === "paraphrase"
        ? t(
            lang,
            "选择项（每行一项，包含正确选项）",
            "Choices (one per line, include correct answer)",
          )
        : t(lang, "自评标准（每行一项）", "Self-check criteria (one per line)")}
      <textarea
        rows={3}
        value={(question[field] ?? []).join("\n")}
        onChange={(e) =>
          onChange(
            "questions",
            (material.questions ?? []).map((q) =>
              q.id === questionId
                ? { ...q, [field]: e.target.value.split("\n") }
                : q,
            ),
          )
        }
      />
    </label>
  );
}
export function materialIssues(
  material: Partial<Material>,
  lang: Language,
): string[] {
  const messages: string[] = [];
  if (!material.source_title?.trim() || !material.license_name?.trim())
    messages.push(t(lang, "来源或许可未补齐", "Missing source or permission"));
  if (material.set_title && !material.collection_title)
    messages.push(t(lang, "题组需归属合集", "Set needs a collection"));
  if (material.part_title && !material.set_title)
    messages.push(t(lang, "部分需归属题组", "Part needs a set"));
  if (material.training_kind && material.training_kind !== "none") {
    if (!materialUnit(material as Material))
      messages.push(
        t(
          lang,
          "微训练内容或完成标准不完整",
          "Incomplete micro training content or criteria",
        ),
      );
  } else if (
    (material.skill === "reading" || material.skill === "listening") &&
    !material.questions?.length
  )
    messages.push(t(lang, "还没有题目", "No questions yet"));
  if (material.skill === "listening" && !material.file_path)
    messages.push(t(lang, "还没有音频附件", "No audio attachment"));
  return messages;
}
export function MaterialHistory({
  material,
  data,
  actions,
  onCopy,
}: {
  material: Material;
  data: WorkspaceData;
  actions: ViewActions;
  onCopy: (copy: Partial<Material>) => void;
}) {
  const lang = data.profile.language,
    [rows, setRows] = useState<
      Pick<MaterialVersion, "id" | "revision" | "created_at">[]
    >([]),
    [preview, setPreview] = useState<MaterialVersion | null>(null),
    [status, setStatus] = useState(""),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [more, setMore] = useState(true);
  useEffect(() => {
    setRows([]);
    setPreview(null);
    setOpen(false);
    setMore(true);
    setStatus("");
  }, [material.id]);
  async function load(append = false) {
    setBusy(true);
    setStatus("");
    try {
      if (!actions.client) {
        const versions = (data.materialVersions ?? [])
          .filter((row) => row.material_id === material.id)
          .sort((a, b) => b.revision - a.revision);
        setRows(versions);
        setMore(false);
        return;
      }
      let query = actions.client
        .from("material_versions")
        .select("id,revision,created_at")
        .eq("material_id", material.id)
        .order("revision", { ascending: false })
        .limit(20);
      if (append && rows.length)
        query = query.lt("revision", rows.at(-1)!.revision);
      const result = await query;
      if (result.error) throw result.error;
      setRows((current) =>
        append ? [...current, ...result.data] : result.data,
      );
      setMore(result.data.length === 20);
    } catch {
      setStatus(
        t(
          lang,
          "版本记录加载失败，可以重试。",
          "Versions could not load. Retry.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  async function inspect(revision: number) {
    setBusy(true);
    setStatus("");
    try {
      if (!actions.client) {
        setPreview(
          data.materialVersions?.find(
            (row) =>
              row.material_id === material.id && row.revision === revision,
          ) ?? null,
        );
        return;
      }
      const result = await actions.client
        .from("material_versions")
        .select("*")
        .eq("material_id", material.id)
        .eq("revision", revision)
        .single();
      if (result.error) throw result.error;
      setPreview(result.data);
    } catch {
      setStatus(
        t(
          lang,
          "该版本已删除或访问已撤销。",
          "Version deleted or access revoked.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details
      className="material-history"
      open={open}
      onToggle={(e) => {
        const value = e.currentTarget.open;
        setOpen(value);
        if (value && !rows.length && !busy) void load();
      }}
    >
      <summary>
        {t(lang, "版本历史", "Version history")} · {t(lang, "当前", "Current")}{" "}
        v{material.revision ?? 1}
      </summary>
      <p className="muted small">
        {t(
          lang,
          "每次实际修改创建新版本。历史版本只读；另存副本不会覆盖原资料。",
          "Content changes create a new version. History is read-only; saving a copy keeps the original.",
        )}
      </p>
      <div className="version-list">
        {rows.map((row) => (
          <button
            className="button secondary small"
            disabled={busy}
            key={row.id}
            onClick={() => void inspect(row.revision)}
          >
            v{row.revision} ·{" "}
            {new Date(row.created_at).toLocaleString(
              lang === "zh" ? "zh-CN" : "en-US",
            )}
          </button>
        ))}
      </div>
      {more && (
        <button
          className="text-link"
          disabled={busy}
          onClick={() => void load(true)}
        >
          {t(lang, "加载更早版本", "Load earlier versions")}
        </button>
      )}
      {status && (
        <p role="status">
          {status}
          <button className="text-link" onClick={() => void load()}>
            {t(lang, "重试", "Retry")}
          </button>
        </p>
      )}
      {preview && (
        <div className="version-preview">
          <h4>
            v{preview.revision} · {preview.snapshot.title}
          </h4>
          <p>
            {preview.snapshot.source_title} · {preview.snapshot.license_name}
          </p>
          <div className="snapshot-original">
            {preview.snapshot.prompt}
            <br />
            {preview.snapshot.passage || preview.snapshot.transcript}
            {preview.snapshot.questions.map((q) => (
              <div key={q.id}>
                <strong>{q.prompt}</strong>
                <p>{q.answers.join(" / ")}</p>
                <p>{q.explanation}</p>
              </div>
            ))}
          </div>
          {preview.snapshot.file_name && (
            <p className="muted small">
              {t(lang, "当时的附件：", "Historical attachment: ")}
              {preview.snapshot.file_name}
              {t(
                lang,
                "（历史仅追踪名称；旧附件不承诺可播放）",
                " (name tracked; old attachment playback is not guaranteed)",
              )}
            </p>
          )}
          {material.owner_id === data.profile.id && (
            <button
              className="button secondary small"
              disabled={busy}
              onClick={() => {
                if (
                  !window.confirm(
                    t(
                      lang,
                      "将这版文字与题目另存为私有资料？原附件不会复制，原资料不变。",
                      "Save this version's text and questions as a private copy? Attachments are not copied.",
                    ),
                  )
                )
                  return;
                const copy = {
                  ...preview.snapshot,
                  id: undefined,
                  owner_id: data.profile.id,
                  revision: undefined,
                  updated_at: undefined,
                  created_at: undefined,
                  title:
                    `${preview.snapshot.title} (v${preview.revision})`.slice(
                      0,
                      240,
                    ),
                  visibility: "private" as const,
                  approval: "approved" as const,
                  file_path: null,
                  file_name: null,
                  file_kind: null,
                };
                onCopy(copy);
              }}
            >
              {t(
                lang,
                "以此版另存私有副本",
                "Save this version as private copy",
              )}
            </button>
          )}
        </div>
      )}
    </details>
  );
}
