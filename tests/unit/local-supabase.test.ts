import { describe, expect, it } from "vitest";
import {
  BEGIN,
  END,
  configPorts,
  failureHint,
  isLocalUrl,
  isPrivilegedKey,
  localSettings,
  localTestSettings,
  migrationFileVersions,
  parseMigrationList,
  parseStatus,
  parseStatusEnv,
  redact,
  schemaSignature,
  upsertEnv,
} from "../../scripts/local-supabase.mjs";

type Vars = Record<string, string>;

// Built at runtime so the repository's secret scanner doesn't flag test fixtures.
const fake = (...parts: string[]) => parts.join("");

const LOCAL = { url: "http://127.0.0.1:54321", key: "sb_publishable_localdemo" };

function jwt(payload: object): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.signature`;
}

describe("reading CLI status", () => {
  it("parses the JSON format", () => {
    const vars: Vars = parseStatus(
      'Stopped services: []\n{"API_URL":"http://127.0.0.1:54321","PUBLISHABLE_KEY":"sb_publishable_x","PORT":1}',
    );
    expect(vars.API_URL).toBe("http://127.0.0.1:54321");
    expect(vars.PUBLISHABLE_KEY).toBe("sb_publishable_x");
    expect(vars).not.toHaveProperty("PORT");
  });

  it("falls back to the env format, with quotes", () => {
    const vars: Vars = parseStatusEnv('API_URL="http://127.0.0.1:54321"\nANON_KEY=public');
    expect(vars.API_URL).toBe("http://127.0.0.1:54321");
    expect(parseStatus("ANON_KEY=public").ANON_KEY).toBe("public");
  });
});

describe("local settings", () => {
  const status: Vars = {
    API_URL: "http://127.0.0.1:54321/",
    PUBLISHABLE_KEY: "sb_publishable_demo",
    ANON_KEY: jwt({ role: "anon" }),
    SECRET_KEY: "sb_secret_demo",
    SERVICE_ROLE_KEY: jwt({ role: "service_role" }),
  };

  it("extracts only the URL and publishable key", () => {
    expect(localSettings(status)).toEqual({
      url: "http://127.0.0.1:54321",
      key: "sb_publishable_demo",
    });
  });

  it("falls back to the legacy anon key", () => {
    const legacy = { ...status };
    delete legacy.PUBLISHABLE_KEY;
    expect(localSettings(legacy).key).toBe(status.ANON_KEY);
  });

  it("rejects a hosted endpoint", () => {
    expect(() => localSettings({ API_URL: "https://abc.supabase.co", ANON_KEY: "public" })).toThrow();
  });

  it("never returns a privileged key as the browser key", () => {
    for (const key of ["sb_secret_x", jwt({ role: "service_role" })]) {
      expect(() => localSettings({ API_URL: LOCAL.url, PUBLISHABLE_KEY: key })).toThrow(/privileged/);
    }
    expect(() =>
      localSettings({ API_URL: LOCAL.url, ANON_KEY: "same", SERVICE_ROLE_KEY: "same" }),
    ).toThrow(/privileged/);
  });

  it("gives the secret key to test runners only", () => {
    expect(localTestSettings(status).secretKey).toBe("sb_secret_demo");
  });

  it("recognises local and privileged values", () => {
    expect(isLocalUrl("http://localhost:54321")).toBe(true);
    expect(isLocalUrl("http://127.0.0.1.example.com")).toBe(false);
    expect(isLocalUrl("not a url")).toBe(false);
    expect(isPrivilegedKey(jwt({ role: "anon" }))).toBe(false);
    expect(isPrivilegedKey(jwt({ role: "service_role" }))).toBe(true);
  });
});

describe("writing .env.local", () => {
  const block = [
    BEGIN,
    `NEXT_PUBLIC_SUPABASE_URL=${LOCAL.url}`,
    `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${LOCAL.key}`,
    END,
  ].join("\n");

  it("creates the file from .env.example, replacing only the placeholders", () => {
    const example = [
      "# REQUIRED",
      "NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key",
      "# ANTHROPIC_API_KEY=",
      "",
    ].join("\n");
    const result = upsertEnv(example, LOCAL);
    expect(result.conflict).toEqual([]);
    expect(result.text).toBe(`# REQUIRED\n${block}\n# ANTHROPIC_API_KEY=\n`);
  });

  it("keeps sponsor and AI keys and never writes a secret", () => {
    const existing = `${block}\nANTHROPIC_API_KEY=sk-ant-keepme\nELEVENLABS_API_KEY=keepme\n`;
    const result = upsertEnv(existing, { ...LOCAL, url: "http://127.0.0.1:54400" });
    expect(result.text).toContain("ANTHROPIC_API_KEY=sk-ant-keepme");
    expect(result.text).toContain("ELEVENLABS_API_KEY=keepme");
    expect(result.text).toContain("NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54400");
    expect(result.text).not.toMatch(/SECRET|SERVICE_ROLE/);
    expect(result.text.match(/NEXT_PUBLIC_SUPABASE_URL=/g)).toHaveLength(1);
  });

  it("is idempotent", () => {
    const once = upsertEnv("FOO=1\n", LOCAL).text;
    const twice = upsertEnv(once, LOCAL);
    expect(twice.changed).toBe(false);
    expect(twice.text).toBe(once);
  });

  it("refuses to replace hosted values without approval", () => {
    const hosted = [
      "NEXT_PUBLIC_SUPABASE_URL=https://abcd.supabase.co",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_cloud",
      "ANTHROPIC_API_KEY=sk-ant-keepme",
      "",
    ].join("\n");
    const result = upsertEnv(hosted, LOCAL);
    expect(result.changed).toBe(false);
    expect(result.text).toBe(hosted);
    expect(result.conflict).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    ]);
  });

  it("with approval, comments hosted values out instead of deleting them", () => {
    const hosted = [
      "NEXT_PUBLIC_SUPABASE_URL=https://abcd.supabase.co",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_cloud",
      "SUPABASE_SECRET_KEY=sb_secret_cloud",
      "ANTHROPIC_API_KEY=sk-ant-keepme",
      "",
    ].join("\n");
    const result = upsertEnv(hosted, LOCAL, { replaceHosted: true });
    expect(result.disabled).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_SECRET_KEY",
    ]);
    const active = result.text.split("\n").filter((line) => line && !line.startsWith("#"));
    expect(active).toEqual([
      `NEXT_PUBLIC_SUPABASE_URL=${LOCAL.url}`,
      `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${LOCAL.key}`,
      "ANTHROPIC_API_KEY=sk-ant-keepme",
    ]);
    expect(result.text).toContain("# [hosted value, disabled by npm run local:env] NEXT_PUBLIC_SUPABASE_URL=https://abcd.supabase.co");
  });

  it("upgrades a file written by the first version of this script", () => {
    const legacy = [
      "# GUH2026 Docker local Supabase. Generated automatically; gitignored.",
      "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_old",
      "",
    ].join("\n");
    expect(upsertEnv(legacy, LOCAL).text).toBe(`${block}\n`);
  });

  it("reads quoted values containing # as values, not comments", () => {
    const hosted = 'NEXT_PUBLIC_SUPABASE_URL="https://abcd.supabase.co/#x" # hosted\n';
    expect(upsertEnv(hosted, LOCAL).conflict).toEqual(["NEXT_PUBLIC_SUPABASE_URL"]);
    const local = "NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54321' # mine\n";
    expect(upsertEnv(local, LOCAL).conflict).toEqual([]);
  });

  it("keeps the block where it was when lines above it are dropped", () => {
    const existing = [
      "# top",
      "NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co",
      block,
      "AI_PROVIDER=mock",
      "",
    ].join("\n");
    const result = upsertEnv(existing, LOCAL).text;
    expect(result).toBe(`# top\n${block}\nAI_PROVIDER=mock\n`);
    expect(upsertEnv(result, LOCAL).changed).toBe(false);
  });

  it("keeps Windows line endings", () => {
    const result = upsertEnv("FOO=1\r\n", LOCAL);
    expect(result.text).toBe(`${block.replaceAll("\n", "\r\n")}\r\nFOO=1\r\n`);
  });
});

describe("CLI output handling", () => {
  it("masks credentials in any format the CLI prints", () => {
    const output = [
      `service_role key: ${jwt({ role: "service_role" })}`,
      `Secret       │ ${fake("sb_", "secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz")}`,
      "Secret Key   │ 850181e4652dd023b7a98c58ae0d2d34bd487ee0cc3254aed6eda37307425907",
      `DB_URL=${fake("postgresql", "://postgres:", "postgres", "@127.0.0.1:54322/postgres")}`,
      "JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long",
    ].join("\n");
    const masked = redact(output);
    expect(masked).not.toMatch(/eyJ|sb_secret_N7|850181e4|super-secret|:postgres@/);
    expect(masked).toContain("127.0.0.1:54322");
  });

  it("explains common start failures", () => {
    expect(failureHint("Bind for 0.0.0.0:54322 failed: port is already allocated")).toMatch(/port/);
    expect(failureHint("Cannot connect to the Docker daemon at unix:///var/run/docker.sock")).toMatch(/Docker is not running/);
    expect(failureHint("write /var/lib: no space left on device")).toMatch(/disk space/);
  });

  it("reads this project's ports from config.toml", () => {
    const toml = "[api]\nport = 54321\n[api.tls]\nenabled = false\n[db]\nport = 54322\nshadow_port = 54320\n[db.pooler]\nport = 54329\n[studio]\nport = 54323\n[local_smtp]\nport = 54324\n";
    expect(configPorts(toml)).toEqual([
      { name: "API", port: 54321 },
      { name: "Postgres", port: 54322 },
      { name: "Studio", port: 54323 },
      { name: "Mailpit", port: 54324 },
    ]);
  });

  it("compares migration files with the local history", () => {
    const list = [
      "  Local          | Remote         | Time (UTC)",
      "  ---------------|----------------|---------------------",
      "  20261105120000 | 20261105120000 | 2026-11-05 12:00:00",
      "  20261105120100 |                | 2026-11-05 12:01:00",
    ].join("\n");
    expect(parseMigrationList(list)).toEqual({
      files: ["20261105120000", "20261105120100"],
      applied: ["20261105120000"],
      target: undefined,
    });
    // The exact format printed by Supabase CLI 3.0.0.
    const v3 = [
      "   Local            | Local DB         | Time (UTC)            ",
      "  ------------------|------------------|-----------------------",
      "   `20261105120000` | `20261105120000` | `2026-11-05 12:00:00` ",
      "   `20261105120100` |                  | `2026-11-05 12:01:00` ",
    ].join("\n");
    expect(parseMigrationList(v3)).toEqual({
      files: ["20261105120000", "20261105120100"],
      applied: ["20261105120000"],
      target: "local",
    });
    // `--output-format json`, also the default when the CLI detects an agent.
    const json = JSON.stringify({
      migrations: [
        { local: "20261105120000", remote: "20261105120000", time: "2026-11-05 12:00:00" },
        { local: "20261105120100", remote: "", time: "2026-11-05 12:01:00" },
      ],
      target: { kind: "local", host: "127.0.0.1", port: 54322 },
    });
    expect(parseMigrationList(json)).toEqual({
      files: ["20261105120000", "20261105120100"],
      applied: ["20261105120000"],
      target: "local",
    });
    expect(parseMigrationList(json.replace('"local","host"', '"remote","host"')).target).toBe("remote");
    expect(migrationFileVersions(["20261105120100_b.sql", "README.md", "20261105120000_a.sql"])).toEqual([
      "20261105120000",
      "20261105120100",
    ]);
  });

  it("compares generated types by schema, not by generator formatting", () => {
    const hosted = [
      "export type Database = {",
      "  // Allows to automatically instantiate createClient with right options",
      "  __InternalSupabase: {",
      '    PostgrestVersion: "14.18"',
      "  }",
      "  public: {",
      "    Tables: {",
      "      notes: {",
      "        Row: {",
      "          id: string",
      "          body: string | null",
      "        }",
      "      }",
      "    }",
      "  }",
      "}",
      'type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">',
    ].join("\n");
    const local = [
      "export type Database = {",
      '  "public": {',
      "    Tables: {",
      '      "notes": {',
      '        Row: { "id": string, "body": string | null }',
      "        ComputedFields: never",
      "      }",
      "    }",
      "  }",
      "}",
      "type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>",
    ].join("\n");
    expect(schemaSignature(local)).toBe(schemaSignature(hosted));
    expect(schemaSignature(local.replace("body", "title"))).not.toBe(schemaSignature(hosted));
  });
});
