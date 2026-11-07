import "server-only";

/** Where variables come from: process.env by default, a plain object in tests. */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/** One server-only environment variable an integration reads. */
export type EnvVarSpec = {
  /** For example FIRECRAWL_API_KEY. Never a NEXT_PUBLIC_ name. */
  name: string;
  /** Defaults to true. A missing required variable switches the integration off. */
  required?: boolean;
  /** Used when an optional variable is absent. */
  default?: string;
  /** Shape check. Problems name the variable, never its value. */
  pattern?: RegExp;
  /** What the pattern expects, for the message, for example "starts with fc-". */
  hint?: string;
  /** Must be an https URL (http is allowed for localhost). */
  url?: boolean;
};

type ValueOf<Spec extends EnvVarSpec> = Spec extends { required: false }
  ? Spec extends { default: string }
    ? string
    : string | undefined
  : string;

export type EnvValues<Specs extends Record<string, EnvVarSpec>> = {
  [Key in keyof Specs]: ValueOf<Specs[Key]>;
};

export type IntegrationEnv<Specs extends Record<string, EnvVarSpec>> =
  /** Every required variable is present and well formed. */
  | { state: "ready"; values: EnvValues<Specs> }
  /** A required variable is absent, so the integration is simply not in use. */
  | { state: "off"; reason: string }
  /** Something is set but wrong. Fix it before relying on the integration. */
  | { state: "invalid"; reason: string };

/** What /dev/integrations shows. Never includes a value. */
export type IntegrationStatus = {
  id: string;
  name: string;
  state: "ready" | "off" | "invalid";
  detail: string;
  /** The variables to set, by name. */
  variables: string[];
  docs: string;
};

const PLACEHOLDER =/^<.*>$|your[-_ ]|placeholder|changeme|^x{3,}$/i;

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Reads and checks an integration's variables. It never returns or logs a value
 * in a message, so the result is safe to show on a diagnostics page.
 */
export function readIntegrationEnv<const Specs extends Record<string, EnvVarSpec>>(
  specs: Specs,
  env: EnvSource = process.env,
): IntegrationEnv<Specs> {
  const values: Record<string, string | undefined> = {};
  const off: string[] = [];
  const invalid: string[] = [];

  for (const [key, spec] of Object.entries(specs)) {
    if (spec.name.startsWith("NEXT_PUBLIC_")) {
      throw new Error(`${spec.name}: integration variables must be server-only.`);
    }
    if (env[`NEXT_PUBLIC_${spec.name}`]) {
      invalid.push(
        `Remove NEXT_PUBLIC_${spec.name}. That prefix would send the value to every browser. Use ${spec.name}.`,
      );
    }

    const raw = env[spec.name]?.trim() || undefined;
    if (raw && PLACEHOLDER.test(raw)) {
      if (spec.required === false) values[key] = spec.default;
      else off.push(`${spec.name} still has its placeholder value`);
      continue;
    }
    if (!raw) {
      if (spec.required === false) values[key] = spec.default;
      else off.push(`${spec.name} is not set`);
      continue;
    }
    if (spec.pattern && !spec.pattern.test(raw)) {
      invalid.push(`${spec.name} doesn't look right${spec.hint ? ` (it should ${spec.hint})` : ""}`);
      continue;
    }
    if (spec.url && !isValidUrl(raw)) {
      invalid.push(`${spec.name} must be an https URL`);
      continue;
    }
    values[key] = raw;
  }

  if (invalid.length) return { state: "invalid", reason: `${invalid.join(". ")}.` };
  if (off.length) return { state: "off", reason: `${off.join(", ")}.` };
  return { state: "ready", values: values as EnvValues<Specs> };
}
