import { NextResponse, type NextRequest } from "next/server";

import { session } from "./lib/auth/session";

/**
 * Refreshes access that is about to expire before Server Components and
 * Server Functions read it: they can't set cookies while rendering, but
 * Proxy can, and Next passes the new cookie on to them. A failed refresh is
 * left for the page, which then reads the session as it was.
 */
export function proxy(request: NextRequest) {
	return session.refresh(request, NextResponse.next());
}

export const config = {
	// Pages and Server Functions, not Next's own files.
	matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
