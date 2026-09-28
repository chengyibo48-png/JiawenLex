import { NextResponse } from "next/server";
import { apiError, requireCron } from "@/lib/server-auth";
import { getAdminClient } from "@/lib/supabase";
import { recordTombstone } from "@/lib/backup-ledger";

export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    requireCron(request);
    const admin = getAdminClient();
    const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    const { data: oldAttempts, error } = await admin.from("practice_attempts").select("id,owner_id,recording_path").lt("submitted_at", cutoff).is("purged_at", null).limit(100);
    if (error) throw error;
    for (const attempt of oldAttempts ?? []) {
      await recordTombstone({ entity: "purged_attempt", entityId: attempt.id, ownerId: attempt.owner_id, at: new Date().toISOString() });
      if (attempt.recording_path) await admin.storage.from("study-audio").remove([attempt.recording_path]);
      const { error: updateError } = await admin.from("practice_attempts").update({ answer_body: null, feedback: null, transcript: null, recording_path: null, saved_recording: false, purged_at: new Date().toISOString() }).eq("id", attempt.id);
      if (updateError) throw updateError;
      await admin.from("deletion_events").insert({ owner_id: attempt.owner_id, entity: "purged_attempt", entity_id: attempt.id });
    }
    const { data: oldDrafts, error: draftError } = await admin.from("writing_drafts").select("id,owner_id").lt("updated_at", cutoff).limit(100);
    if (draftError) throw draftError;
    for (const draft of oldDrafts ?? []) {
      await recordTombstone({ entity: "writing_drafts", entityId: draft.id, ownerId: draft.owner_id, at: new Date().toISOString() });
      const { error: deleteError } = await admin.from("writing_drafts").delete().eq("id", draft.id);
      if (deleteError) throw deleteError;
    }
    const { data: oldJobs } = await admin.from("transcription_jobs").select("id,audio_path,save_recording,status").lt("created_at", cutoff).limit(100);
    for (const job of oldJobs ?? []) {
      if (job.save_recording || job.status !== "SUCCEEDED") await admin.storage.from("study-audio").remove([job.audio_path]);
      await admin.from("transcription_jobs").delete().eq("id", job.id);
    }
    const tempCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: abandoned } = await admin.from("transcription_jobs").select("id,audio_path").eq("save_recording", false).lt("created_at", tempCutoff).neq("status", "SUCCEEDED").limit(100);
    for (const job of abandoned ?? []) {
      await admin.storage.from("study-audio").remove([job.audio_path]);
      await admin.from("transcription_jobs").delete().eq("id", job.id);
    }
    return NextResponse.json({ purged: oldAttempts?.length ?? 0, draftsPurged: oldDrafts?.length ?? 0 });
  } catch (error) { return apiError(error); }
}
