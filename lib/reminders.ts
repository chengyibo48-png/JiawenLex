export function localParts(date: Date, zone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { date: `${value("year")}-${value("month")}-${value("day")}`, time: `${value("hour")}:${value("minute")}` };
}
export function publicSiteUrl(value: string | undefined): string {
  const url = new URL(value ?? "");
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/" || !url.hostname.includes(".") || url.hostname.endsWith(".localhost") || /^(localhost|127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname) || url.hostname === "[::1]") throw new Error("Set a public HTTPS NEXT_PUBLIC_SITE_URL before enabling reminders");
  return url.origin;
}
export function reminderMessage(profile: { language: string; display_name: string }, tasks: number, words: number, siteUrl: string) {
  const zh = profile.language === "zh";
  return {
    subject: zh ? "JiawenLex · 今日学习提醒" : "JiawenLex · Study reminder",
    text: zh ? `${profile.display_name}，今天有 ${tasks} 项待完成任务和 ${words} 个待复习词。\n\n打开 JiawenLex：${siteUrl}` : `Hello ${profile.display_name}, you have ${tasks} tasks and ${words} words due today.\n\nOpen JiawenLex: ${siteUrl}`,
  };
}
export async function deliverReminder(steps: { reserve: () => Promise<{ error: { code?: string } | null }>; send: () => Promise<unknown>; release: () => Promise<{ error: unknown }> }): Promise<"sent" | "failed" | "duplicate"> {
  const reservation = await steps.reserve();
  if (reservation.error?.code === "23505") return "duplicate";
  if (reservation.error) throw reservation.error;
  try { await steps.send(); return "sent"; }
  catch {
    const released = await steps.release();
    if (released.error) throw released.error;
    return "failed";
  }
}
