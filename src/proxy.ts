import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, getSessionSecret, isAuthEnabled, verifySessionToken } from "@/lib/auth/session";

/**
 * When APP_PASSWORD_HASH is set, every page needs a valid session, except the
 * sign-in page. When it is not set, the app is open (for local use and tests).
 */
export function proxy(request: NextRequest): NextResponse {
  if (!isAuthEnabled()) return NextResponse.next();
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (verifySessionToken(getSessionSecret(), token)) return NextResponse.next();

  if (request.method !== "GET") {
    return new NextResponse("Not signed in", { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"],
};
