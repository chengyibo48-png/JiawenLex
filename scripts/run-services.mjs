import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const command = process.argv[2];
const tools = { check: "./services-check.mjs", backup: "./backup.mjs", originals: "./source-archive-upload.mjs" };
if (!Object.hasOwn(tools, command)) throw new Error("Usage: run-services.mjs check|backup|originals");
const flags = [];
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) {
  if (!process.allowedNodeEnvironmentFlags.has("--use-env-proxy")) throw new Error("Local proxy support requires Node.js 24 or newer");
  flags.push("--use-env-proxy");
}
const serviceArgs = command === "backup" && process.argv.length === 3 ? ["backup"] : process.argv.slice(3);
const child = spawn(process.execPath, [...flags, fileURLToPath(new URL(tools[command], import.meta.url)), ...serviceArgs], { env: process.env, stdio: "inherit", windowsHide: true });
child.on("error", () => { console.error("Could not start the service tool"); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
