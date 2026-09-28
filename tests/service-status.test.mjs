import test from "node:test";
import assert from "node:assert/strict";
import { serviceStatus } from "../lib/service-status.ts";
test("Service status reports missing names without returning any credential values", () => {
  const env = { SMTP_HOST: "smtp.qq.com", SMTP_PORT: "465", SMTP_USER: "fixture@example.com", SMTP_PASSWORD: "secret-fixture", SMTP_FROM: "fixture@example.com", AI_KEY_ENCRYPTION_SECRET: "short" };
  const status = serviceStatus(env, false);
  assert.equal(status.find((row) => row.id === "smtp").configured, true);
  assert.equal(status.find((row) => row.id === "ai").configured, false);
  assert.equal(status.find((row) => row.id === "website").configured, false);
  assert.ok(!JSON.stringify(status).includes("secret-fixture"));
  assert.ok(!JSON.stringify(status).includes("fixture@example.com"));
  assert.ok(status.find((row) => row.id === "backup").missing.includes("BACKUP_S3_BUCKET"));
});
