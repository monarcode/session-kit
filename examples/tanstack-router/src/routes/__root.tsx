import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";

import type { auth } from "../auth";

export const Route = createRootRouteWithContext<{ auth: typeof auth }>()({
	component: Outlet,
});
