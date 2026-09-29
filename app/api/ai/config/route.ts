import { NextResponse } from "next/server";
import { z } from "zod";
import { encryptKey, decryptKey } from "@/lib/key-crypto";
import { apiError, HttpError, requireUser } from "@/lib/server-auth";
import { recordTombstone } from "@/lib/backup-ledger";
import { checkProviderAccess, providerFailureMessage } from "@/lib/provider-access";
import { ProviderError } from "@/lib/provider-client";

const Input = z.object({ kind: z.enum(["text", "asr"]), provider: z.enum(["deepseek", "qwen", "qwen-asr"]), key: z.string().trim().min(8).max(500), workspaceId: z.string().trim().max(80).default("") });
const CheckInput = z.object({ kind: z.enum(["text", "asr"]), provider: z.enum(["deepseek", "qwen", "qwen-asr"]), workspaceId: z.string().max(80), updatedAt: z.string().datetime({ offset: true }) });
const noStore = { "Cache-Control": "no-store" };
export const maxDuration = 40;

export async function GET(request: Request) {
  try {
    const { userId, admin } = await requireUser(request);
    const { data, error } = await admin.from("provider_keys").select("kind,provider,workspace_id,updated_at").eq("owner_id", userId);
    if (error) throw error;
    const text = data?.find((row) => row.kind === "text"), asr = data?.find((row) => row.kind === "asr");
    return NextResponse.json({ text: !!text, asr: !!asr, provider: text?.provider ?? "deepseek", workspaceId: text?.workspace_id ?? "", asrWorkspaceId: asr?.workspace_id ?? "", textUpdatedAt: text?.updated_at ?? "", asrUpdatedAt: asr?.updated_at ?? "" }, { headers: noStore });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const { userId, profile, admin } = await requireUser(request);
    const input = Input.parse(await request.json());
    const zh = profile.language === "zh";
    if ((input.kind === "asr") !== (input.provider === "qwen-asr")) throw new HttpError(400, zh ? "请选择与服务类型匹配的服务商。" : "Provider and key kind do not match.");
    if (!/^sk-[^\s="'\x60]+$/.test(input.key)) throw new HttpError(400, zh ? "请填写完整 API Key，只复制密钥本身，不带引号、变量名或空格。" : "Paste the API key only, without quotes, variable names or spaces.");
    if (input.provider !== "deepseek" && input.key.startsWith("sk-sp-")) throw new HttpError(400, zh ? "请使用百炼按量付费 API Key，当前接入不支持 Coding Plan / Token Plan 专用密钥。" : "Use a Model Studio pay-as-you-go API key. Dedicated Coding Plan / Token Plan keys are unsupported.");
    if (input.provider !== "deepseek" && !/^[A-Za-z0-9_-]{4,80}$/.test(input.workspaceId)) throw new HttpError(400, zh ? "请填写北京业务空间的 Workspace ID，与 API Key 属于同一空间。" : "Enter a Beijing Workspace ID matching your API key.");
    const encrypted = encryptKey(input.key), updatedAt = new Date().toISOString();
    const { error } = await admin.from("provider_keys").upsert({ owner_id: userId, kind: input.kind, provider: input.provider, workspace_id: input.provider === "deepseek" ? "" : input.workspaceId, ...encrypted, updated_at: updatedAt });
    if (error) throw error;
    return NextResponse.json({ saved: true, updatedAt }, { headers: noStore });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request) {
  try {
    const { userId, profile, admin } = await requireUser(request);
    const input = CheckInput.parse(await request.json());
    const zh = profile.language === "zh";
    const { data: config, error } = await admin.from("provider_keys").select("*").eq("owner_id", userId).eq("kind", input.kind).maybeSingle();
    if (error) throw error;
    if (!config) throw new HttpError(400, zh ? "请先保存该服务密钥。" : "Save the provider key first.");
    if (config.provider !== input.provider || config.workspace_id !== input.workspaceId || Date.parse(config.updated_at) !== Date.parse(input.updatedAt)) throw new HttpError(409, zh ? "配置已变化，请刷新设置后重新检查。" : "Configuration changed. Refresh settings before checking again.");
    let key: string;
    try { key = decryptKey(config.encrypted_key, config.iv); }
    catch { throw new HttpError(503, zh ? "无法解密已保存密钥，请联系维护者检查加密配置或重新保存密钥。" : "The saved key could not be decrypted. Check server encryption configuration or save the key again."); }
    let result;
    try { result = await checkProviderAccess(config.provider, config.workspace_id, key); }
    catch (error) { throw new HttpError(502, providerFailureMessage(error instanceof ProviderError ? error.status : 502, profile.language)); }
    const current = await admin.from("provider_keys").select("kind").eq("owner_id", userId).eq("kind", input.kind).eq("updated_at", config.updated_at).maybeSingle();
    if (current.error) throw current.error;
    if (!current.data) throw new HttpError(409, zh ? "检查期间密钥已被替换或删除，请刷新设置。" : "The key changed during the check. Refresh settings.");
    return NextResponse.json({ ...result, provider: config.provider }, { headers: noStore });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request) {
  try {
    const { userId, admin } = await requireUser(request);
    const { kind } = z.object({ kind: z.enum(["text", "asr"]) }).parse(await request.json());
    const { data: current, error: readError } = await admin.from("provider_keys").select("updated_at").eq("owner_id", userId).eq("kind", kind).maybeSingle();
    if (readError) throw readError;
    if (!current) return NextResponse.json({ removed: true }, { headers: noStore });
    await recordTombstone({ entity: "provider_key", entityId: userId, ownerId: userId, keyKind: kind, updatedBefore: current.updated_at, at: new Date().toISOString() });
    const { data: deleted, error } = await admin.from("provider_keys").delete().eq("owner_id", userId).eq("kind", kind).lte("updated_at", current.updated_at).select("kind");
    if (error) throw error;
    if (!deleted?.length) throw new HttpError(409, "Provider key changed on another device. Refresh before removing it.");
    return NextResponse.json({ removed: true }, { headers: noStore });
  } catch (error) { return apiError(error); }
}
