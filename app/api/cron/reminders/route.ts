import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { apiError, requireCron } from "@/lib/server-auth";
import { getAdminClient } from "@/lib/supabase";
import { localParts, publicSiteUrl, reminderMessage, deliverReminder } from "@/lib/reminders";

export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    requireCron(request);
    const admin = getAdminClient();
    const { data: profiles, error } = await admin.from("profiles").select("id,display_name,language,timezone,reminder_time").eq("status", "active").eq("reminder_on", true);
    if (error) throw error;
    if (!profiles?.length) return NextResponse.json({ sent: 0, failed: 0 });
    const siteUrl = publicSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);
    if (!["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"].every((name) => process.env[name])) throw new Error("SMTP configuration is incomplete");
    const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT ?? 587), secure: Number(process.env.SMTP_PORT) === 465, connectionTimeout: 7000, greetingTimeout: 7000, socketTimeout: 10000, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } });
    let sent = 0, failed = 0;
    const now = new Date();
    for (const profile of profiles ?? []) {
      if (Date.now() - now.getTime() > 35000) break; // Leave remaining members for the next run.
      let local;
      try { local = localParts(now, profile.timezone); } catch { failed++; continue; }
      if (local.time < profile.reminder_time.slice(0, 5)) continue;
      const { data: delivered, error: deliveryError } = await admin.from("reminder_deliveries").select("owner_id").eq("owner_id", profile.id).eq("local_date", local.date).maybeSingle();
      if (deliveryError) throw deliveryError;
      if (delivered) continue;
      const [tasks, words] = await Promise.all([
        admin.from("study_tasks").select("id", { count: "exact", head: true }).eq("owner_id", profile.id).eq("status", "todo").lte("planned_date", local.date),
        admin.from("vocabulary").select("id", { count: "exact", head: true }).eq("owner_id", profile.id).lte("due_at", new Date().toISOString()),
      ]);
      if (tasks.error || words.error) throw tasks.error ?? words.error;
      if (!tasks.count && !words.count) continue;
      const { data: person, error: authError } = await admin.auth.admin.getUserById(profile.id);
      if (authError || !person.user?.email) continue;
      const delivery = await deliverReminder({
        reserve: async () => await admin.from("reminder_deliveries").insert({ owner_id: profile.id, local_date: local.date }),
        send: () => transport.sendMail({
          from: process.env.SMTP_FROM,
          to: person.user.email,
          ...reminderMessage(profile, tasks.count ?? 0, words.count ?? 0, siteUrl),
        }),
        release: async () => await admin.from("reminder_deliveries").delete().eq("owner_id", profile.id).eq("local_date", local.date),
      });
      if (delivery === "sent") sent++;
      if (delivery === "failed") failed++;
    }
    transport.close();
    return NextResponse.json({ sent, failed }, { status: failed ? 502 : 200 });
  } catch (error) { return apiError(error); }
}
