import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { stripTypeScriptTypes } from "node:module";
import { z, ZodError } from "zod";
import { presenceState } from "../lib/member-activity.ts";
const member = "00000000-0000-4000-8000-000000000001";
const recordId = "00000000-0000-4000-8000-000000000002";
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
function fixture(role = "admin", tables = {}, route = "admin/activity") {
  const calls = [];
  const admin = { from(table) {
    const filters = []; let selected = ""; let start = 0; let end = 24;
    const builder = { upsert(row) { calls.push({ table, upsert: row }); return Promise.resolve({ error: null }); }, delete() { return this; }, lt() { return this; }, select(columns) { selected = columns; calls.push({ table, columns }); return this; }, eq(key, value) { filters.push([key, value]); return this; }, in(key, value) { filters.push([key, value]); return this; }, order() { return this; }, limit() { return this; }, range(a, b) { start = a; end = b; return this; }, returns() { return this; }, maybeSingle() { return this.execute(true); }, then(resolve, reject) { return this.execute(false).then(resolve, reject); }, async execute(single) {
      const rows = (tables[table] ?? []).filter(r => filters.every(([key, value]) => Array.isArray(value) ? value.includes(r[key]) : r[key] === value));
      const values = rows.slice(start, end + 1).map(r => Object.fromEntries(selected.split(",").map(key => [key, r[key]])));
      return { data: single ? values[0] ?? null : values, count: rows.length, error: null };
    } };
    return builder;
  }, async rpc(_name, args) { return { data: args.session_id !== recordId, error: null }; } };
  const context = { exports: {}, Buffer, Request, Response, URL, Date, Map, Set, console, require(name) {
    if (name === "next/server") return { NextResponse: { json: (body, init) => Response.json(body, init) } };
    if (name === "zod") return { z };
    if (name === "@/lib/member-activity") return { presenceState, activityModules: ["reading", "listening", "writing", "speaking", "micro", "vocabulary", "spelling", "plan"] };
    if (name === "@/lib/server-auth") return { HttpError, requireUser: async () => { if (role === "revoked") throw new HttpError(401, "Session expired"); return { userId: member, sessionId: recordId, profile: { role }, admin }; }, apiError: e => Response.json({ error: e.message }, { status: e instanceof HttpError ? e.status : e instanceof ZodError ? 400 : 500 }) };
    throw new Error(name);
  } };
  const compiled = stripTypeScriptTypes(fs.readFileSync(new URL(`../app/api/${route}/route.ts`, import.meta.url), "utf8"))
    .replace(/^import \{ (.*?) \} from "(.*?)";/gm, (_, names, name) => `const { ${names} } = require("${name}");`)
    .replace("export async function GET", "exports.GET = async function GET").replace("export async function POST", "exports.POST = async function POST");
  vm.runInNewContext(compiled, context);
  return { calls, get: suffix => context.exports.GET(new Request("http://localhost/api/admin/activity" + suffix)), post: body => context.exports.POST(new Request("http://localhost/api/activity", { method: "POST", body: JSON.stringify(body) })) };
}
test("Presence handles foreground, background, expired, missing and invalid times", () => {
 const now = Date.parse("2026-10-03T12:00:00Z");
 assert.equal(presenceState("2026-10-03T11:59:30Z", true, now), "online");
 assert.equal(presenceState("2026-10-03T11:59:30Z", false, now), "recent");
 assert.equal(presenceState("2026-10-03T11:58:00Z", true, now), "recent");
 assert.equal(presenceState("2026-10-03T11:54:00Z", true, now), "offline");
 assert.equal(presenceState(null, true, now), "unknown");
 assert.equal(presenceState("invalid", true, now), "unknown");
});
test("Member and revoked sessions cannot query any admin activity", async () => {
 for (const [role, status] of [["member", 403], ["revoked", 401]]) { const f = fixture(role); assert.equal((await f.get("")).status, status); assert.equal(f.calls.length, 0); }
});
test("Activity pagination rejects Infinity, fractions and zero before database reads", async () => {
 for (const page of ["Infinity", "NaN", "0", "1.5", "100001"]) { const f = fixture(); assert.equal((await f.get(`?member=${member}&page=${page}`)).status, 400); assert.equal(f.calls.length, 0); }
});
test("History is scoped to active member, module and bounded pages; summaries exclude answer bodies", async () => {
 const attempts = Array.from({ length: 26 }, (_, n) => ({ id: String(n), owner_id: member, skill: "reading", submitted_at: "2026-10-03", answer_body: { secret: "not a summary field" } }));
 attempts.push({ id: "other", owner_id: recordId, skill: "reading" }, { id: "listening", owner_id: member, skill: "listening" });
 const f = fixture("admin", { profiles: [{ id: member, display_name: "Learner", status: "active" }], practice_attempts: attempts });
 const response = await f.get(`?member=${member}&module=reading&page=2`); const body = await response.json();
 assert.equal(response.status, 200); assert.equal(body.total, 26); assert.equal(body.records.length, 1); assert.equal(body.records[0].id, "25");
 assert.ok(!JSON.stringify(body).includes("secret")); assert.ok(!f.calls.some(c => /api_config|writing_drafts/.test(c.table)));
 assert.ok(!f.calls.find(c => c.table === "practice_attempts").columns.includes("answer_body"));
});
test("Purged answer detail remains deleted and removed members cannot be selected", async () => {
 const tables = { profiles: [{ id: member, display_name: "Learner", status: "active" }], practice_attempts: [{ id: recordId, owner_id: member, skill: "reading", purged_at: "2026-10-03", answer_body: { q: "must stay deleted" }, transcript: "private transcript" }] };
 const f = fixture("admin", tables); const body = await (await f.get(`?member=${member}&module=reading&record=${recordId}`)).json();
 assert.ok(!JSON.stringify(body).includes("must stay deleted")); assert.equal(body.questions.length, 0);
 assert.equal((await fixture("admin", { profiles: [{ id: member, status: "removed" }] }).get(`?member=${member}`)).status, 404);
});
test("A revoked login heartbeat cannot make its member online", async () => {
 const f = fixture("admin", { profiles: [{ id: member, display_name: "Learner", status: "active" }], member_presence: [{ owner_id: member, session_id: recordId, module: "reading", visible: true, last_seen: new Date().toISOString() }] });
 const body = await (await f.get("")).json(); assert.equal(body.members[0].presence, "offline");
});

test("Heartbeat derives identity from verified session and cannot impersonate another member", async () => {
 const f = fixture("member", {}, "activity");
 const body = { instanceId: member, module: "reading", visible: true };
 assert.equal((await f.post({ ...body, owner_id: recordId })).status, 400);
 assert.equal(f.calls.length, 0);
 assert.equal((await f.post(body)).status, 200);
 const written = f.calls.find(c => c.upsert).upsert;
 assert.equal(written.owner_id, member); assert.equal(written.session_id, recordId); assert.equal(written.module, "reading");
 assert.equal(Object.hasOwn(written, "answer_body"), false);
});
