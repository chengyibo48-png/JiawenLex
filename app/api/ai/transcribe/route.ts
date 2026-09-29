import { NextResponse } from "next/server";
import { z } from "zod";
import { reserveBudget, settleBudget } from "@/lib/ai-budget";
import { ExpectedProviderConfig, requireProviderConsent } from "@/lib/provider-consent";
import { ownedRecordingPath } from "@/lib/storage-path";
import { decryptKey } from "@/lib/key-crypto";
import { estimatedAsrCostCny } from "@/lib/providers";
import { providerFailureMessage } from "@/lib/provider-access";
import { apiError, HttpError, requireUser } from "@/lib/server-auth";
import { speechTaskStatus, transcriptUrl, transcriptText, transcriptDurationSeconds, SpeechResultError, type SpeechTaskResult } from "@/lib/speech-result";

const Input = z.object({ path: z.string().max(240), saved: z.boolean(), durationSeconds: z.number().min(0).max(3600).default(600), overrideBudget: z.boolean().default(false), expectedConfig: ExpectedProviderConfig.optional() });
export const maxDuration = 60;
const workspacePattern = /^[A-Za-z0-9_-]{4,80}$/;

function asrBase(workspaceId: string) {
  if (!workspacePattern.test(workspaceId)) throw new HttpError(400, "Valid Workspace ID required");
  return `https://${workspaceId}.cn-beijing.maas.aliyuncs.com`;
}

async function asrKey(admin: ReturnType<typeof import("@/lib/supabase").getAdminClient>, userId: string) {
  const { data, error } = await admin.from("provider_keys").select("*").eq("owner_id", userId).eq("kind", "asr").maybeSingle();
  if (error) throw error;
  if (!data || data.provider !== "qwen-asr") throw new HttpError(400, "Set an Alibaba speech key first");
  return data;
}

export async function POST(request: Request) {
  try {
    const { userId, profile, admin } = await requireUser(request);
    if (!profile.ai_enabled) throw new HttpError(403, "AI is disabled");
    const input = Input.parse(await request.json());
    if (!ownedRecordingPath(input.path, userId)) throw new HttpError(403, "Audio access denied");
    const config = await asrKey(admin, userId);
    requireProviderConsent(input.expectedConfig, config, profile.language);
    let key: string;
    try { key = decryptKey(config.encrypted_key, config.iv); }
    catch { throw new HttpError(503, profile.language === "zh" ? "无法解密语音密钥，请重新保存密钥或联系维护者检查加密配置。" : "The speech key could not be decrypted. Save it again or check server encryption configuration."); }
    const estimated = estimatedAsrCostCny(Math.max(60, input.durationSeconds));

    const { data: signed, error: signError } = await admin.storage.from("study-audio").createSignedUrl(input.path, 3600);
    if (signError || !signed) throw new HttpError(404, "Audio unavailable");
    const base = asrBase(config.workspace_id);
    const jobId = crypto.randomUUID();
    const reservation = await reserveBudget(admin, userId, "qwen-asr", "transcription", estimated, input.overrideBudget, jobId);
    let response: Response;
    try {
      response = await fetch(`${base}/api/v1/services/audio/asr/transcription`, {
        method: "POST",
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json", "X-DashScope-Async": "enable" },
        body: JSON.stringify({ model: "paraformer-v2", input: { file_urls: [signed.signedUrl] }, parameters: { language_hints: ["en"] } }),
        redirect: "error", signal: AbortSignal.timeout(20000),
      });
    } catch {
      // A provider timeout can still be billed. Preserve a conservative estimate.
      await settleBudget(admin, reservation.id, estimated);
      throw new HttpError(502, profile.language === "zh" ? "语音服务连接超时或不可用，录音仍可重试；本次费用暂按估算保留。" : "The speech service could not be reached. Your recording can be retried; a conservative cost estimate is retained.");
    }
    if (!response.ok) {
      await settleBudget(admin, reservation.id, response.status >= 400 && response.status < 500 ? 0 : estimated);
      throw new HttpError(502, providerFailureMessage(response.status, profile.language));
    }
    let result: { output?: { task_id?: string } };
    try { result = await response.json(); }
    catch {
      await settleBudget(admin, reservation.id, estimated);
      throw new HttpError(502, profile.language === "zh" ? "语音服务返回了无效响应，录音仍可重试。" : "The speech service returned an invalid response. Your recording can be retried.");
    }
    const taskId = result.output?.task_id;
    if (!taskId) {
      await settleBudget(admin, reservation.id, estimated);
      throw new HttpError(502, profile.language === "zh" ? "语音服务未返回任务编号，录音仍可重新提交。" : "The speech service returned no task ID. Your recording can be resubmitted.");
    }
    await settleBudget(admin, reservation.id, estimated);
    const { error } = await admin.from("transcription_jobs").insert({ id: jobId, usage_id: reservation.id, owner_id: userId, task_id: taskId, audio_path: input.path, save_recording: input.saved, estimated_cny: estimated, status: "PENDING" });
    if (error) throw error;
    return NextResponse.json({ taskId, budgetNearlyUsed: reservation.used + estimated >= Number(profile.monthly_budget_cny) * 0.8 });
  } catch (error) { return apiError(error); }
}

export async function GET(request: Request) {
  try {
    const { userId, profile, admin } = await requireUser(request);
    const taskId = z.string().min(5).max(160).parse(new URL(request.url).searchParams.get("taskId"));
    const { data: job, error: jobError } = await admin.from("transcription_jobs").select("*").eq("owner_id", userId).eq("task_id", taskId).maybeSingle();
    if (jobError) throw jobError;
    if (!job) throw new HttpError(404, "Transcription task unavailable");
    if (job.status === "SUCCEEDED") {
      if (!job.save_recording && job.audio_path) {
        const { error: cleanupError } = await admin.storage.from("study-audio").remove([job.audio_path]);
        if (!cleanupError) await admin.from("transcription_jobs").update({ audio_path: "" }).eq("id", job.id);
      }
      return NextResponse.json({ status: "SUCCEEDED", transcript: job.transcript });
    }
    if (job.status === "FAILED") return NextResponse.json({ status: "FAILED" });
    const config = await asrKey(admin, userId);
    const response = await fetch(`${asrBase(config.workspace_id)}/api/v1/tasks/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${decryptKey(config.encrypted_key, config.iv)}` }, redirect: "error", signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new HttpError(502, providerFailureMessage(response.status, profile.language));
    const result = await response.json() as SpeechTaskResult;
    const status = speechTaskStatus(result);
    if (status === "SUCCEEDED") {
      const file = await fetch(transcriptUrl(result), { redirect: "error", signal: AbortSignal.timeout(20000) });
      if (!file.ok) throw new HttpError(502, "Transcript unavailable");
      const transcriptResult: unknown = await file.json();
      const transcript = transcriptText(transcriptResult);
      const actualSeconds = transcriptDurationSeconds(transcriptResult);
      const estimatedCny = actualSeconds === null ? Number(job.estimated_cny) : estimatedAsrCostCny(actualSeconds);
      if (job.usage_id) await settleBudget(admin, job.usage_id, estimatedCny);
      else {
        const { error: usageError } = await admin.from("ai_usage").upsert(
          { owner_id: userId, provider: "qwen-asr", operation: "transcription", reference_id: job.id, estimated_cny: estimatedCny },
          { onConflict: "owner_id,provider,operation,reference_id", ignoreDuplicates: true },
        );
        if (usageError) throw usageError;
      }
      const { error } = await admin.from("transcription_jobs").update({ status: "SUCCEEDED", transcript, estimated_cny: estimatedCny, completed_at: new Date().toISOString() }).eq("id", job.id);
      if (error) throw error;
      // Persist the transcript before deleting audio; a cleanup failure must not lose it.
      if (!job.save_recording) {
        const { error: cleanupError } = await admin.storage.from("study-audio").remove([job.audio_path]);
        if (!cleanupError) await admin.from("transcription_jobs").update({ audio_path: "" }).eq("id", job.id);
      }
      return NextResponse.json({ status: "SUCCEEDED", transcript });
    }
    if (status === "FAILED") {
      if (!job.save_recording) {
        const { error: removeError } = await admin.storage.from("study-audio").remove([job.audio_path]);
        if (removeError) throw removeError;
      }
      const { error } = await admin.from("transcription_jobs").update({ status: "FAILED", completed_at: new Date().toISOString() }).eq("id", job.id);
      if (error) throw error;
      return NextResponse.json({ status: "FAILED" });
    }
    return NextResponse.json({ status });
  } catch (error) { return apiError(error instanceof SpeechResultError ? new HttpError(502, error.message) : error); }
}
