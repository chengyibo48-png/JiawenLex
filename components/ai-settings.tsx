"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/lib/types";
import { apiFetch } from "@/lib/supabase";

type Kind = "text" | "asr";
type Config = {
  text: boolean; asr: boolean; provider: "deepseek" | "qwen";
  workspaceId: string; asrWorkspaceId: string;
  textUpdatedAt: string; asrUpdatedAt: string;
};
type Connection = { model: string; checkedAt: string; balanceAvailable: boolean | null };
const emptyConfig: Config = { text: false, asr: false, provider: "deepseek", workspaceId: "", asrWorkspaceId: "", textUpdatedAt: "", asrUpdatedAt: "" };

export function AiSettings({ draft, onChangeDraft, saving, onSavePreference, client, notify }: {
  draft: Profile; onChangeDraft: (profile: Profile) => void; saving: boolean;
  onSavePreference: () => Promise<void>; client: SupabaseClient | null; notify: (message: string) => void;
}) {
  const say = (zh: string, en: string) => draft.language === "zh" ? zh : en;
  const [config, setConfig] = useState<Config | null>(null);
  const [provider, setProvider] = useState<"deepseek" | "qwen">("deepseek");
  const [workspaceId, setWorkspaceId] = useState("");
  const [asrWorkspaceId, setAsrWorkspaceId] = useState("");
  const [keys, setKeys] = useState({ text: "", asr: "" });
  const [checks, setChecks] = useState<Partial<Record<Kind, Connection>>>({});
  const [messages, setMessages] = useState<Partial<Record<Kind, string>>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const lock = useRef(false);
  const loadGeneration = useRef(0);

  const loadConfig = useCallback(async () => {
    const generation = ++loadGeneration.current;
    if (!client) { setLoading(false); return; }
    setLoading(true); setLoadError(false);
    try {
      const result = await apiFetch(client, "/api/ai/config") as Config;
      if (generation !== loadGeneration.current) return;
      const saved = { ...emptyConfig, ...result };
      setConfig(saved); setProvider(saved.provider);
      setWorkspaceId(saved.workspaceId); setAsrWorkspaceId(saved.asrWorkspaceId);
      setChecks({}); setMessages({});
    } catch {
      if (generation === loadGeneration.current) setLoadError(true);
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void loadConfig();
    return () => { loadGeneration.current++; };
  }, [loadConfig]);

  const blocked = !client || !config || loading || busy !== null || saving;
  const textMatches = !!config?.text && config.provider === provider && (provider === "deepseek" || config.workspaceId === workspaceId.trim());
  const asrMatches = !!config?.asr && config.asrWorkspaceId === asrWorkspaceId.trim();

  function clearResult(kind: Kind) {
    setChecks((previous) => ({ ...previous, [kind]: undefined }));
    setMessages((previous) => ({ ...previous, [kind]: undefined }));
  }

  async function keyOperation(kind: Kind, action: "save" | "check" | "delete") {
    if (lock.current || blocked || !config) return;
    if (action === "delete" && !window.confirm(say("确定删除已保存的服务密钥？", "Delete the saved provider key?"))) return;
    const selectedProvider = kind === "asr" ? "qwen-asr" : provider;
    const selectedWorkspace = kind === "asr" ? asrWorkspaceId.trim() : provider === "qwen" ? workspaceId.trim() : "";
    const key = keys[kind].trim();
    if (action === "save" && !key) { setMessages((previous) => ({ ...previous, [kind]: say("请先粘贴 API Key。", "Paste the API key first.") })); return; }
    lock.current = true; setBusy(kind + ":" + action); clearResult(kind);
    try {
      if (action === "save") {
        const result = await apiFetch(client, "/api/ai/config", { method: "POST", body: JSON.stringify({ kind, provider: selectedProvider, workspaceId: selectedWorkspace, key }) }) as { updatedAt: string };
        setConfig((previous) => ({
          ...(previous ?? emptyConfig),
          ...(kind === "text" ? { text: true, provider, workspaceId: selectedWorkspace, textUpdatedAt: result.updatedAt }
            : { asr: true, asrWorkspaceId: selectedWorkspace, asrUpdatedAt: result.updatedAt }),
        }));
        setKeys((previous) => ({ ...previous, [kind]: "" }));
        const message = say("密钥已加密保存，接下来点击“检查连接”。", "Key saved securely. Next, check the connection.");
        setMessages((previous) => ({ ...previous, [kind]: message })); notify(message);
      } else if (action === "check") {
        const result = await apiFetch(client, "/api/ai/config", { method: "PATCH", body: JSON.stringify({
          kind, provider: selectedProvider, workspaceId: selectedWorkspace,
          updatedAt: kind === "text" ? config.textUpdatedAt : config.asrUpdatedAt,
        }) }) as Connection;
        setChecks((previous) => ({ ...previous, [kind]: result }));
      } else {
        await apiFetch(client, "/api/ai/config", { method: "DELETE", body: JSON.stringify({ kind }) });
        setConfig((previous) => ({ ...(previous ?? emptyConfig), [kind]: false, ...(kind === "text" ? { textUpdatedAt: "" } : { asrUpdatedAt: "" }) }));
        setKeys((previous) => ({ ...previous, [kind]: "" }));
        notify(say("密钥已删除。", "Key deleted."));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : say("操作失败，请稍后重试。", "The operation failed. Please try again.");
      setMessages((previous) => ({ ...previous, [kind]: message })); notify(message);
    } finally { lock.current = false; setBusy(null); }
  }

  function keyCard(kind: Kind) {
    const text = kind === "text", saved = !!config?.[kind], matches = text ? textMatches : asrMatches;
    const check = matches ? checks[kind] : undefined;
    const pendingKey = !!keys[kind].trim();
    const updatedAt = text ? config?.textUpdatedAt : config?.asrUpdatedAt;
    return (
      <div className="provider-box">
        <strong>{text ? say("文本反馈", "Text feedback") : say("录音转写", "Speech transcription")}</strong>
        <p className="muted small">{text ? say("写作和口语建议，不生成雅思分数。", "Writing and speaking advice, without IELTS scores.") : "阿里云百炼 Paraformer · paraformer-v2"}</p>
        {text && <label>{say("服务商", "Provider")}<select value={provider} disabled={blocked} onChange={(event) => { setProvider(event.target.value as typeof provider); clearResult("text"); }}>
          <option value="deepseek">DeepSeek</option><option value="qwen">阿里云百炼 Qwen</option>
        </select></label>}
        {(!text || provider === "qwen") && <label>{say("北京业务空间 Workspace ID", "Beijing Workspace ID")}<input
          value={text ? workspaceId : asrWorkspaceId} disabled={blocked} autoComplete="off" maxLength={80}
          onChange={(event) => { text ? setWorkspaceId(event.target.value) : setAsrWorkspaceId(event.target.value); clearResult(kind); }}
        /></label>}
        <label>API Key<input type="password" autoComplete="new-password" spellCheck={false} maxLength={500} disabled={blocked}
          value={keys[kind]} onChange={(event) => { setKeys((previous) => ({ ...previous, [kind]: event.target.value })); clearResult(kind); }}
          placeholder={matches ? say("已加密保存；输入新密钥可替换", "Saved securely; enter a new key to replace it") : "sk-…"}
        /></label>
        <p className="muted small">
          {saved ? (matches ? say("已有密钥已加密保存。", "A key is saved securely.") : say("当前选项尚未保存；实际调用仍使用之前保存的配置。", "These changes are unsaved. Calls still use the saved configuration."))
            : say("尚未配置密钥。", "No key configured.")}
          {pendingKey && " " + say("新输入的密钥尚未保存。", "The newly entered key is unsaved.")}
        </p>
        <div className="button-row">
          <button type="button" className="button secondary" disabled={blocked || !pendingKey} onClick={() => void keyOperation(kind, "save")}>
            {busy === kind + ":save" ? say("保存中…", "Saving…") : say("保存密钥", "Save key")}
          </button>
          <button type="button" className="button secondary" disabled={blocked || !matches || pendingKey || !updatedAt} onClick={() => void keyOperation(kind, "check")}>
            {busy === kind + ":check" ? say("检查中…", "Checking…") : say("检查连接", "Check connection")}
          </button>
          {saved && <button type="button" className="text-link danger-text" disabled={blocked} onClick={() => void keyOperation(kind, "delete")}>
            {busy === kind + ":delete" ? say("删除中…", "Deleting…") : say("删除已保存密钥", "Delete saved key")}
          </button>}
        </div>
        {messages[kind] && <p className="small" role="status">{messages[kind]}</p>}
        {check && <div className="ai-connection-result" role="status">
          <strong>{say("密钥与模型信息检查通过", "Key and model metadata check passed")}</strong>
          <p className="small">{check.model} · {new Date(check.checkedAt).toLocaleTimeString(draft.language === "zh" ? "zh-CN" : "en")}</p>
          {check.balanceAvailable === false && <p className="small">{say("DeepSeek 余额不足，实际生成需要先在服务商平台补足余额。", "DeepSeek reports insufficient balance. Check your provider balance before generating feedback.")}</p>}
          {text && provider === "deepseek" && check.balanceAvailable === null && <p className="small">{say("余额状态暂时无法查询，请在 DeepSeek 平台查看。", "Balance could not be checked. Review it on DeepSeek.")}</p>}
          <p className="muted small">{say("本次未发送作文或录音。实际生成权限、费用及转写效果仍需主动提交一次后确认。", "No essay or recording was sent. Verify generation permissions, billing and transcription with a submission.")}</p>
        </div>}
        <a className="text-link" href={text && provider === "deepseek" ? "https://platform.deepseek.com/" : "https://bailian.console.aliyun.com/"} target="_blank" rel="noopener noreferrer">
          {text && provider === "deepseek" ? say("打开 DeepSeek 获取密钥", "Get a DeepSeek key") : say("打开百炼获取北京空间与密钥", "Get a Beijing workspace and key")}
        </a>
      </div>
    );
  }

  return (
    <section className="card" aria-labelledby="ai-settings-title">
      <div className="card-top"><div>
        <h3 id="ai-settings-title">{say("AI 服务与预算", "AI providers and budget")}</h3>
        <p className="muted small">{say("每位成员配置自己的密钥。费用由你的服务商账号结算。", "Each member uses their own keys and provider billing account.")}</p>
      </div></div>
      <ol className="ai-setup-steps">
        <li>{say("在服务商平台创建 API Key", "Create an API key with your provider")}</li>
        <li>{say("保存密钥，然后检查连接", "Save the key and check its connection")}</li>
        <li>{say("设置预算，主动开启 AI", "Set your budget and enable AI")}</li>
      </ol>
      <p className="muted small">{say("检查连接只读取模型信息及可查询的余额状态；作文和录音仅在你确认提交时发送。百炼目前使用华北2（北京），Workspace ID 和 API Key 必须来自同一北京业务空间。", "Connection checks read model metadata and available balance status. Essays and recordings are sent only after you confirm a submission. Model Studio requires a workspace and API key from the same Beijing region.")}</p>
      {loading && <p role="status">{say("正在读取已保存配置…", "Loading saved configuration…")}</p>}
      {loadError && <div role="alert"><p>{say("无法读取配置，请重新加载后再操作。", "Configuration could not be loaded. Reload before making changes.")}</p>
        <button type="button" className="button secondary" disabled={loading || busy !== null} onClick={() => void loadConfig()}>{say("重新读取配置", "Reload configuration")}</button>
      </div>}
      {!client && <p>{say("演示模式不保存服务密钥，请登录真实账号后配置。", "Sign in to a live account to configure provider keys.")}</p>}
      <div className="provider-grid">{keyCard("text")}{keyCard("asr")}</div>
      <div className="ai-budget-settings">
        <h4>{say("月度预算与启用", "Monthly budget and activation")}</h4>
        <label>{say("月度预算（人民币）", "Monthly budget (CNY)")}<input type="number" min="1" max="9999999" step="1"
          value={draft.monthly_budget_cny ?? ""} disabled={saving || busy !== null}
          onChange={(event) => onChangeDraft({ ...draft, monthly_budget_cny: event.target.value ? Number(event.target.value) : null })} /></label>
        <p className="muted small">{say("可先设 10 元作为应用内估算阈值。接近预算会提醒，达到预算需再次确认；这不是服务商的硬性费用上限，最终以服务商账单为准。", "You can start with a CNY 10 estimate threshold. Near-budget reminders and confirmation at the threshold do not replace provider billing limits.")}</p>
        <label className="switch-row"><span>{say("启用 AI 反馈与转写", "Enable AI feedback and transcription")}</span><input type="checkbox"
          checked={draft.ai_enabled} disabled={saving || busy !== null}
          onChange={(event) => onChangeDraft({ ...draft, ai_enabled: event.target.checked })} /></label>
        <button type="button" className="button secondary" disabled={saving || busy !== null} onClick={() => void onSavePreference()}>
          {saving ? say("保存中…", "Saving…") : say("保存 AI 开关与预算", "Save AI preference")}
        </button>
      </div>
    </section>
  );
}
