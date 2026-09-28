import { NextResponse } from "next/server";
import { requireUser, apiError, HttpError } from "@/lib/server-auth";
import { serviceStatus } from "@/lib/service-status";
import { publicSiteUrl } from "@/lib/reminders";
export async function GET(request: Request) {
  try {
    const { profile } = await requireUser(request);
    if (profile.role !== "admin") throw new HttpError(403, "Admin access required");
    let publicUrl = false;
    try { publicSiteUrl(process.env.NEXT_PUBLIC_SITE_URL); publicUrl = true; } catch { /* Local sites cannot receive scheduled requests. */ }
    return NextResponse.json({ services: serviceStatus(process.env, publicUrl) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
