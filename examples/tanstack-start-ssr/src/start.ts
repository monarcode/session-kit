import { startJar } from "@monarcode/session-kit/tanstack-start/server";
import {
	createCsrfMiddleware,
	createMiddleware,
	createStart,
} from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";

import { serverAuth } from "./auth/server";

/**
 * Refreshes access that is about to expire before routes and server
 * functions read it, while the response can still set the cookie. A failed
 * refresh is left for the route: `loadSession` then rejects, and the root
 * route's error component offers a retry.
 */
const sessionMiddleware = createMiddleware({ type: "request" }).server(
	async ({ next }) => {
		// Every page and server function here depends on who is signed in.
		setResponseHeader("Cache-Control", "private, no-store");
		// The example's tokens live a minute: refresh in their last 15 seconds.
		await serverAuth.refreshIfDue(startJar(), { within: 15 }).catch(() => {});
		return next();
	},
);

export const startInstance = createStart(() => ({
	requestMiddleware: [
		// Server functions read and write the session cookie: accept them from
		// this origin only. Page loads stay open to links from anywhere.
		createCsrfMiddleware({
			filter: ({ handlerType }) => handlerType === "serverFn",
		}),
		sessionMiddleware,
	],
}));
