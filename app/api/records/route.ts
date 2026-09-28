import { NextResponse } from "next/server";
import { z } from "zod";
import { recordTombstone } from "@/lib/backup-ledger";
import { apiError, HttpError, requireUser } from "@/lib/server-auth";

const Input = z.object({ table: z.enum(["materials", "practice_attempts", "vocabulary"]), id: z.string().uuid() });

export async function DELETE(request: Request) {
  try {
    const { userId, admin } = await requireUser(request);
    const { table, id } = Input.parse(await request.json());
    const { data, error } = await admin.from(table).select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data || data.owner_id !== userId) throw new HttpError(404, "Record unavailable");
    await recordTombstone({ entity: table, entityId: id, ownerId: userId, at: new Date().toISOString() });
    const { error: deleteError } = await admin.from(table).delete().eq("id", id).eq("owner_id", userId);
    if (deleteError) throw deleteError;
    if (table === "materials" && "file_path" in data && data.file_path) await admin.storage.from("study-files").remove([String(data.file_path)]);
    if (table === "practice_attempts" && "recording_path" in data && data.recording_path) await admin.storage.from("study-audio").remove([String(data.recording_path)]);
    return NextResponse.json({ deleted: true });
  } catch (error) { return apiError(error); }
}
