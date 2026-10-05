import { connectAuth } from "@monarcode/session-kit/tanstack-router";
import { createRouter } from "@tanstack/react-router";

import { auth } from "./auth";
import { routeTree } from "./routeTree.gen";
import { Pending } from "./ui";

export const router = createRouter({
	routeTree,
	context: { auth },
	defaultPendingComponent: Pending,
});

// Restores the session, runs expiry timers and tab sync, and re-runs guards.
connectAuth(router);

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}
