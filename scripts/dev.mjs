import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

// Load local proxy settings before Node's HTTP client and Next's worker start.
// Nothing from this file is printed; it also contains server credentials.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const require = createRequire(import.meta.url);
const nodeOptions = [];
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) {
  if (!process.allowedNodeEnvironmentFlags.has("--use-env-proxy")) {
    console.error("本机代理需要支持 --use-env-proxy 的 Node.js，请使用 Node.js 24 或更新版本。");
    process.exit(1);
  }
  nodeOptions.push("--use-env-proxy");
}
const child = spawn(process.execPath, [
  ...nodeOptions, require.resolve("next/dist/bin/next"),
  "dev", "--hostname", "0.0.0.0", ...process.argv.slice(2),
], { stdio: "inherit", env: process.env, windowsHide: true });
child.on("error", () => {
  console.error("开发服务器启动失败，请检查 Node.js 和依赖是否已安装。");
  process.exitCode = 1;
});
child.on("exit", (code) => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => { child.kill(signal); });
}
