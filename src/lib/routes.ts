export const ROUTES = {
  home: "/",
  login: "/login",
  signup: "/signup",
  dashboard: "/app/dashboard",
  embergap: "/app/embergap",
  account: "/app/account",
  dev: "/dev",
} as const;

/** Every page under this URL prefix requires a session (enforced in src/proxy.ts). */
export const PROTECTED_PREFIX = "/app";
export const DEV_PREFIX = "/dev";

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isProtectedPath(pathname: string): boolean {
  return matchesPrefix(pathname, PROTECTED_PREFIX);
}

export function isDevPath(pathname: string): boolean {
  return matchesPrefix(pathname, DEV_PREFIX);
}

/**
 * Makes a user-supplied `next` value safe to redirect to. Only same-origin
 * relative paths pass, which closes open-redirect tricks such as `//evil.test`
 * and `/\evil.test`.
 */
export function safeRedirectPath(
  value: unknown,
  fallback: string = ROUTES.dashboard,
): string {
  if (typeof value !== "string" || !value.startsWith("/")) return fallback;
  if (value.startsWith("//") || /[\\\u0000-\u001f]/.test(value)) return fallback;
  try {
    const base = "http://internal.invalid";
    const parsed = new URL(value, base);
    if (parsed.origin !== base) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
