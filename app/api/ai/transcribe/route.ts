import { NextResponse } from "next/server";
import { z } from "zod";
import { checkBudget } from "@/lib/ai-budget";
import { decryptKey } from "@/lib/key-crypto";
import { estimatedAsrCostCny } from "@/lib/providers";
import { apiError, HttpError, requireUser } from "@/lib/server-auth";

const Input = z.object({ path: z.string().max(240), saved: z.boolean(), durationSeconds: z.number().min(0).max(3600).default(600), overrideBudget: z.boolean().default(false) });
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
    if (!input.path.startsWith(`${userId}/`)) throw new HttpError(403, "Audio access denied");
    const config = await asrKey(admin, userId);
    const estimated = estimatedAsrCostCny(Math.max(60, input.durationSeconds));
    const used = await checkBudget(admin, userId, profile.monthly_budget_cny, estimated, input.overrideBudget);
    const { data: signed, error: signError } = await admin.storage.from("study-audio").createSignedUrl(input.path, 3600);
    if (signError || !signed) throw new HttpError(404, "Audio unavailable");
    const response = await fetch(`${asrBase(config.workspace_id)}/api/v1/services/audio/asr/transcription`, {
      method: "POST",
      headers: { Authorization: `Bearer ${decryptKey(config.encrypted_key, config.iv)}`, "Content-Type": "application/json", "X-DashScope-Async": "enable" },
      body: JSON.stringify({ model: "paraformer-v2", input: { file_urls: [signed.signedUrl] }, parameters: { language_hints: ["en"] } }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new HttpError(502, `Speech provider returned ${response.status}`);
    const result = await response.json() as { output?: { task_id?: string }; code?: string };
    const taskId = result.output?.task_id;
    if (!taskId) throw new HttpError(502, result.code ?? "Speech provider returned no task");
    const { error } = await admin.from("transcription_jobs").insert({ owner_id: userId, task_id: taskId, audio_path: input.path, save_recording: input.saved, estimated_cny: estimated, status: "PENDING" });
    if (error) throw error;
    return NextResponse.json({ taskId, budgetNearlyUsed: used + estimated >= Number(profile.monthly_budget_cny) * 0.8 });
  } catch (error) { return apiError(error); }
}

export async function GET(request: Request) {
  try {
    const { userId, admin } = await requireUser(request);
    const taskId = z.string().min(5).max(160).parse(new URL(request.url).searchParams.get("taskId"));
    const { data: job, error: jobError } = await admin.from("transcription_jobs").select("*").eq("owner_id", userId).eq("task_id", taskId).maybeSingle();
    if (jobError) throw jobError;
    if (!job) throw new HttpError(404, "Transcription task unavailable");
    if (job.status === "SUCCEEDED") return NextResponse.json({ status: "SUCCEEDED", transcript: job.transcript });
    if (job.status === "FAILED") return NextResponse.json({ status: "FAILED" });
    const config = await asrKey(admin, userId);
    const response = await fetch(`${asrBase(config.workspace_id)}/api/v1/tasks/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${decryptKey(config.encrypted_key, config.iv)}` }, signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new HttpError(502, `Speech provider returned ${response.status}`);
    const result = await response.json() as { output?: { task_status?: string; results?: { transcription_url?: string }[] } };
    const status = result.output?.task_status ?? "PENDING";
    if (status === "SUCCEEDED") {
      const url = result.output?.results?.[0]?.transcription_url;
      let transcriptUrl: URL;
      try { transcriptUrl = new URL(url ?? ""); } catch { throw new HttpError(502, "Invalid transcript URL"); }
      if (transcriptUrl.protocol !== "https:" || !(transcriptUrl.hostname === "aliyuncs.com" || transcriptUrl.hostname.endsWith(".aliyuncs.com"))) throw new HttpError(502, "Invalid transcript URL");
      const file = await fetch(transcriptUrl, { redirect: "error", signal: AbortSignal.timeout(20000) });
      if (!file.ok) throw new HttpError(502, "Transcript unavailable");
      const text = await file.json() as { transcripts?: { text?: string }[] };
      const transcript = (text.transcripts ?? []).map((part) => part.text ?? "").join("\n").slice(0, 100000);
      if (!transcript.trim()) throw new HttpError(502, "Empty transcript");
      const { error: usageError } = await admin.from("ai_usage").upsert(
        { owner_id: userId, provider: "qwen-asr", operation: "transcription", reference_id: job.id, estimated_cny: job.estimated_cny },
        { onConflict: "owner_id,provider,operation,reference_id", ignoreDuplicates: true },
      );
      if (usageError) throw usageError;
      if (!job.save_recording) {
        const { error: removeError } = await admin.storage.from("study-audio").remove([job.audio_path]);
        if (removeError) throw removeError;
      }
      const { error } = await admin.from("transcription_jobs").update({ status: "SUCCEEDED", transcript, completed_at: new Date().toISOString() }).eq("id", job.id);
      if (error) throw error;
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
  } catch (error) { return apiError(error); }
}
