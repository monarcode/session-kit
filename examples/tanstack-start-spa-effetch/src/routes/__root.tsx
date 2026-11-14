/// <reference types="vite/client" />
import type { ReactNode } from "react";

import { QueryProvider } from "@monarcode/effetch-query/react";
import { useAuth } from "@monarcode/session-kit/tanstack-router";
import {
	createRootRouteWithContext,
	HeadContent,
	Outlet,
	Scripts,
} from "@tanstack/react-router";

import type { auth } from "../auth";
import { makeQueryClient } from "../query";

export const Route = createRootRouteWithContext<{ auth: typeof auth }>()({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "session-kit with TanStack Start and Effect" },
		],
	}),
	shellComponent: Document,
	component: Root,
});

/** A query cache for each session, so no account sees another's data. */
function Root() {
	const account = useAuth((state) => state.sessionId ?? "signed-out");
	return (
		<QueryProvider make={makeQueryClient} resetKey={account}>
			<Outlet />
		</QueryProvider>
	);
}

function Document({ children }: { children: ReactNode }) {
	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body>
				{children}
				<Scripts />
			</body>
		</html>
	);
}
