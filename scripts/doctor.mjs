#!/usr/bin/env node
// New-machine preflight. Explains what is wrong and how to fix it: npm run doctor
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { describeSupabaseEnvProblem, isLocalUrl, loadEnvFiles } from "./lib/env.mjs";
import { runHealthChecks } from "./lib/health-checks.mjs";

let failed = false;
const report = (ok, label, detail = "") => {
  if (!ok) failed = true;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `: ${detail}` : ""}`);
};

const [major, minor] = process.versions.node.split(".").map(Number);
report(
  major > 22 || (major === 22 && minor >= 12),
  "Node.js",
  `${process.versions.node} (needs 22.12 or newer; 24 is recommended)`,
);
report(
  existsSync("node_modules/next/package.json"),
  "Dependencies",
  existsSync("node_modules/next/package.json") ? "installed" : "run npm install",
);

const hasEnvFile = existsSync(".env.local");
report(
  hasEnvFile,
  ".env.local",
  hasEnvFile ? "found" : "run npm run local:dev, which writes it for local Supabase",
);
loadEnvFiles(".env.local");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const problem = describeSupabaseEnvProblem(url, key);
const local = !problem && isLocalUrl(url);
report(
  !problem,
  "Supabase settings",
  problem ?? `${local ? "local" : "hosted"} (${new URL(url).host})`,
);

// Docker matters unless this checkout is deliberately pointed at the hosted project.
if (local || problem) {
  const docker = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
    encoding: "utf8",
    timeout: 20_000,
  });
  report(
    docker.status === 0,
    "Docker",
    docker.error?.code === "ENOENT"
      ? "not installed. Install Docker Desktop (see docs/docker-development.md)"
      : docker.status === 0
        ? `engine ${docker.stdout.trim()} running`
        : "installed but not running. Start Docker Desktop",
  );
}

for (const name of Object.keys(process.env)) {
  if (name.startsWith("NEXT_PUBLIC_") && /SECRET|SERVICE_ROLE|ANTHROPIC/.test(name)) {
    report(false, "Exposed secret", `${name} would be sent to browsers. Remove the NEXT_PUBLIC_ prefix.`);
  }
}

if (!problem) {
  for (const { name, ok, detail } of await runHealthChecks(url, key, { local })) {
    report(ok, `${local ? "Local" : "Hosted"} ${name}`, detail);
  }
}

console.log(
  failed
    ? "\nSome checks failed. See README.md and docs/docker-development.md."
    : `\nAll good. Run: ${local ? "npm run local:dev" : "npm run dev"}`,
);
if (failed) process.exit(1);
