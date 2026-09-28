import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { apiError, requireCron } from "@/lib/server-auth";
import { getAdminClient } from "@/lib/supabase";

export const maxDuration = 60;

function localParts(date: Date, zone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { date: `${value("year")}-${value("month")}-${value("day")}`, time: `${value("hour")}:${value("minute")}` };
}

export async function GET(request: Request) {
  try {
    requireCron(request);
    const admin = getAdminClient();
    const { data: profiles, error } = await admin.from("profiles").select("id,display_name,language,timezone,reminder_time").eq("status", "active").eq("reminder_on", true);
    if (error) throw error;
    const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT ?? 587), secure: Number(process.env.SMTP_PORT) === 465, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } });
    let sent = 0;
    for (const profile of profiles ?? []) {
      let local;
      try { local = localParts(new Date(), profile.timezone); } catch { continue; }
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
      const { error: reserved } = await admin.from("reminder_deliveries").insert({ owner_id: profile.id, local_date: local.date });
      if (reserved) continue;
      try {
        const zh = profile.language === "zh";
        await transport.sendMail({
          from: process.env.SMTP_FROM,
          to: person.user.email,
          subject: zh ? "JiawenLex · 今日学习提醒" : "JiawenLex · Study reminder",
          text: zh ? `${profile.display_name}，今天有 ${tasks.count ?? 0} 项待完成任务和 ${words.count ?? 0} 个待复习词。\n\n打开 JiawenLex：${process.env.NEXT_PUBLIC_SITE_URL}` : `Hello ${profile.display_name}, you have ${tasks.count ?? 0} tasks and ${words.count ?? 0} words due today.\n\nOpen JiawenLex: ${process.env.NEXT_PUBLIC_SITE_URL}`,
        });
        sent++;
      } catch {
        await admin.from("reminder_deliveries").delete().eq("owner_id", profile.id).eq("local_date", local.date);
      }
    }
    return NextResponse.json({ sent });
  } catch (error) { return apiError(error); }
}
