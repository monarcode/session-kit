import { NextResponse, type NextRequest } from "next/server";

import { session } from "./lib/auth/session";

/**
 * Refreshes access that is about to expire before any page or Server
 * Function reads it. Server Components can't set cookies while rendering, so
 * Proxy sets the new one, and Next passes it on to them. A failed refresh is
 * left for the page, which then reads the session as it was.
 */
export function proxy(request: NextRequest) {
	return session.refresh(request, NextResponse.next());
}

export const config = {
	// Pages and Server Functions, not Next's own files.
	matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
