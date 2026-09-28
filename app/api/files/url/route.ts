import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, requireUser } from "@/lib/server-auth";
import { accessibleMaterial, fileToken } from "@/lib/file-access";

export async function GET(request: Request) {
  try {
    const { userId, sessionId } = await requireUser(request);
    const materialId = z.string().uuid().parse(new URL(request.url).searchParams.get("materialId"));
    await accessibleMaterial(userId, materialId, sessionId);
    const url = new URL("/api/files/view", request.url);
    url.searchParams.set("token", fileToken(userId, materialId, sessionId));
    return NextResponse.json({ url: url.toString() });
  } catch (error) { return apiError(error); }
}
