import { existsSync } from "node:fs";

/** Loads env files in order. Values already set in the shell are never overwritten. */
export function loadEnvFiles(...files) {
  const loaded = [];
  for (const file of files) {
    if (existsSync(file)) {
      process.loadEnvFile(file);
      loaded.push(file);
    }
  }
  return loaded;
}

export const PLACEHOLDER = /your-project-ref|your-publishable-key|placeholder/i;

/** True for a Supabase URL on this machine, which means the local Docker stack. */
export function isLocalUrl(value) {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

/** Returns null when usable, or a human-readable reason when not. */
export function describeSupabaseEnvProblem(url, key) {
  if (!url || !key) {
    return "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must both be set in .env.local.";
  }
  if (PLACEHOLDER.test(url) || PLACEHOLDER.test(key)) {
    return ".env.local still contains placeholder values. Ask the migration owner for the shared URL and publishable key.";
  }
  if (key.startsWith("sb_secret_")) {
    return "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY holds a SECRET key. Replace it with the publishable key and tell the migration owner so it can be rotated.";
  }
  try {
    new URL(url);
  } catch {
    return "NEXT_PUBLIC_SUPABASE_URL is not a valid URL.";
  }
  return null;
}
