import { refreshSession } from "@monarcode/session-kit/tanstack-start/server";
import {
	createCsrfMiddleware,
	createMiddleware,
	createStart,
} from "@tanstack/react-start";

import { serverAuth } from "./auth/server";

/**
 * Refreshes access that is about to expire before routes and server
 * functions read it, while the response can still set the cookie. Start
 * keeps what's inside `.server()` out of the browser bundle, `serverAuth`
 * included.
 */
const sessionMiddleware = createMiddleware({ type: "request" }).server(
	// The example's tokens live a minute: refresh in their last 15 seconds.
	refreshSession(serverAuth, { within: 15 }),
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
