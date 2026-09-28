import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, HttpError, requireUser } from "@/lib/server-auth";

async function adminOnly(request: Request) {
  const context = await requireUser(request);
  if (context.profile.role !== "admin") throw new HttpError(403, "Admin access required");
  return context;
}

export async function GET(request: Request) {
  try {
    const { admin } = await adminOnly(request);
    const { data, error } = await admin.from("invite_control").select("active,max_accounts,updated_at").eq("id", 1).single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const { admin } = await adminOnly(request);
    const { action, active } = z.object({ action: z.enum(["rotate", "toggle"]), active: z.boolean().optional() }).parse(await request.json());
    if (action === "rotate") {
      const code = randomBytes(18).toString("base64url");
      const code_hash = createHash("sha256").update(code).digest("hex");
      const { error } = await admin.from("invite_control").update({ code_hash, active: true, updated_at: new Date().toISOString() }).eq("id", 1);
      if (error) throw error;
      return NextResponse.json({ code, active: true });
    }
    const { error } = await admin.from("invite_control").update({ active: !!active, updated_at: new Date().toISOString() }).eq("id", 1);
    if (error) throw error;
    return NextResponse.json({ active: !!active });
  } catch (error) { return apiError(error); }
}
