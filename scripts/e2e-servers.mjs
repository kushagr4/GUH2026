#!/usr/bin/env node
// Started by Playwright. Builds once, then serves that build on two ports.
import { spawn, spawnSync } from "node:child_process";

const NEXT = "node_modules/next/dist/bin/next";
const { APP_PORT = "3100", PROD_GATE_PORT = "3101" } = process.env;

const build = spawnSync(process.execPath, [NEXT, "build"], { stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);

const serve = (port, extraEnv) =>
  spawn(process.execPath, [NEXT, "start", "-p", port, "-H", "127.0.0.1"], {
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });

const servers = [
  serve(APP_PORT, { ENABLE_DEV_TOOLS: "true", AI_PROVIDER: "mock" }),
  serve(PROD_GATE_PORT, { ENABLE_DEV_TOOLS: "false" }),
];

const stop = () => {
  for (const server of servers) server.kill();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
for (const server of servers) server.on("exit", (code) => process.exit(code ?? 1));
