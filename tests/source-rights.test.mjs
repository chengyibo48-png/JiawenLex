import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { stripTypeScriptTypes } from "node:module";
import { z, ZodError } from "zod";

const owner = "00000000-0000-4000-8000-000000000001";
const reviewer = "00000000-0000-4000-8000-000000000002";
const documentId = "00000000-0000-4000-8000-000000000003";
const attestedAt = "2026-10-05T00:00:00.000Z";
const attestation = "I own this document and permit access by active group members.";
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

function fixture({ role = "member", userId = owner, route = "", afterRead } = {}) {
  const document = { id: documentId, owner_id: owner, status: "ready", license_name: "Original work", rights_attestation: attestation, rights_attested_at: attestedAt, rights_review_status: "pending", members_visible: false };
  const tables = { source_documents: [document], source_rights_audit: [{ id: documentId, document_id: documentId, decision: "pending", attestation, created_at: attestedAt }] };
  const calls = [];
  const admin = { from(table) {
    calls.push(table);
    let values = null, columns = "*", limit = 100;
    const filters = [];
    return {
      select(value) { columns = value; return this; }, update(value) { values = value; return this; },
      eq(key, value) { filters.push(row => row[key] === value); return this; },
      not(key, operator, value) { assert.equal(operator, "is"); filters.push(row => row[key] !== value); return this; },
      order() { return this; }, limit(value) { limit = value; return this; },
      maybeSingle() { return this.execute(true); }, then(resolve, reject) { return this.execute(false).then(resolve, reject); },
      async execute(single) {
        const matched = (tables[table] ?? []).filter(row => filters.every(filter => filter(row))).slice(0, limit);
        if (values) for (const row of matched) Object.assign(row, values);
        const data = matched.map(row => columns === "*" ? { ...row } : Object.fromEntries(columns.split(",").map(key => [key, row[key]])));
        if (!values && afterRead && table === "source_documents") afterRead(document);
        return { data: single ? data[0] ?? null : data, error: null };
      },
    };
  } };
  const context = { exports: {}, Request, Response, Date, console, require(name) {
    if (name === "next/server") return { NextResponse: { json: (body, init) => Response.json(body, init) } };
    if (name === "zod") return { z };
    if (name === "@/lib/source-deletion") return { deleteSourceDocument: async () => {} };
    if (name === "@/lib/server-auth") return { HttpError, requireUser: async () => {
      if (role === "revoked") throw new HttpError(401, "Session expired");
      return { userId, profile: { role }, admin };
    }, apiError: error => Response.json({ error: error.message }, { status: error instanceof HttpError ? error.status : error instanceof ZodError ? 400 : 500 }) };
    throw new Error(name);
  } };
  const compiled = stripTypeScriptTypes(fs.readFileSync(new URL(`../app/api/source-documents/[documentId]/${route ? route + "/" : ""}route.ts`, import.meta.url), "utf8"))
    .replace(/^import \{ (.*?) \} from "(.*?)";/gm, (_, names, name) => `const { ${names} } = require("${name}");`)
    .replace(/export async function (GET|PATCH|DELETE)/g, (_, method) => `exports.${method} = async function ${method}`);
  vm.runInNewContext(compiled, context);
  return { document, calls, request: (method, body) => context.exports[method](new Request("http://localhost/api/source-documents/" + documentId, { method, ...(body ? { body: JSON.stringify(body) } : {}) }), { params: Promise.resolve({ documentId }) }) };
}

const decision = (value = "approved") => ({ rightsReview: { decision: value, expectedAttestedAt: attestedAt, expectedAttestation: attestation, note: "Reviewed uploader statement" } });

test("Only an active administrator can review rights; approval preserves ownership and keeps the original private", async () => {
  for (const [role, expected] of [["member", 403], ["revoked", 401]]) {
    const f = fixture({ role });
    assert.equal((await f.request("PATCH", decision())).status, expected);
    assert.equal(f.calls.length, 0);
  }
  const f = fixture({ role: "admin", userId: reviewer });
  assert.equal((await f.request("PATCH", decision())).status, 200);
  assert.equal(f.document.owner_id, owner);
  assert.equal(f.document.rights_reviewed_by, reviewer);
  assert.equal(f.document.rights_review_status, "approved");
  assert.equal(f.document.members_visible, false);
});

test("Stale and repeated decisions cannot approve an unseen or closed declaration", async () => {
  const f = fixture({ role: "admin", userId: reviewer });
  f.document.rights_attestation = "A replacement rights declaration that has not been reviewed.";
  assert.equal((await f.request("PATCH", decision())).status, 409);
  assert.equal(f.document.rights_review_status, "pending");
  f.document.rights_attestation = attestation;
  assert.equal((await f.request("PATCH", decision("rejected"))).status, 200);
  assert.equal((await f.request("PATCH", decision())).status, 409);
});

test("Declarations and metadata remain owner scoped; mixed actions are rejected", async () => {
  const other = fixture({ role: "admin", userId: reviewer });
  assert.equal((await other.request("PATCH", { rightsAttestation: attestation })).status, 404);
  assert.equal((await other.request("PATCH", { licenseName: "Changed" })).status, 404);
  const f = fixture();
  assert.equal((await f.request("PATCH", { ...decision(), licenseName: "Changed" })).status, 400);
  assert.equal(f.calls.length, 0);
  f.document.members_visible = true;
  assert.equal((await f.request("PATCH", { rightsAttestation: "A revised declaration submitted by the document's real owner." })).status, 200);
  assert.equal(f.document.rights_review_status, "pending");
  assert.equal(f.document.rights_reviewed_by, null);
  assert.equal(f.document.members_visible, false);
  f.document.status = "uploading";
  assert.equal((await f.request("PATCH", { rightsAttestation: attestation })).status, 404);
});

test("Legacy empty declarations can be rejected but cannot be approved", async () => {
  const f = fixture({ role: "admin", userId: reviewer });
  f.document.rights_attestation = "";
  const request = decision(); request.rightsReview.expectedAttestation = "";
  assert.equal((await f.request("PATCH", request)).status, 409);
  assert.equal(f.calls.length, 0);
  request.rightsReview.decision = "rejected";
  assert.equal((await f.request("PATCH", request)).status, 200);
});

test("A revoked approval cannot race with enabling sharing, while owners can always revoke their own share", async () => {
  const f = fixture({ route: "sharing", afterRead: document => { document.rights_review_status = "rejected"; } });
  f.document.rights_review_status = "approved";
  assert.equal((await f.request("PATCH", { membersVisible: true })).status, 409);
  assert.equal(f.document.members_visible, false);
  f.document.members_visible = true;
  assert.equal((await f.request("PATCH", { membersVisible: false })).status, 200);
  assert.equal(f.document.members_visible, false);
  const other = fixture({ route: "sharing", role: "admin", userId: reviewer });
  assert.equal((await other.request("PATCH", { membersVisible: false })).status, 404);
});

test("Rights history is private to its owner and administrators", async () => {
  const other = fixture({ userId: reviewer });
  assert.equal((await other.request("GET")).status, 404);
  assert.deepEqual(other.calls, ["source_documents"]);
  for (const f of [fixture(), fixture({ role: "admin", userId: reviewer })]) {
    const response = await f.request("GET");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal((await response.json()).history.length, 1);
  }
});
