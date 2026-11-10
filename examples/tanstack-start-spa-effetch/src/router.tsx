import { connectAuth } from "@monarcode/session-kit/tanstack-router";
import { createRouter } from "@tanstack/react-router";

import { auth } from "./auth";
import { routeTree } from "./routeTree.gen";
import { Pending } from "./ui";

export function getRouter() {
	const router = createRouter({
		routeTree,
		context: { auth },
		defaultPendingComponent: Pending,
		scrollRestoration: true,
	});
	// Does nothing while the build prerenders the shell, which then shows Pending.
	connectAuth(router);
	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
