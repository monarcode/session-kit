/// <reference types="vite/client" />
import type { ReactNode } from "react";

import { loadSession } from "@monarcode/session-kit/tanstack-start";
import {
	createRootRouteWithContext,
	HeadContent,
	Outlet,
	Scripts,
} from "@tanstack/react-router";

import type { AppAuth } from "../auth/client";
import { Unavailable } from "../ui";

export const Route = createRootRouteWithContext<{ auth: AppAuth }>()({
	// On the server, reads the request's session from the cookie, before any
	// guard runs. In the browser, the hydrated session is already there.
	beforeLoad: ({ context }) => loadSession(context.auth),
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "session-kit with TanStack Start (SSR)" },
		],
	}),
	errorComponent: ({ error }) => <Unavailable error={error} />,
	shellComponent: Document,
	component: Outlet,
});

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
