import { NextResponse } from "next/server";
import { apiError, requireCron } from "@/lib/server-auth";
import { getAdminClient } from "@/lib/supabase";
import { recordTombstone } from "@/lib/backup-ledger";

export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    requireCron(request);
    const admin = getAdminClient();
    const started = Date.now();
    const cutoff = new Date(started - 365 * 86400000).toISOString();
    const tempCutoff = new Date(started - 86400000).toISOString();
    const counts = { purged: 0, draftsPurged: 0, sessionsPurged: 0, microPurged: 0, microDraftsPurged: 0, jobsPurged: 0, temporaryAudioPurged: 0, orphanAudioPurged: 0 };
    let moreInBatch = false;
    const respond = (partial = false) => NextResponse.json({ ...counts, partial: partial || moreInBatch }, { headers: { "Cache-Control": "no-store" } });
    // Stop between records before the hosting deadline. Each operation remains retryable.
    const timeUp = () => Date.now() - started >= 45000;
    const audioReferenced = async (path: string) => {
      const result = await admin.from("practice_attempts").select("id").eq("recording_path", path).limit(1);
      if (result.error) throw result.error;
      return !!result.data?.length;
    };
    const removeAudio = async (path: string) => {
      const result = await admin.storage.from("study-audio").remove([path]);
      if (result.error) throw result.error;
    };
    const attempts = await admin.from("practice_attempts").select("id,owner_id,recording_path").lt("submitted_at", cutoff).is("purged_at", null).order("submitted_at").limit(25);
    if (attempts.error) throw attempts.error;
    moreInBatch ||= (attempts.data?.length ?? 0) === 25;
    for (const row of attempts.data ?? []) {
      if (timeUp()) return respond(true);
      await recordTombstone({ entity: "purged_attempt", entityId: row.id, ownerId: row.owner_id, at: new Date().toISOString() });
      if (row.recording_path) await removeAudio(row.recording_path);
      const result = await admin.from("practice_attempts").update({ answer_body: null, feedback: null, transcript: null, recording_path: null, saved_recording: false, purged_at: new Date().toISOString() }).eq("id", row.id).is("purged_at", null).select("id");
      if (result.error) throw result.error;
      if (result.data?.length) {
        const ledger = await admin.from("deletion_events").insert({ owner_id: row.owner_id, entity: "purged_attempt", entity_id: row.id });
        if (ledger.error) throw ledger.error;
        counts.purged++;
      }
    }
    for (const table of ["writing_drafts", "practice_sessions", "micro_sessions"] as const) {
      if (timeUp()) return respond(true);
      const rows = await admin.from(table).select("id,owner_id,updated_at").lt("updated_at", cutoff).order("updated_at").limit(25);
      if (rows.error) throw rows.error;
      moreInBatch ||= (rows.data?.length ?? 0) === 25;
    for (const row of rows.data ?? []) {
        if (timeUp()) return respond(true);
        await recordTombstone({ entity: table, entityId: row.id, ownerId: row.owner_id, at: new Date().toISOString(), updatedBefore: row.updated_at });
        const result = await admin.from(table).delete().eq("id", row.id).lte("updated_at", row.updated_at).select("id");
        if (result.error) throw result.error;
        const key = table === "writing_drafts" ? "draftsPurged" : table === "practice_sessions" ? "sessionsPurged" : "microDraftsPurged";
        counts[key] += result.data?.length ?? 0;
      }
    }
    if (timeUp()) return respond(true);
    const micro = await admin.from("micro_attempts").select("id,owner_id").lt("submitted_at", cutoff).is("purged_at", null).order("submitted_at").limit(25);
    if (micro.error) throw micro.error;
    moreInBatch ||= (micro.data?.length ?? 0) === 25;
    for (const row of micro.data ?? []) {
      if (timeUp()) return respond(true);
      await recordTombstone({ entity: "purged_micro_attempt", entityId: row.id, ownerId: row.owner_id, at: new Date().toISOString() });
      const result = await admin.from("micro_attempts").update({ answer_body: null, self_review: null, unit_snapshot: null, purged_at: new Date().toISOString() }).eq("id", row.id).is("purged_at", null).select("id");
      if (result.error) throw result.error;
      counts.microPurged += result.data?.length ?? 0;
    }
    if (timeUp()) return respond(true);
    const jobs = await admin.from("transcription_jobs").select("id,audio_path").lt("created_at", cutoff).order("created_at").limit(25);
    if (jobs.error) throw jobs.error;
    moreInBatch ||= (jobs.data?.length ?? 0) === 25;
    for (const row of jobs.data ?? []) {
      if (timeUp()) return respond(true);
      // A response submitted later can still retain its recording legitimately.
      if (row.audio_path && !(await audioReferenced(row.audio_path))) await removeAudio(row.audio_path);
      const result = await admin.from("transcription_jobs").delete().eq("id", row.id).select("id");
      if (result.error) throw result.error;
      counts.jobsPurged += result.data?.length ?? 0;
    }
    if (timeUp()) return respond(true);
    const abandoned = await admin.from("transcription_jobs").select("id,audio_path,status").eq("save_recording", false).neq("audio_path", "").lt("created_at", tempCutoff).order("created_at").limit(25);
    if (abandoned.error) throw abandoned.error;
    moreInBatch ||= (abandoned.data?.length ?? 0) === 25;
    for (const row of abandoned.data ?? []) {
      if (timeUp()) return respond(true);
      if (!(await audioReferenced(row.audio_path))) await removeAudio(row.audio_path);
      const result = row.status === "SUCCEEDED"
        ? await admin.from("transcription_jobs").update({ audio_path: "" }).eq("id", row.id)
        : await admin.from("transcription_jobs").delete().eq("id", row.id);
      if (result.error) throw result.error;
      counts.temporaryAudioPurged++;
    }
    // Uploads abandoned before a transcription job exists also need expiry.
    // Only sweep the application-generated flat UUID/user paths, after 24 hours.
    for (let rootOffset = 0; ; rootOffset += 100) {
      if (timeUp()) return respond(true);
      const root = await admin.storage.from("study-audio").list("", { limit: 100, offset: rootOffset, sortBy: { column: "name", order: "asc" } });
      if (root.error) throw root.error;
      for (const folder of root.data ?? []) {
        if (folder.id || !/^[0-9a-f-]{36}$/i.test(folder.name)) continue;
        const candidates: string[] = [];
        for (let offset = 0; ; offset += 100) {
          if (timeUp()) return respond(true);
          const page = await admin.storage.from("study-audio").list(folder.name, { limit: 100, offset, sortBy: { column: "name", order: "asc" } });
          if (page.error) throw page.error;
          for (const file of page.data ?? []) {
            if (file.id && /^[0-9a-f-]{36}\.(webm|m4a)$/i.test(file.name) && file.created_at && file.created_at < tempCutoff) candidates.push(folder.name + "/" + file.name);
          }
          if (!page.data || page.data.length < 100) break;
        }
        // Gather before deleting, so offset pagination cannot skip shifted objects.
        for (const path of candidates) {
          if (timeUp()) return respond(true);
          if (await audioReferenced(path)) continue;
          const job = await admin.from("transcription_jobs").select("id").eq("audio_path", path).limit(1);
          if (job.error) throw job.error;
          if (job.data?.length) continue;
          await removeAudio(path);
          counts.orphanAudioPurged++;
        }
      }
      if (!root.data || root.data.length < 100) break;
    }
    return respond();
  } catch (error) { return apiError(error); }
}
