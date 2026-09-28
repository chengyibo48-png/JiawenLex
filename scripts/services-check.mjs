import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import { S3Client, HeadBucketCommand } from "@aws-sdk/client-s3";
import { serviceStatus } from "../lib/service-status.ts";
import { publicSiteUrl } from "../lib/reminders.ts";
let publicUrl = false;
try { publicSiteUrl(process.env.NEXT_PUBLIC_SITE_URL); publicUrl = true; } catch {}
const status = serviceStatus(process.env, publicUrl);
console.log("JiawenLex service readiness (configuration does not prove live delivery)");
for (const item of status) console.log(`${item.id}: ${item.configured ? "configuration present" : "setup required: " + item.missing.join(", ")}`);
console.log(`backup database: ${process.env.DATABASE_URL ? "configuration present" : "setup required: DATABASE_URL"}`);
for (const tool of ["pg_dump", "pg_restore", "psql"]) {
  const result = spawnSync(tool, ["--version"], { encoding: "utf8", windowsHide: true });
  console.log(`${tool}: ${result.status === 0 ? result.stdout.trim() : "not installed / not on PATH (PostgreSQL 17 client required)"}`);
}
if (process.argv.includes("--connect")) {
  const check = async (name, work) => {
    try { await work(); console.log(`${name}: connection verified`); }
    catch { console.log(`${name}: connection failed; check credentials, permissions and network`); process.exitCode = 1; }
  };
  const serverKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (serverKey && process.env.NEXT_PUBLIC_SUPABASE_URL) await check("supabase", async () => {
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, serverKey, { auth: { persistSession: false }, global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(15000) }) } });
    const { error } = await client.storage.listBuckets(); if (error) throw error;
  });
  if (status.find((item) => item.id === "smtp").configured) await check("smtp (login only; no message sent)", async () => {
    const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT), secure: Number(process.env.SMTP_PORT) === 465, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 10000, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } });
    try { await transport.verify(); } finally { transport.close(); }
  });
  if (status.find((item) => item.id === "backup").configured) await check("backup storage (read only)", async () => {
    const s3 = new S3Client({ endpoint: process.env.BACKUP_S3_ENDPOINT, region: process.env.BACKUP_S3_REGION, forcePathStyle: true, credentials: { accessKeyId: process.env.BACKUP_S3_ACCESS_KEY_ID, secretAccessKey: process.env.BACKUP_S3_SECRET_ACCESS_KEY } });
    try { await s3.send(new HeadBucketCommand({ Bucket: process.env.BACKUP_S3_BUCKET })); } finally { s3.destroy(); }
  });
}
console.log("Personal AI keys are configured inside Settings; no paid AI request was made.");
