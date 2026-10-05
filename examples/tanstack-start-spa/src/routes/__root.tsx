/// <reference types="vite/client" />
import type { ReactNode } from "react";

import {
	createRootRouteWithContext,
	HeadContent,
	Outlet,
	Scripts,
} from "@tanstack/react-router";

import type { auth } from "../auth";

export const Route = createRootRouteWithContext<{ auth: typeof auth }>()({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "session-kit with TanStack Start" },
		],
	}),
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
