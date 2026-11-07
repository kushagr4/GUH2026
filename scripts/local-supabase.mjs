#!/usr/bin/env node
// Local development on the Supabase CLI's own container stack, with the
// frontend's .env.local written for you. Each teammate gets an independent
// local database built from supabase/migrations.
//
//   npm run local:dev      Start or reuse local Supabase, apply new migrations, write .env.local, run Next.js
//   npm run local:up       The same, without Next.js
//   npm run local:status   Check every local service and whether all migrations are applied
//   npm run local:stop     Stop the containers. Local data is kept
//   npm run local:env      Rewrite only the Supabase block in .env.local
//   npm run local:migrate  Apply new migration files to the local database
//   npm run local:types    Regenerate database types from the local schema (--check to compare)
//   npm run local:test     Integration and E2E tests against the local stack (integration | e2e)
//   npm run local:reset    Rebuild the local database from migrations. Deletes local data
//
// Safety rules for this file:
// - The CLI's start and status output contains privileged keys (service role,
//   JWT secret, S3 keys). It is always captured and never printed.
// - Only the API URL and publishable key are ever written to .env.local.
// - Every CLI call is local. None passes --remote or --linked, so nothing here
//   can reach the hosted project. The hosted wrappers live in scripts/db.mjs.
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { schemaSignature } from "./lib/db-types.mjs";
import { isLocalUrl, PLACEHOLDER } from "./lib/env.mjs";
import { runHealthChecks } from "./lib/health-checks.mjs";

// Re-exported for the unit tests.
export { isLocalUrl, schemaSignature };

const CLI = "node_modules/supabase/dist/supabase.js";
const NEXT = "node_modules/next/dist/bin/next";
const ENV_FILE = ".env.local";
const EXAMPLE_FILE = ".env.example";
const TYPES_FILE = "src/lib/supabase/database.types.ts";
const CONFIG_FILE = "supabase/config.toml";
const MIGRATIONS_DIR = "supabase/migrations";
const RESET_FLAG = "--yes-delete-local-data";
const SWITCH_FLAG = "--replace-hosted";

export const BEGIN = "# >>> local Supabase: managed by `npm run local:env`. Put your own settings outside this block. >>>";
export const END = "# <<< local Supabase <<<";
const LEGACY_MARKER = "# GUH2026 Docker local Supabase. Generated automatically; gitignored.";
const PUBLIC_VARS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];
const HOSTED_ONLY_VARS = ["SUPABASE_SECRET_KEY"];
const DISABLED_PREFIX = "# [hosted value, disabled by npm run local:env] ";

export class LocalError extends Error {}

// ---------------------------------------------------------------------------
// Pure helpers (unit tested in tests/unit/local-supabase.test.ts)
// ---------------------------------------------------------------------------

/** @typedef {Record<string, string>} StatusVars */

/**
 * Parses `KEY=value` lines, as printed by `supabase status -o env`.
 * @param {string} output
 * @returns {StatusVars}
 */
export function parseStatusEnv(output) {
  /** @type {StatusVars} */
  const vars = {};
  for (const line of output.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    vars[match[1]] = value;
  }
  return vars;
}

/**
 * Accepts `supabase status -o json` (preferred) or `-o env` output.
 * @param {string} output
 * @returns {StatusVars}
 */
export function parseStatus(output) {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(output.slice(start, end + 1));
      if (parsed && typeof parsed === "object") {
        return Object.fromEntries(
          Object.entries(parsed).filter(([, value]) => typeof value === "string"),
        );
      }
    } catch {
      // Fall through to the env format.
    }
  }
  return parseStatusEnv(output);
}

/**
 * True for a key that bypasses RLS: a new secret key or a legacy service_role JWT.
 * @param {string} key
 */
export function isPrivilegedKey(key) {
  if (key.startsWith("sb_secret_")) return true;
  const payload = key.split(".")[1];
  if (!key.startsWith("eyJ") || !payload) return false;
  try {
    const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return JSON.parse(json).role === "service_role";
  } catch {
    return false;
  }
}

function privilegedValues(vars) {
  return [vars.SECRET_KEY, vars.SERVICE_ROLE_KEY].filter(Boolean);
}

/**
 * The two browser-safe values. Throws rather than ever returning a privileged key.
 * @param {StatusVars} vars
 * @returns {{ url: string, key: string }}
 */
export function localSettings(vars) {
  const url = vars.API_URL || vars.SUPABASE_URL;
  const key = vars.PUBLISHABLE_KEY || vars.ANON_KEY;
  if (!url || !key) {
    throw new LocalError("Could not read the local API URL and publishable key from the CLI status.");
  }
  if (!isLocalUrl(url)) throw new LocalError("Refusing a Supabase URL that is not on this machine.");
  if (isPrivilegedKey(key) || privilegedValues(vars).includes(key)) {
    throw new LocalError("Refusing to use a privileged key as the browser key.");
  }
  return { url: url.replace(/\/+$/, ""), key };
}

/**
 * Values for the test runners only. The secret key never reaches a file.
 * @param {StatusVars} vars
 * @returns {{ url: string, key: string, secretKey: string }}
 */
export function localTestSettings(vars) {
  const { url, key } = localSettings(vars);
  const secretKey = vars.SECRET_KEY || vars.SERVICE_ROLE_KEY || "";
  return { url, key, secretKey };
}

const ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

/** The value of a dotenv assignment: quoted (where # is literal) or bare (where ` #` starts a comment). */
function unquote(value) {
  const quoted = /^\s*(["'])(.*?)\1/.exec(value);
  if (quoted) return quoted[2];
  return value.replace(/\s+#.*$/, "").trim();
}

/**
 * True when a Supabase value in .env.local is safe to replace without asking:
 * a placeholder, a local URL, or a key next to such a URL. A key
 * with a hosted URL, or with no URL at all, is treated as hosted.
 */
function isReplaceable(name, value, urlReplaceable) {
  if (!value || PLACEHOLDER.test(value)) return true;
  if (name === "NEXT_PUBLIC_SUPABASE_URL") return isLocalUrl(value);
  return urlReplaceable;
}

/**
 * Returns the new .env.local text. Only the managed block and the two public
 * Supabase lines are touched; every other line, including sponsor and AI keys,
 * is kept exactly. A hosted URL or key is never replaced unless `replaceHosted`
 * is set, and then it is commented out rather than deleted.
 * @param {string} text
 * @param {{ url: string, key: string }} settings
 * @param {{ replaceHosted?: boolean }} [options]
 * @returns {{ text: string, changed: boolean, conflict: string[], disabled: string[] }}
 */
export function upsertEnv(text, settings, { replaceHosted = false } = {}) {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text === "" ? [] : text.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();

  const block = [
    BEGIN,
    `NEXT_PUBLIC_SUPABASE_URL=${settings.url}`,
    `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${settings.key}`,
    END,
  ];

  const begin = lines.indexOf(BEGIN);
  const end = lines.indexOf(END);
  /** @type {string[]} */
  const disabled = [];

  // Pull out any existing managed block first, marking where it was.
  const BLOCK_SLOT = Symbol("block");
  /** @type {(string | symbol)[]} */
  let rest = lines;
  if (begin !== -1 && end > begin) {
    rest = [...lines.slice(0, begin), BLOCK_SLOT, ...lines.slice(end + 1)];
  }

  // Look at Supabase assignments outside the block.
  const urlValue = rest
    .map((line) => (typeof line === "string" ? ASSIGNMENT.exec(line) : null))
    .find((match) => match?.[1] === "NEXT_PUBLIC_SUPABASE_URL")?.[2];
  const urlReplaceable = urlValue !== undefined && isReplaceable("NEXT_PUBLIC_SUPABASE_URL", unquote(urlValue));
  /** @type {{ name: string, line: string }[]} */
  const hosted = [];
  /** @type {string[]} */
  const kept = [];
  let insertAt = -1;
  for (const line of rest) {
    if (line === BLOCK_SLOT) {
      insertAt = kept.length;
      continue;
    }
    if (typeof line !== "string" || line === LEGACY_MARKER) continue;
    const match = ASSIGNMENT.exec(line);
    const name = match?.[1];
    if (name && PUBLIC_VARS.includes(name)) {
      if (isReplaceable(name, unquote(match[2]), urlReplaceable)) {
        if (insertAt === -1) insertAt = kept.length;
        continue;
      }
      hosted.push({ name, line });
      if (insertAt === -1) insertAt = kept.length;
      kept.push(line);
      continue;
    }
    kept.push(line);
  }

  if (hosted.length && !replaceHosted) {
    return {
      changed: false,
      conflict: hosted.map((entry) => entry.name),
      disabled: [],
      text,
    };
  }

  let output = kept.map((line) => {
    const match = ASSIGNMENT.exec(line);
    const name = match?.[1];
    if (!name) return line;
    const isHostedPublic = hosted.some((entry) => entry.line === line);
    const isHostedSecret =
      replaceHosted && hosted.length > 0 && HOSTED_ONLY_VARS.includes(name) && unquote(match[2]);
    if (isHostedPublic || isHostedSecret) {
      disabled.push(name);
      return DISABLED_PREFIX + line;
    }
    return line;
  });

  if (insertAt === -1) insertAt = 0;
  output = [...output.slice(0, insertAt), ...block, ...output.slice(insertAt)];
  const next = output.join(newline) + newline;
  return { changed: next !== text, conflict: [], disabled, text: next };
}

/**
 * Masks anything that looks like a credential before CLI output is shown.
 * @param {string} text
 */
export function redact(text) {
  return text
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s]+@/g, "$1[redacted]@")
    .replace(
      /((?:secret|key|password|token)[^\n]{0,24}?(?:[=:│|]\s*))[^\s│|]{6,}/gi,
      "$1[redacted]",
    );
}

/**
 * Turns CLI failure output into a next step a teammate can act on.
 * @param {string} output
 */
export function failureHint(output) {
  if (/port is already allocated|address already in use|ports are not available/i.test(output)) {
    return "A port that Supabase needs is already taken, probably by another Supabase project. See the port check advice in docs/docker-development.md.";
  }
  if (/cannot connect to the docker daemon|docker daemon is not running|error during connect|docker_engine|is the docker daemon running/i.test(output)) {
    return "Docker is not running. Start Docker Desktop, wait until it says it is running, then try again.";
  }
  if (/no space left on device/i.test(output)) {
    return "Docker has run out of disk space. Free space in Docker Desktop (Troubleshoot > Clean / Purge data, or `docker system prune` for unused images) and try again.";
  }
  if (/toomanyrequests|rate limit/i.test(output)) {
    return "The image registry rate-limited the download. Wait a few minutes and try again.";
  }
  if (/unhealthy|health check/i.test(output)) {
    return "A service did not become healthy in time. Run the same command again. If it keeps failing, run npm run local:stop, then npm run local:up.";
  }
  return "Check that Docker Desktop is running and has at least 4 GB of memory, then try again.";
}

/**
 * Reads the host ports this project's stack binds from supabase/config.toml.
 * @param {string} toml
 * @returns {{ name: string, port: number }[]}
 */
export function configPorts(toml) {
  /** @type {Record<string, string>} */
  const wanted = { api: "API", db: "Postgres", studio: "Studio", local_smtp: "Mailpit", inbucket: "Mailpit" };
  const ports = [];
  let section = "";
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.trim();
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      section = header[1];
      continue;
    }
    const port = /^port\s*=\s*(\d+)/.exec(line);
    if (port && wanted[section]) ports.push({ name: wanted[section], port: Number(port[1]) });
  }
  return ports;
}

/**
 * Splits `supabase migration list` output into file versions and applied versions.
 * @param {string} output
 */
export function parseMigrationList(output) {
  /** @type {string[]} */
  const files = [];
  /** @type {string[]} */
  const applied = [];
  /** @type {string | undefined} */
  let target;

  // `--output-format json`, which the CLI also picks by itself when it detects an agent.
  const start = output.indexOf("{");
  if (start !== -1) {
    try {
      const parsed = JSON.parse(output.slice(start, output.lastIndexOf("}") + 1));
      if (Array.isArray(parsed.migrations)) {
        for (const row of parsed.migrations) {
          if (/^\d{14}$/.test(row.local ?? "")) files.push(row.local);
          if (/^\d{14}$/.test(row.remote ?? "")) applied.push(row.remote);
        }
        return { files, applied, target: parsed.target?.kind };
      }
    } catch {
      // Fall through to the table format.
    }
  }

  for (const line of output.split(/\r?\n/)) {
    // CLI v3 prints a markdown table with each value in backticks.
    if (/\|\s*Local DB\s*\|/.test(line)) target = "local";
    const cells = line.split(/[|│]/).map((cell) => cell.replace(/[`*]/g, "").trim());
    if (cells.length < 2) continue;
    const [local, remote] = cells;
    if (!/^\d{14}$/.test(local) && !/^\d{14}$/.test(remote)) continue;
    if (/^\d{14}$/.test(local)) files.push(local);
    if (/^\d{14}$/.test(remote)) applied.push(remote);
  }
  return { files, applied, target };
}

/**
 * @param {string[]} names
 * @returns {string[]}
 */
export function migrationFileVersions(names) {
  return names
    .map((name) => /^(\d{14})_.+\.sql$/.exec(name)?.[1])
    .filter(Boolean)
    .sort();
}

// ---------------------------------------------------------------------------
// Side effects
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const tail = (text, count) => text.trim().split(/\r?\n/).slice(-count).join("\n");

function cliSync(args, { capture = true } = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw new LocalError(result.error.message);
  return result;
}

/** Long-running CLI call with captured output and a heartbeat, so nothing secret is printed. */
function cliWithHeartbeat(args, message) {
  return new Promise((done, failed) => {
    const child = spawn(process.execPath, [CLI, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const started = Date.now();
    const timer = setInterval(() => {
      console.log(`  ${message} (${Math.round((Date.now() - started) / 1000)}s)`);
    }, 15_000);
    child.on("error", (error) => {
      clearInterval(timer);
      failed(new LocalError(error.message));
    });
    child.on("close", (status) => {
      clearInterval(timer);
      done({ status, stdout, stderr });
    });
  });
}

function dockerState() {
  const result = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
    encoding: "utf8",
    timeout: 20_000,
  });
  if (result.error?.code === "ENOENT") return "missing";
  return result.status === 0 ? "running" : "stopped";
}

const INSTALL_DOCKER = {
  darwin: "Install Docker Desktop for Mac (Apple silicon or Intel) from https://docs.docker.com/desktop/setup/install/mac-install/, open it once, then run this again.",
  win32: "Install Docker Desktop for Windows with the WSL 2 backend from https://docs.docker.com/desktop/setup/install/windows-install/, open it once, then run this again.",
  linux: "Install Docker Engine (https://docs.docker.com/engine/install/) or Docker Desktop for Linux, then run this again.",
};

async function ensureDocker() {
  let state = dockerState();
  if (state === "running") return;
  if (state === "missing") {
    throw new LocalError(`Docker was not found.\n${INSTALL_DOCKER[process.platform] ?? INSTALL_DOCKER.linux}`);
  }
  if (process.platform === "darwin" && existsSync("/Applications/Docker.app")) {
    console.log("Docker Desktop is not running. Opening it now...");
    spawnSync("open", ["-a", "Docker"]);
    for (let waited = 0; waited < 120; waited += 3) {
      await sleep(3000);
      state = dockerState();
      if (state === "running") {
        console.log("Docker Desktop is running.");
        return;
      }
    }
  }
  const how = {
    darwin: "Open Docker Desktop from Applications and wait until it shows 'Engine running'.",
    win32: "Start Docker Desktop from the Start menu and wait until it shows 'Engine running'.",
    linux: "Start Docker (for example `sudo systemctl start docker`). If it is running, add yourself to the docker group and log in again.",
  };
  throw new LocalError(`Docker is installed but not running.\n${how[process.platform] ?? how.linux}`);
}

function readStatus() {
  const result = cliSync(["status", "-o", "json"]);
  if (result.status !== 0) return null;
  const vars = parseStatus(result.stdout);
  return vars.API_URL ? vars : null;
}

function portInUse(port) {
  return new Promise((done) => {
    const socket = connect({ host: "127.0.0.1", port });
    const finish = (inUse) => {
      socket.destroy();
      done(inUse);
    };
    socket.setTimeout(700, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

function otherSupabaseProjects() {
  const result = spawnSync("docker", ["ps", "--format", "{{.Names}}"], { encoding: "utf8" });
  if (result.status !== 0) return [];
  return [
    ...new Set(
      result.stdout
        .split(/\r?\n/)
        .map((name) => /^supabase_db_(.+)$/.exec(name.trim())?.[1])
        .filter(Boolean),
    ),
  ];
}

async function checkPorts() {
  const ports = configPorts(readFileSync(CONFIG_FILE, "utf8"));
  const inUse = await Promise.all(ports.map(({ port }) => portInUse(port)));
  const busy = ports.filter((_, index) => inUse[index]).map(({ name, port }) => `${port} (${name})`);
  if (!busy.length) return;
  const others = otherSupabaseProjects();
  const advice = others.length
    ? `Another local Supabase project is running: ${others.join(", ")}. Stop it from its own folder with \`npx supabase stop\`, or here with \`npx supabase stop --project-id ${others[0]}\`. Its data is kept.`
    : "Find what is using them (macOS/Linux: `lsof -nP -iTCP:<port> -sTCP:LISTEN`, Windows: `netstat -ano | findstr :<port>`) and stop it.";
  throw new LocalError(`These ports are already in use: ${busy.join(", ")}.\n${advice}`);
}

async function ensureRunning() {
  if (!existsSync(CLI)) throw new LocalError("Project dependencies are missing. Run npm ci first.");
  await ensureDocker();

  const running = readStatus();
  if (running) {
    console.log("Local Supabase is already running. Reusing it.");
    return running;
  }

  await checkPorts();
  console.log("Starting local Supabase. The first run downloads the images and can take a few minutes.");
  const result = await cliWithHeartbeat(["start"], "still starting");
  if (result.status !== 0) {
    const output = `${result.stdout}\n${result.stderr}`;
    throw new LocalError(
      `Could not start local Supabase.\n${failureHint(output)}\n\nLast CLI lines, with credentials masked:\n${redact(tail(result.stderr || result.stdout, 12))}`,
    );
  }
  const vars = readStatus();
  if (!vars) throw new LocalError("Supabase started, but its status could not be read. Run npm run local:status.");
  console.log("Local Supabase started.");
  return vars;
}

function migrate(extra = []) {
  const allowed = extra.filter((arg) => arg === "--include-all");
  const result = cliSync(["migration", "up", ...allowed]);
  const output = redact(`${result.stdout}\n${result.stderr}`).trim();
  if (result.status !== 0) {
    const hint = /insert(ed)? before the last migration|--include-all/i.test(output)
      ? "\nA pulled migration is older than one already applied. Run npm run local:migrate -- --include-all."
      : "";
    throw new LocalError(`Applying migrations to the local database failed.\n${output}${hint}`);
  }
  const applied = output.split(/\r?\n/).filter((line) => /applying migration/i.test(line));
  console.log(applied.length ? applied.join("\n") : "Local database is up to date with supabase/migrations.");
}

function writeEnv(vars, { replaceHosted = false } = {}) {
  const settings = localSettings(vars);
  const exists = existsSync(ENV_FILE);
  const current = exists
    ? readFileSync(ENV_FILE, "utf8")
    : existsSync(EXAMPLE_FILE)
      ? readFileSync(EXAMPLE_FILE, "utf8")
      : "";
  const result = upsertEnv(current, settings, { replaceHosted });

  if (result.conflict.length) {
    throw new LocalError(
      `${ENV_FILE} points at a hosted Supabase project (${result.conflict.join(", ")}), so it was not changed.\n` +
        `To switch this checkout to local Supabase, run: npm run local:env -- ${SWITCH_FLAG}\n` +
        `That saves a backup, comments out the hosted values and keeps all your other settings.`,
    );
  }
  if (!result.changed && exists) {
    console.log(`${ENV_FILE} already points at local Supabase.`);
    return;
  }
  if (exists && result.disabled?.length) {
    const backup = `${ENV_FILE}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    copyFileSync(ENV_FILE, backup);
    console.log(`Saved the previous file as ${backup}. Commented out: ${result.disabled.join(", ")}.`);
  }
  writeFileSync(ENV_FILE, result.text, { mode: 0o600 });
  console.log(
    `${exists ? "Updated" : "Created"} ${ENV_FILE} with the local API URL and publishable key only. Your other settings are unchanged.`,
  );
}

function warnAboutOverrides() {
  const shellUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (shellUrl && !isLocalUrl(shellUrl)) {
    console.warn("WARN  NEXT_PUBLIC_SUPABASE_URL is set in your shell, and Next.js prefers it over .env.local. Unset it to use local Supabase.");
  }
  for (const file of [".env.development.local", ".env.development"]) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    if (/^\s*(?:export\s+)?NEXT_PUBLIC_SUPABASE_(URL|PUBLISHABLE_KEY)\s*=/m.test(text)) {
      console.warn(`WARN  ${file} also sets Supabase values, and in development Next.js prefers it over .env.local.`);
    }
  }
}

function printSummary(vars) {
  console.log("");
  console.log(`  API          ${vars.API_URL}`);
  if (vars.STUDIO_URL) console.log(`  Studio       ${vars.STUDIO_URL}`);
  const mail = vars.MAILPIT_URL || vars.INBUCKET_URL;
  if (mail) console.log(`  Test emails  ${mail}`);
  console.log("  Data is kept when you stop: npm run local:stop");
  console.log("");
}

async function probeRealtime(url, key) {
  if (typeof WebSocket === "undefined") return { ok: false, detail: "Needs Node.js 22 or newer." };
  const socketUrl = `${url.replace(/^http/, "ws")}/realtime/v1/websocket?apikey=${encodeURIComponent(key)}&vsn=1.0.0`;
  return new Promise((done) => {
    const started = Date.now();
    const socket = new WebSocket(socketUrl);
    const finish = (result) => {
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // Already closed.
      }
      done(result);
    };
    const timer = setTimeout(() => finish({ ok: false, detail: "No reply within 5 s." }), 5000);
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ topic: "phoenix", event: "heartbeat", payload: {}, ref: "1" }));
    });
    socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (message.ref === "1") {
          const ok = message.payload?.status === "ok";
          finish({ ok, detail: ok ? `${Date.now() - started} ms, websocket heartbeat answered` : "Unexpected reply." });
        }
      } catch {
        finish({ ok: false, detail: "Unreadable reply." });
      }
    });
    socket.addEventListener("error", () => finish({ ok: false, detail: "Could not open the websocket." }));
  });
}

async function status() {
  if (!existsSync(CLI)) throw new LocalError("Project dependencies are missing. Run npm ci first.");
  if (dockerState() !== "running") throw new LocalError("Docker is not running. Start Docker Desktop, then run npm run local:up.");
  const vars = readStatus();
  if (!vars) throw new LocalError("Local Supabase is not running. Start it with npm run local:up.");
  const { url, key } = localSettings(vars);

  let failed = false;
  const report = (ok, label, detail) => {
    if (!ok) failed = true;
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}: ${detail}`);
  };

  for (const { name, ok, detail } of await runHealthChecks(url, key, { local: true })) {
    report(ok, name === "Database" ? "REST API and RLS" : name, detail);
  }
  const realtime = await probeRealtime(url, key);
  report(realtime.ok, "Realtime", realtime.detail);

  if (vars.STUDIO_URL) {
    const studio = await fetch(vars.STUDIO_URL, { signal: AbortSignal.timeout(8000) }).catch(() => null);
    report(Boolean(studio?.ok), "Studio", studio?.ok ? vars.STUDIO_URL : "Not reachable.");
  }

  const list = cliSync(["migration", "list", "--output-format", "json"]);
  if (list.status !== 0) {
    report(false, "Postgres and migrations", redact(tail(list.stderr || list.stdout, 5)));
  } else {
    const files = migrationFileVersions(readdirSync(MIGRATIONS_DIR));
    const { applied, target } = parseMigrationList(list.stdout);
    if (target !== "local") throw new LocalError("The migration list did not come from the local stack. Stopping.");
    const pending = files.filter((version) => !applied.includes(version));
    const unknown = applied.filter((version) => !files.includes(version));
    if (pending.length) {
      report(false, "Migrations", `${pending.length} not applied (${pending.join(", ")}). Run npm run local:migrate.`);
    } else if (unknown.length) {
      report(false, "Migrations", `The local database has migrations with no file here (${unknown.join(", ")}). Did you switch branches?`);
    } else {
      report(true, "Postgres and migrations", `all ${files.length} migration files applied`);
    }
  }

  printSummary(vars);
  if (failed) process.exitCode = 1;
}

function generateTypes() {
  const result = cliSync(["gen", "types", "typescript", "--schema", "public"]);
  if (result.status !== 0 || !result.stdout.includes("export type Database")) {
    throw new LocalError(`Type generation failed.\n${redact(tail(result.stderr, 8))}`);
  }
  return result.stdout;
}

function runChild(command, args, env) {
  return new Promise((done) => {
    const child = spawn(command, args, { stdio: "inherit", env });
    const forward = (signal) => child.kill(signal);
    process.on("SIGINT", forward);
    process.on("SIGTERM", forward);
    child.on("close", (code) => {
      process.off("SIGINT", forward);
      process.off("SIGTERM", forward);
      done(code ?? 1);
    });
  });
}

async function runTests(which) {
  const vars = readStatus();
  if (!vars) throw new LocalError("Local Supabase is not running. Start it with npm run local:up.");
  migrate();
  const { url, key, secretKey } = localTestSettings(vars);
  // Shell values win over .env.test.local, so hosted test settings cannot leak in.
  const env = {
    ...process.env,
    SUPABASE_TEST_URL: url,
    SUPABASE_TEST_PUBLISHABLE_KEY: key,
    SUPABASE_TEST_SECRET_KEY: secretKey,
  };
  console.log(`Running tests against local Supabase at ${url}`);
  if (!["all", "integration", "e2e"].includes(which)) {
    throw new LocalError("Usage: npm run local:test [-- integration | e2e]");
  }
  // Both suites always run, so one failure never hides the other's result.
  const results = [];
  if (which !== "e2e") {
    const code = await runChild(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--project", "integration"], env);
    results.push(["Integration tests", code]);
  }
  if (which !== "integration") {
    const code = await runChild(process.execPath, ["node_modules/@playwright/test/cli.js", "test"], env);
    results.push(["Playwright", code]);
  }
  console.log("");
  for (const [name, code] of results) console.log(`${code === 0 ? "PASS" : "FAIL"}  ${name} against local Supabase`);
  process.exitCode = results.some(([, code]) => code !== 0) ? 1 : 0;
}

async function main() {
  const [command = "", ...args] = process.argv.slice(2);
  switch (command) {
    case "up":
    case "dev": {
      const vars = await ensureRunning();
      migrate();
      writeEnv(vars, { replaceHosted: args.includes(SWITCH_FLAG) });
      printSummary(vars);
      if (command === "up") {
        console.log("Ready. Start the app with npm run dev, or use npm run local:dev next time.");
        return;
      }
      warnAboutOverrides();
      const nextArgs = args.filter((arg) => arg !== SWITCH_FLAG);
      console.log("Starting Next.js at http://localhost:3000 (Ctrl+C to stop).");
      const code = await runChild(process.execPath, [NEXT, "dev", ...nextArgs], process.env);
      console.log("\nNext.js stopped. Local Supabase is still running, with your data. Stop it with npm run local:stop.");
      process.exitCode = code === 130 ? 0 : code;
      return;
    }
    case "env": {
      const vars = readStatus();
      if (!vars) throw new LocalError("Local Supabase is not running. Start it with npm run local:up.");
      writeEnv(vars, { replaceHosted: args.includes(SWITCH_FLAG) });
      return;
    }
    case "status":
      return status();
    case "stop": {
      if (dockerState() !== "running") {
        console.log("Docker is not running, so local Supabase is already stopped.");
        return;
      }
      // Never --no-backup: the data volume is kept for the next start.
      const result = cliSync(["stop"]);
      if (result.status !== 0) throw new LocalError(`Could not stop local Supabase.\n${redact(tail(result.stderr, 5))}`);
      console.log("Stopped local Supabase. Your local data is kept. Start again with npm run local:dev.");
      return;
    }
    case "migrate": {
      if (!readStatus()) throw new LocalError("Local Supabase is not running. Start it with npm run local:up.");
      migrate(args);
      return;
    }
    case "types": {
      if (!readStatus()) throw new LocalError("Local Supabase is not running. Start it with npm run local:up.");
      const generated = generateTypes();
      if (args.includes("--check")) {
        const current = existsSync(TYPES_FILE) ? readFileSync(TYPES_FILE, "utf8") : "";
        if (schemaSignature(current) !== schemaSignature(generated)) {
          throw new LocalError(`${TYPES_FILE} does not match the local schema. Run npm run local:types and commit the result.`);
        }
        console.log("PASS  Database types match the local schema.");
      } else if (existsSync(TYPES_FILE) && schemaSignature(readFileSync(TYPES_FILE, "utf8")) === schemaSignature(generated)) {
        // Leave the file alone, so local and hosted generators don't fight over formatting.
        console.log(`${TYPES_FILE} already matches the local schema. Not changed.`);
      } else {
        writeFileSync(TYPES_FILE, generated);
        console.log(`Updated ${TYPES_FILE} from the local schema. Commit it with your migration.`);
      }
      return;
    }
    case "test":
      return runTests(args[0] ?? "all");
    case "reset": {
      if (!args.includes(RESET_FLAG)) {
        throw new LocalError(
          `This deletes every row, user and file in YOUR local database and rebuilds it from supabase/migrations.\n` +
            `It never touches the hosted project. To confirm, run: npm run local:reset -- ${RESET_FLAG}`,
        );
      }
      if (!readStatus()) throw new LocalError("Local Supabase is not running. Start it with npm run local:up.");
      // Local by default in CLI v3. Never add --remote or --linked here.
      const result = cliSync(["db", "reset"]);
      if (result.status !== 0) throw new LocalError(`Local database reset failed.\n${redact(tail(result.stderr, 8))}`);
      console.log("Rebuilt the local database from supabase/migrations.");
      return;
    }
    default:
      throw new LocalError(
        "Usage: npm run local:dev | local:up | local:status | local:stop | local:env | local:migrate | local:types | local:test | local:reset",
      );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    if (error instanceof LocalError) {
      console.error(`\nLocal Supabase: ${error.message}`);
    } else {
      console.error(`\nLocal Supabase: unexpected error: ${redact(String(error?.stack ?? error))}`);
    }
    process.exit(1);
  });
}
