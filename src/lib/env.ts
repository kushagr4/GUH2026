/**
 * Environment access for the whole app.
 *
 * NEXT_PUBLIC_* values are referenced literally because Next.js inlines them at
 * build time. Secret values (SUPABASE_SECRET_KEY, ANTHROPIC_API_KEY) are only
 * ever read in server-only modules, never here.
 */

export type SupabaseEnv =
  | { state: "ok"; url: string; publishableKey: string }
  | { state: "missing" | "placeholder" | "invalid" | "unsafe"; reason: string };

const PLACEHOLDER = /your-project-ref|your-publishable-key|placeholder/i;

/** True when a key is a privileged credential that must never reach a browser. */
export function isPrivilegedKey(key: string): boolean {
  if (key.startsWith("sb_secret_")) return true;
  const payload = key.split(".")[1];
  if (!key.startsWith("eyJ") || !payload) return false;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(atob(base64)) as { role?: unknown };
    return decoded.role === "service_role";
  } catch {
    return false;
  }
}

export function readSupabaseEnv(
  raw: { url?: string; key?: string } = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  },
): SupabaseEnv {
  const url = raw.url?.trim();
  const key = raw.key?.trim();

  if (!url || !key) {
    return {
      state: "missing",
      reason:
        "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must both be set in .env.local.",
    };
  }
  if (PLACEHOLDER.test(url) || PLACEHOLDER.test(key)) {
    return {
      state: "placeholder",
      reason:
        ".env.local still contains placeholder values. Run `npm run local:dev` to fill them in for local Supabase, or set the hosted project URL and publishable key.",
    };
  }
  if (isPrivilegedKey(key)) {
    return {
      state: "unsafe",
      reason:
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY holds a secret key. Replace it with the publishable key and rotate the secret.",
    };
  }
  try {
    const { protocol } = new URL(url);
    if (protocol !== "https:" && protocol !== "http:") throw new Error();
  } catch {
    return {
      state: "invalid",
      reason: "NEXT_PUBLIC_SUPABASE_URL is not a valid http(s) URL.",
    };
  }
  return { state: "ok", url: url.replace(/\/+$/, ""), publishableKey: key };
}

export function isSupabaseConfigured(): boolean {
  return readSupabaseEnv().state === "ok";
}

export function requireSupabaseEnv(): { url: string; publishableKey: string } {
  const env = readSupabaseEnv();
  if (env.state !== "ok") {
    throw new Error(`Supabase is not configured: ${env.reason}`);
  }
  return { url: env.url, publishableKey: env.publishableKey };
}

/**
 * /dev diagnostics are on in `next dev`. In a production build they return 404
 * unless ENABLE_DEV_TOOLS=true is set explicitly.
 */
export function isDevToolsEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.ENABLE_DEV_TOOLS === "true"
  );
}
