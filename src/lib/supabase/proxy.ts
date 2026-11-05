import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { readSupabaseEnv } from "@/lib/env";
import type { Database } from "./database.types";

export type SessionResult = {
  response: NextResponse;
  /** Verified JWT claims, or null when signed out or Supabase is unreachable. */
  userId: string | null;
};

/** Refreshes the auth cookie and reports who the request belongs to. */
export async function updateSession(
  request: NextRequest,
): Promise<SessionResult> {
  let response = NextResponse.next({ request });

  const env = readSupabaseEnv();
  if (env.state !== "ok") return { response, userId: null };

  const supabase = createServerClient<Database>(env.url, env.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        // Stops CDNs caching a response that carries someone's session cookie.
        for (const [key, value] of Object.entries(headers ?? {})) {
          response.headers.set(key, value);
        }
      },
    },
  });

  try {
    const { data } = await supabase.auth.getClaims();
    return { response, userId: data?.claims?.sub ?? null };
  } catch {
    // Never take the whole site down because Auth is briefly unreachable.
    return { response, userId: null };
  }
}
