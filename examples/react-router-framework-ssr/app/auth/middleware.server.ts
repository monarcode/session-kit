import { redirect, type MiddlewareFunction } from "react-router";

import {
	cookieJarMiddleware,
	routerJar,
} from "@monarcode/session-kit/react-router/server";

import { serverAuth } from "./session.server";

/**
 * Refreshes access that is about to expire before loaders and actions read
 * it, while the response can still set the cookie. A failed refresh is left
 * for the loaders, which then read the session as it was.
 */
const refreshSession: MiddlewareFunction<Response> = async (
	{ context },
	next,
) => {
	// The example's tokens live a minute: refresh in their last 15 seconds.
	await serverAuth
		.refreshIfDue(routerJar(context), { within: 15 })
		.catch(() => {});
	const response = await next();
	// Every page and resource route here depends on who is signed in. A
	// copy: some responses, such as `fetch`'s, can't change their headers.
	const page = new Response(response.body, response);
	page.headers.set("Cache-Control", "private, no-store");
	return page;
};

/**
 * The root route's middleware. The jar comes first: it sets the cookies the
 * rest write on the response.
 */
export const sessionMiddleware = [cookieJarMiddleware, refreshSession];

/**
 * Sends signed-out users to the sign-in page, which brings them back. As
 * middleware, it runs on the server before any loader or action below the
 * route, for documents and for data requests alike.
 */
export const requireSession: MiddlewareFunction<Response> = async ({
	context,
	url,
}) => {
	if (!(await serverAuth.getSession(routerJar(context))))
		throw redirect(
			`/login?redirectTo=${encodeURIComponent(url.pathname + url.search)}`,
		);
};
