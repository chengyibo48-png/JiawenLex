import { NextResponse } from "next/server";
import { z } from "zod";
import { encryptKey } from "@/lib/key-crypto";
import { apiError, HttpError, requireUser } from "@/lib/server-auth";

const Input = z.object({ kind: z.enum(["text", "asr"]), provider: z.enum(["deepseek", "qwen", "qwen-asr"]), key: z.string().min(8).max(500), workspaceId: z.string().max(80).default("") });

export async function GET(request: Request) {
  try {
    const { userId, admin } = await requireUser(request);
    const { data, error } = await admin.from("provider_keys").select("kind,provider,workspace_id").eq("owner_id", userId);
    if (error) throw error;
    const text = data?.find((row) => row.kind === "text");
    return NextResponse.json({ text: !!text, asr: data?.some((row) => row.kind === "asr") ?? false, provider: text?.provider ?? "deepseek", workspaceId: text?.workspace_id ?? data?.find((row) => row.kind === "asr")?.workspace_id ?? "" });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const { userId, admin } = await requireUser(request);
    const input = Input.parse(await request.json());
    if ((input.kind === "asr") !== (input.provider === "qwen-asr")) throw new HttpError(400, "Provider and key kind do not match");
    if (input.provider !== "deepseek" && !/^[A-Za-z0-9_-]{4,80}$/.test(input.workspaceId)) throw new HttpError(400, "Valid Workspace ID required");
    const encrypted = encryptKey(input.key);
    const { error } = await admin.from("provider_keys").upsert({ owner_id: userId, kind: input.kind, provider: input.provider, workspace_id: input.workspaceId, ...encrypted, updated_at: new Date().toISOString() });
    if (error) throw error;
    return NextResponse.json({ saved: true });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request) {
  try {
    const { userId, admin } = await requireUser(request);
    const { kind } = z.object({ kind: z.enum(["text", "asr"]) }).parse(await request.json());
    const { error } = await admin.from("provider_keys").delete().eq("owner_id", userId).eq("kind", kind);
    if (error) throw error;
    return NextResponse.json({ removed: true });
  } catch (error) { return apiError(error); }
}
