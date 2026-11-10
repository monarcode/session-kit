import { proxyJar } from "@monarcode/session-kit/next";
import { NextResponse, type NextRequest } from "next/server";

import { serverAuth } from "./lib/auth/server";

/**
 * Refreshes access that is about to expire before Server Components and
 * Server Functions read it: they can't set cookies while rendering, but
 * Proxy can, and Next passes the new cookie on to them. A failed refresh is
 * left for the page, which then reads the session as it was.
 */
export async function proxy(request: NextRequest) {
	const response = NextResponse.next();
	// The example's tokens live a minute: refresh in their last 15 seconds.
	await serverAuth
		.prepare(proxyJar(request, response), { skew: 15 })
		.catch(() => {});
	return response;
}

export const config = {
	// Pages and Server Functions, not Next's own files.
	matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
