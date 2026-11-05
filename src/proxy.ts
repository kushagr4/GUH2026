import { NextResponse, type NextRequest } from "next/server";
import { isDevToolsEnabled } from "@/lib/env";
import { ROUTES, isDevPath, isProtectedPath } from "@/lib/routes";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isDevPath(pathname) && !isDevToolsEnabled()) {
    return new NextResponse("Not found", { status: 404 });
  }

  const { response, userId } = await updateSession(request);

  if (isProtectedPath(pathname) && !userId) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = ROUTES.login;
    loginUrl.search = `?next=${encodeURIComponent(`${pathname}${search}`)}`;
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  // Static assets never need a session, which saves an auth check per file.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|woff2?)$).*)",
  ],
};
