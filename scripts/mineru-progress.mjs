import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
if (!process.env.SUPABASE_SECRET_KEY) process.loadEnvFile(".env.local");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const catalog = JSON.parse(await readFile(".source-archive/source-catalog.json", "utf8"));
let pages = 0, complete = 0;
for (const doc of catalog.documents) {
  try { const parsed = JSON.parse(await readFile(`.source-archive/parsed/${doc.sha256}.json`, "utf8")); pages += parsed.pages.length; if (parsed.pages.length === doc.page_count) complete++; } catch (error) { if (error.code !== "ENOENT") throw error; }
}
const counts = {};
for (const status of ["pending", "edited", "published", "rejected"]) {
  const result = await db.from("source_review_candidates").select("id", { head: true, count: "exact" }).in("document_id", catalog.documents.map((doc) => doc.id)).eq("status", status);
  if (result.error) throw result.error;
  counts[status] = result.count;
}
const examples = await db.from("materials").select("id,skill,visibility,approval").in("id", ["c800ccf7-4cdc-4336-bb81-354f3d4d7d43", "0807ced8-2623-4db6-ac79-6ea4c99f2e84", "8c505a4f-406d-406a-8665-7b5ecbe8d6b5", "ed7b04d1-8fc0-45cf-8a7a-026909d3768c"]);
if (examples.error) throw examples.error;
console.log(JSON.stringify({ local: { completeDocuments: complete, totalDocuments: catalog.documents.length, coveredPages: pages, totalPages: catalog.totalPages ?? catalog.documents.reduce((s, d) => s + d.page_count, 0) }, candidates: counts, representativeExercises: examples.data }, null, 2));
