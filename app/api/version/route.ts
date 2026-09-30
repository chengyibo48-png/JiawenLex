import { NextResponse } from "next/server";
import { APP_VERSION, RELEASE_DATE } from "@/lib/release";
export function GET() {
  return NextResponse.json({ version: APP_VERSION, releasedAt: RELEASE_DATE, commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null }, { headers: { "Cache-Control": "no-store" } });
}
