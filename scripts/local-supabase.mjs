#!/usr/bin/env node
// Docker-managed local Supabase with automatically generated frontend env.
// Never print CLI status output: it also contains privileged credentials.
import { spawnSync, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const CLI = "node_modules/supabase/dist/supabase.js";
const FILE = ".env.local";
const MARKER = "# GUH2026 Docker local Supabase. Generated automatically; gitignored.";
function fail(reason) { console.error("Local Supabase: " + reason); process.exit(1); }
function cli(args, capture = false) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8", stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    maxBuffer: 16 * 1024 * 1024
  });
  if (r.error) fail(r.error.message);
  return r;
}
export function parseStatusEnv(output) {
  const vars = {};
  for (const line of output.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (!match) continue;
    let v = match[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    vars[match[1]] = v;
  }
  return vars;
}
export function localSettings(output) {
  const vars = parseStatusEnv(output);
  const url = vars.API_URL || vars.SUPABASE_URL;
  const key = vars.PUBLISHABLE_KEY || vars.ANON_KEY;
  if (!url || !key) throw new Error("Could not read local API URL and public key from CLI status.");
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(parsed.hostname)) {
    throw new Error("Refusing a non-local Supabase URL.");
  }
  if (key.startsWith("sb_secret_") || key === vars.SERVICE_ROLE_KEY) {
    throw new Error("Refusing a privileged key for browser configuration.");
  }
  return { url: parsed.toString().replace(/\/$/, ""), key };
}
function getStatus() {
  const r = cli(["status", "-o", "env"], true);
  if (r.status !== 0) fail("Supabase not running. Start Docker Desktop and run npm run local:up.");
  try { return localSettings(r.stdout); }
  catch (error) { fail(error.message); }
}
function generate(settings) {
  if (existsSync(FILE) && !readFileSync(FILE, "utf8").startsWith(MARKER)) {
    fail(".env.local already has custom settings. Back it up or rename it before switching to Docker. No file was changed.");
  }
  writeFileSync(FILE, [
    MARKER,
    "NEXT_PUBLIC_SUPABASE_URL=" + settings.url,
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=" + settings.key,
    ""
  ].join("\n"), { mode: 0o600 });
  console.log("Configured .env.local with local public connection values only.");
}
function main() {
  if (!existsSync(CLI)) fail("Install project dependencies with npm ci.");
  const cmd = process.argv[2];
  if (cmd === "up" || cmd === "dev") {
    // The CLI may print local service_role/JWT secrets on start. Capture output.
    if (cli(["start"], true).status !== 0) fail("Could not start Docker Supabase. Check Docker Desktop, available disk space and ports.");
    generate(getStatus());
    if (cmd === "dev") {
      console.log("Starting Next.js on http://localhost:3000");
      const child = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "dev"], {
        stdio: "inherit", shell: process.platform === "win32"
      });
      child.on("error", error => fail(error.message));
      child.on("exit", code => { process.exitCode = code ?? 1; });
    }
  } else if (cmd === "env") {
    generate(getStatus());
  } else if (cmd === "status") {
    const {url} = getStatus();
    console.log("Local Supabase: " + url);
    console.log("Studio: http://127.0.0.1:54323");
  } else if (cmd === "stop") {
    if (cli(["stop"]).status !== 0) fail("Could not stop local Supabase.");
  } else if (cmd === "types") {
    getStatus();
    const r = cli(["gen", "types", "typescript", "--local", "--schema", "public"], true);
    if (r.status !== 0 || !r.stdout.includes("export type Database")) fail("Type generation failed; inspect the local stack and migrations.");
    writeFileSync("src/lib/supabase/database.types.ts", r.stdout);
    console.log("Generated local TypeScript types.");
  } else if (cmd === "reset") {
    if (process.env.GUH_ALLOW_LOCAL_RESET !== "true") fail("Local reset destroys local data. Explicitly set GUH_ALLOW_LOCAL_RESET=true to authorize.");
    getStatus();
    if (cli(["db", "reset", "--local"]).status !== 0) fail("Local database reset failed.");
  } else fail("Use npm run local:dev, local:up, local:stop, local:status, local:types or local:env.");
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
