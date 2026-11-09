import { connectAuth } from "@monarcode/session-kit/tanstack-router";
import { sessionHydration } from "@monarcode/session-kit/tanstack-start";
import { createRouter } from "@tanstack/react-router";

import { createAppAuth } from "./auth/client";
import { routeTree } from "./routeTree.gen";
import { Pending } from "./ui";

export function getRouter() {
	const auth = createAppAuth();
	const router = createRouter({
		routeTree,
		context: { auth },
		defaultPendingComponent: Pending,
		scrollRestoration: true,
		// Sends the session the server read to the browser, without tokens.
		...sessionHydration(auth),
	});
	// Re-runs guards when the session changes. Does nothing on the server.
	connectAuth(router);
	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
