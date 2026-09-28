import { accessibleMaterial, parseFileToken } from "@/lib/file-access";
import { apiError, HttpError } from "@/lib/server-auth";

export async function GET(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get("token") ?? "";
    const { userId, materialId, sessionId } = parseFileToken(token);
    const { admin, material } = await accessibleMaterial(userId, materialId, sessionId);
    const { data, error } = await admin.storage.from("study-files").createSignedUrl(material.file_path, 45);
    if (error || !data) throw new HttpError(404, "Attachment unavailable");
    const range = request.headers.get("range");
    const upstream = await fetch(data.signedUrl, { headers: range ? { Range: range } : undefined, signal: AbortSignal.timeout(30000) });
    if (!upstream.ok && upstream.status !== 206) throw new HttpError(502, "Attachment could not be loaded");
    const headers = new Headers({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox", "Referrer-Policy": "no-referrer" });
    const kind = material.file_kind ?? "application/octet-stream";
    const safeKind = /^(audio\/(mpeg|mp4|webm|wav|ogg)|image\/(png|jpeg|webp)|application\/pdf|text\/plain)$/.test(kind) ? kind : "application/octet-stream";
    headers.set("Content-Type", safeKind);
    headers.set("Content-Disposition", safeKind === "application/octet-stream" ? "attachment" : "inline");
    for (const name of ["Content-Length", "Content-Range", "Accept-Ranges"]) { const value = upstream.headers.get(name); if (value) headers.set(name, value); }
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (error) { return apiError(error); }
}
