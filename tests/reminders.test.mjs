import test from "node:test";
import assert from "node:assert/strict";
import { localParts, publicSiteUrl, reminderMessage, deliverReminder } from "../lib/reminders.ts";
test("Reminders use the user's date and avoid midnight hour 24", () => {
  const time = new Date("2026-09-29T16:00:00Z");
  assert.deepEqual(localParts(time, "Asia/Shanghai"), { date: "2026-09-30", time: "00:00" });
  assert.deepEqual(localParts(time, "America/Los_Angeles"), { date: "2026-09-29", time: "09:00" });
  assert.throws(() => localParts(time, "invalid/timezone"));
});
test("Scheduled email cannot link to localhost or a private network", () => {
  assert.equal(publicSiteUrl("https://jiawenlex.vercel.app/"), "https://jiawenlex.vercel.app");
  for (const url of [undefined, "http://localhost:3000", "https://127.0.0.1", "https://192.168.1.1", "https://user:pass@example.com", "https://example.com/private"]) assert.throws(() => publicSiteUrl(url));
});
test("Reminder content is bilingual and contains only due counts", () => {
  assert.match(reminderMessage({ language: "zh", display_name: "Jiawen" }, 2, 5, "https://example.com").text, /2 项待完成任务和 5 个待复习词/);
  assert.match(reminderMessage({ language: "en", display_name: "Jiawen" }, 2, 5, "https://example.com").text, /2 tasks and 5 words/);
});
test("Concurrent reminder runs send once and a failed send releases its reservation", async () => {
  let reserved = false, sends = 0;
  const steps = {
    reserve: async () => { if (reserved) return { error: { code: "23505" } }; reserved = true; return { error: null }; },
    send: async () => { sends++; },
    release: async () => { reserved = false; return { error: null }; },
  };
  assert.deepEqual((await Promise.all([deliverReminder(steps), deliverReminder(steps)])).sort(), ["duplicate", "sent"]);
  assert.equal(sends, 1);
  reserved = false;
  assert.equal(await deliverReminder({ ...steps, send: async () => { throw Error("SMTP failed"); } }), "failed");
  assert.equal(reserved, false);
  assert.equal(await deliverReminder(steps), "sent");
  await assert.rejects(deliverReminder({ ...steps, reserve: async () => ({ error: { code: "08006" } }) }));
});
