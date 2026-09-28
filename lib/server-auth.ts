import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getAdminClient } from "./supabase";
import type { Profile } from "./types";

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function requireUser(request: Request): Promise<{ userId: string; email: string; profile: Profile; admin: ReturnType<typeof getAdminClient> }> {
  const bearer = request.headers.get("authorization");
  const token = bearer?.startsWith("Bearer ") ? bearer.slice(7) : "";
  if (!token) throw new HttpError(401, "Please sign in");
  const admin = getAdminClient();
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth.user?.id) throw new HttpError(401, "Session expired");
  const { data: profile, error } = await admin.from("profiles").select("*").eq("id", auth.user.id).single();
  if (error || !profile || profile.status !== "active") throw new HttpError(403, "Account is inactive");
  return { userId: auth.user.id, email: auth.user.email ?? "", profile: profile as Profile, admin };
}

export function apiError(error: unknown): NextResponse {
  const status = error instanceof HttpError ? error.status : error instanceof ZodError ? 400 : 500;
  const message = error instanceof Error ? error.message : "Unexpected server error";
  return NextResponse.json({ error: status === 500 ? "Server error" : message }, { status });
}

export function requireCron(request: Request): void {
  const expected = process.env.CRON_SECRET;
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) throw new HttpError(401, "Invalid cron token");
}
