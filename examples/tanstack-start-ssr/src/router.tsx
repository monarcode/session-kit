import { connectSession } from "@monarcode/session-kit/tanstack-start";
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
	});
	// Sends the session the server read to the browser, without tokens, and
	// re-runs guards when it changes there.
	connectSession(router);
	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
