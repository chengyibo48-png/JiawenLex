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
      if (attempt.recording_path) { const { error } = await admin.storage.from("study-audio").remove([attempt.recording_path]); if (error) throw error; }
      const { error: updateError } = await admin.from("practice_attempts").update({ answer_body: null, feedback: null, transcript: null, recording_path: null, saved_recording: false, purged_at: new Date().toISOString() }).eq("id", attempt.id);
      if (updateError) throw updateError;
      const { error: ledgerError } = await admin.from("deletion_events").insert({ owner_id: attempt.owner_id, entity: "purged_attempt", entity_id: attempt.id });
      if (ledgerError) throw ledgerError;
    }
    const { data: oldDrafts, error: draftError } = await admin.from("writing_drafts").select("id,owner_id").lt("updated_at", cutoff).limit(100);
    if (draftError) throw draftError;
    for (const draft of oldDrafts ?? []) {
      await recordTombstone({ entity: "writing_drafts", entityId: draft.id, ownerId: draft.owner_id, at: new Date().toISOString() });
      const { error: deleteError } = await admin.from("writing_drafts").delete().eq("id", draft.id);
      if (deleteError) throw deleteError;
    }
    const { data: oldJobs, error: jobsError } = await admin.from("transcription_jobs").select("id,audio_path,save_recording,status").lt("created_at", cutoff).limit(100);
    if (jobsError) throw jobsError;
    for (const job of oldJobs ?? []) {
      if (job.save_recording || job.status !== "SUCCEEDED") { const { error } = await admin.storage.from("study-audio").remove([job.audio_path]); if (error) throw error; }
      const { error: deleteError } = await admin.from("transcription_jobs").delete().eq("id", job.id);
      if (deleteError) throw deleteError;
    }
    const tempCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: abandoned, error: abandonedError } = await admin.from("transcription_jobs").select("id,audio_path").eq("save_recording", false).lt("created_at", tempCutoff).neq("status", "SUCCEEDED").limit(100);
    if (abandonedError) throw abandonedError;
    for (const job of abandoned ?? []) {
      const { error: removeError } = await admin.storage.from("study-audio").remove([job.audio_path]);
      if (removeError) throw removeError;
      const { error: deleteError } = await admin.from("transcription_jobs").delete().eq("id", job.id);
      if (deleteError) throw deleteError;
    }
    return NextResponse.json({ purged: oldAttempts?.length ?? 0, draftsPurged: oldDrafts?.length ?? 0 });
  } catch (error) { return apiError(error); }
}
