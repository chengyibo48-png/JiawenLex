"use client";
import { useEffect, useState } from "react";
import type { Material, Language } from "@/lib/types";
import type { ViewActions } from "./views";
import { t } from "./workspace";
export function ResponsePrompt({
  material,
  revision,
  actions,
  lang,
}: {
  material: Material;
  revision: number;
  actions: ViewActions;
  lang: Language;
}) {
  const [prompt, setPrompt] = useState<{ body: string; title: string } | null>(
      null,
    ),
    [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    setPrompt(null);
    setError(false);
    if (revision === (material.revision ?? 1)) {
      setPrompt({ body: material.prompt, title: material.title });
      return;
    }
    if (!actions.client) {
      setError(true);
      return;
    }
    void actions.client
      .from("material_versions")
      .select("snapshot")
      .eq("material_id", material.id)
      .eq("revision", revision)
      .single()
      .then((result) => {
        if (!active) return;
        if (result.error) setError(true);
        else
          setPrompt({
            body: result.data.snapshot.prompt,
            title: result.data.snapshot.title,
          });
      });
    return () => {
      active = false;
    };
  }, [material.id, material.revision, revision, actions.client]);
  return (
    <div>
      <span className="soft-tag">
        {t(lang, "本次题目版本", "Prompt version")} v{revision}
      </span>
      {revision !== (material.revision ?? 1) && (
        <p className="muted small">
          {t(
            lang,
            "当前资料已更新；本次继续使用草稿或开始时的题目版本。",
            "Material was updated; this attempt retains the draft's or starting prompt version.",
          )}
        </p>
      )}
      {prompt ? (
        <>
          <h4>{prompt.title}</h4>
          <p>{prompt.body}</p>
        </>
      ) : (
        <p role="status">
          {error
            ? t(
                lang,
                "旧题目版本暂时不可访问，原作答仍保留。",
                "Historical prompt is unavailable; your response is retained.",
              )
            : t(lang, "正在加载当时的题目…", "Loading the original prompt…")}
        </p>
      )}
    </div>
  );
}
