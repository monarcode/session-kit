// How server code reads and changes the session.
import "server-only";
import { nextSession } from "@monarcode/session-kit/next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { serverAuth } from "./server";

/**
 * The session for Server Components, Server Functions, Route Handlers and
 * Proxy. Server Components read it with `get` and `require`, which can't set
 * cookies: Proxy refreshed it first, with `refresh`.
 */
export const session = nextSession(serverAuth, {
	cookies,
	redirect,
	// The example's tokens live a minute: refresh in their last 15 seconds.
	within: 15,
});
