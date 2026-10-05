import type { ReactNode } from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

import { useAuthRevalidation } from "@monarcode/session-kit/react-router";

import { auth } from "./auth";
import { AuthProvider } from "./hooks";
import { Pending } from "./ui";

export function Layout({ children }: { children: ReactNode }) {
	return (
		<html lang="en">
			<head>
				<meta charSet="utf-8" />
				<meta
					name="viewport"
					content="width=device-width, initial-scale=1"
				/>
				<title>session-kit with React Router (framework mode)</title>
				<Meta />
				<Links />
			</head>
			<body>
				{children}
				<ScrollRestoration />
				<Scripts />
			</body>
		</html>
	);
}

/** Re-runs client loaders after sign-in, sign-out, and profile updates. */
function Revalidate() {
	useAuthRevalidation();
	return <Outlet />;
}

// AuthProvider mounts the client in an effect, so the build-time prerender of
// this route starts nothing; the browser restores the session.
export default function App() {
	return (
		<AuthProvider client={auth}>
			<Revalidate />
		</AuthProvider>
	);
}

/** Prerendered into index.html, and shown until client loaders finish. */
export function HydrateFallback() {
	return <Pending />;
}
