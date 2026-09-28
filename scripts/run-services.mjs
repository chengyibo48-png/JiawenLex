import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const command = process.argv[2];
if (!["check", "backup"].includes(command)) throw new Error("Usage: run-services.mjs check|backup");
const flags = [];
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) {
  if (!process.allowedNodeEnvironmentFlags.has("--use-env-proxy")) throw new Error("Local proxy support requires Node.js 24 or newer");
  flags.push("--use-env-proxy");
}
const child = spawn(process.execPath, [...flags, fileURLToPath(new URL(command === "check" ? "./services-check.mjs" : "./backup.mjs", import.meta.url)), ...process.argv.slice(3)], { env: process.env, stdio: "inherit", windowsHide: true });
child.on("error", () => { console.error("Could not start the service tool"); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
