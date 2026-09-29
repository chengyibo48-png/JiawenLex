import type { Language } from "./types";
import { ProviderError, providerEndpoint } from "./provider-client";

export function providerFailureMessage(status: number, language: Language): string {
  const messages: Record<number, [string, string]> = {
    400: ["服务商拒绝了请求，请检查模型、Workspace ID 与密钥类型。", "The provider rejected the request. Check the model, workspace and key type."],
    401: ["API Key 无效或已撤销，请在个人设置中重新保存。", "The API key is invalid or revoked. Save a new key in settings."],
    402: ["服务商余额不足，请查看服务商账户余额。", "The provider balance is insufficient. Check your account balance."],
    403: ["服务商拒绝访问，请检查地域、业务空间、模型权限及可用额度。", "Access was denied. Check the region, workspace, model permissions and quota."],
    404: ["模型或业务空间地址不可用，请检查 Workspace ID 与地域。", "The model or workspace endpoint is unavailable. Check the workspace and region."],
    429: ["服务商请求过于频繁或额度受限，请稍后重试并查看控制台。", "The provider is rate limited or out of quota. Wait and check its console."],
  };
  const pair = messages[status] ?? ["服务商暂时不可用，请稍后重试。", "The provider is temporarily unavailable. Please try again later."];
  return pair[language === "zh" ? 0 : 1];
}

export function alibabaBaseUrl(workspaceId: string): string {
  return new URL(providerEndpoint("qwen", workspaceId).url).origin;
}

async function metadata(url: string, key: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Authorization: "Bearer " + key },
    redirect: "error", cache: "no-store", signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new ProviderError(response.status, "Provider metadata request failed");
  if (Number(response.headers.get("content-length") ?? 0) > 1_000_000) throw new ProviderError(502, "Oversized provider metadata");
  const text = await response.text();
  if (text.length > 1_000_000) throw new ProviderError(502, "Oversized provider metadata");
  try { return JSON.parse(text); }
  catch { throw new ProviderError(502, "Invalid provider metadata"); }
}

export async function checkProviderAccess(provider: string, workspaceId: string, key: string) {
  const model = provider === "qwen-asr" ? "paraformer-v2" : providerEndpoint(provider, workspaceId).model;
  if (provider === "deepseek") {
    const result = await metadata("https://api.deepseek.com/models", key) as { data?: { id?: unknown }[] };
    if (!Array.isArray(result.data) || !result.data.some((item) => item?.id === model)) throw new ProviderError(404, "Configured model is unavailable");
    let balanceAvailable: boolean | null = null;
    try {
      const balance = await metadata("https://api.deepseek.com/user/balance", key) as { is_available?: unknown };
      if (typeof balance.is_available === "boolean") balanceAvailable = balance.is_available;
    } catch { /* Model access can succeed while the balance endpoint is unavailable. */ }
    return { model, balanceAvailable, checkedAt: new Date().toISOString(), scope: "credentials-and-model-list" };
  }
  if (!["qwen", "qwen-asr"].includes(provider)) throw new ProviderError(400, "Unsupported provider");
  const url = new URL(alibabaBaseUrl(workspaceId) + "/api/v1/models");
  url.searchParams.set("model", model); url.searchParams.set("page_size", "1");
  const result = await metadata(url.toString(), key) as { success?: unknown; code?: unknown; output?: { models?: { model?: unknown }[] } };
  if (result.success === false || result.code || !Array.isArray(result.output?.models)) throw new ProviderError(502, "Invalid provider metadata");
  if (!result.output.models.some((item) => item?.model === model)) throw new ProviderError(404, "Configured model is unavailable");
  return { model, balanceAvailable: null, checkedAt: new Date().toISOString(), scope: "credentials-and-model-list" };
}
