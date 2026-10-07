"use client";
import { useRef, useState } from "react";
import { Save } from "lucide-react";
import type { Language, Material } from "@/lib/types";
import { answeredCount, materialStamp, type PracticeSessionState } from "@/lib/practice-sessions";
import type { PracticeSessionManager } from "./use-practice-sessions";
import { t } from "./workspace";
export function PracticeSessionPanel({ material, manager, lang, onReload, onRestart, onRestore, notify }: {
  material: Material; manager: PracticeSessionManager; lang: Language;
  onReload: () => void; onRestart: () => Promise<void>; onRestore: (state: PracticeSessionState) => Promise<void>; notify: (message: string) => void;
}) {
  const [resolving, setResolving] = useState(false);
  const resolveLock = useRef(false);
  const [operationMessage, setOperationMessage] = useState("");
  async function operate(action: () => Promise<void>) {
    if (resolveLock.current) return;
    resolveLock.current = true; setResolving(true); setOperationMessage("");
    try { await action(); }
    catch (error) { setOperationMessage(error instanceof Error ? error.message : t(lang,"操作失败，当前输入保留","Operation failed; input retained")); }
    finally { resolveLock.current = false; setResolving(false); }
  }
  const row = manager.get(material.id), status = manager.status(material.id), conflict = manager.conflict(material.id);
  const changed = row?.state.phase === "active" && row.state.materialStamp !== materialStamp(material);
  const copies = manager.copies(material.id).flatMap((copy) => {
    try { const parsed = JSON.parse(copy.body); return parsed.state ? [{ ...copy, state: parsed.state as PracticeSessionState }] : []; } catch { return []; }
  });
  const attempt = async (choice: "cloud" | "local") => {
    if (resolveLock.current) return;
    resolveLock.current = true;
    setResolving(true);
    try { await manager.resolve(material.id, choice); onReload(); }
    catch { notify(t(lang, "副本未能保存，当前作答已保留。请重试。", "Could not archive the copy. Your answers are retained. Retry.")); }
    finally { resolveLock.current = false; setResolving(false); }
  };
  return <section className="session-panel" aria-label={t(lang, "答题存档", "Practice saving")}>
    <div className="session-save-row"><span className={`save-status ${status}`} role="status"><Save size={15} />{manager.loadError ? t(lang, "读取本机存档失败，请刷新后重试", "Could not read local progress. Reload to retry.") : !manager.ready ? t(lang, "正在恢复进度…", "Restoring progress…") : status === "saved" ? t(lang, row ? "答题进度已保存" : "开始后自动保存答题进度", row ? "Progress saved" : "Progress saves when you start") : status === "saving" ? t(lang, "正在保存…", "Saving…") : status === "local" ? t(lang, "本机加密暂存 · 待同步", "Encrypted on this device · awaiting sync") : status === "conflict" ? t(lang, "版本冲突 · 作答已保留", "Version conflict · answers retained") : t(lang, "本机保存失败，请保留当前页面", "Local saving failed; keep this page open")}</span>
      {(status === "local" || status === "error") && <button className="text-link" disabled={resolving} onClick={() => void operate(async () => { await manager.flush(material.id); setOperationMessage(t(lang,"✓ 答题进度已保存","✓ Progress saved")); })}>{t(lang, "重试同步", "Retry sync")}</button>}
    </div>
    {row?.state.phase === "active" && row.state.startedAt !== null && !changed && !conflict && <button className="text-link" disabled={resolving} onClick={() => void operate(onRestart)}>{t(lang, "保留副本并重新开始", "Keep a copy and start again")}</button>}
    {changed && <div className="conflict-box"><strong>{t(lang, "资料已更新，旧作答仍保留", "Material changed; previous answers retained")}</strong><p>{t(lang, "旧答案可能不再对应当前题目。开始新练习前会保留一份本机加密副本。", "Previous answers may no longer match. Starting again archives an encrypted copy.")}</p><details><summary>{t(lang, "查看原存档答案", "View previous answers")}</summary><pre className="draft-copy">{row!.state.questionIds.map((id, i) => `${i + 1}. ${row!.state.answers[id] || "—"}`).join("\n")}</pre></details><button className="button secondary small" disabled={!!conflict || resolving} onClick={() => void operate(onRestart)}>{t(lang, "保留副本并开始新练习", "Keep a copy and start again")}</button></div>}
    {conflict && <div className="conflict-box"><strong>{t(lang, "另一设备修改了这组练习", "This set changed on another device")}</strong><p>{t(lang, "请选择继续使用哪个版本。被替换的版本会保留为本机加密副本。", "Choose a version to continue. The replaced version is kept as an encrypted local copy.")}</p>
      <p className="small">{t(lang, "当前版本已答", "Current answers")}: {row ? answeredCount(row, changed ? undefined : material) : 0} · {t(lang, "云端版本已答", "Cloud answers")}: {conflict.cloud ? answeredCount(conflict.cloud, conflict.cloud.state.materialStamp === materialStamp(material) ? material : undefined) : 0}</p>
      <div className="button-row"><button className="button secondary small" disabled={resolving} onClick={() => void attempt("cloud")}>{t(lang, "保留副本并使用云端", "Keep a copy and use cloud")}</button><button className="button secondary small" disabled={resolving} onClick={() => void attempt("local")}>{t(lang, "保留副本并使用当前版本", "Keep a copy and use current")}</button></div>
    </div>}
    {operationMessage && <p role="status" className="learning-message">{operationMessage}</p>}
    {copies.length > 0 && <details className="session-copies"><summary>{t(lang, "已保留的版本", "Retained versions")} ({copies.length})</summary>{copies.map((copy) => <div className="session-copy" key={copy.revision}><p className="small muted">{new Date(copy.updatedAt).toLocaleString(lang === "zh" ? "zh-CN" : "en-US")}</p><pre className="draft-copy">{copy.state.questionIds.map((id, i) => `${i + 1}. ${copy.state.answers[id] || "—"}`).join("\n")}</pre><button className="button secondary small" disabled={!!conflict || changed || resolving} onClick={() => void operate(() => onRestore(copy.state))}>{t(lang, "恢复此版本", "Restore this version")}</button></div>)}</details>}
  </section>;
}
