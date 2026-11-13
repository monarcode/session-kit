import type { ReactNode } from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

import { AuthProvider } from "@monarcode/session-kit/react";
import { useAuthRevalidation } from "@monarcode/session-kit/react-router";

import { auth } from "./auth";
import { Pending } from "./ui";

// Types `AuthProvider` and the hooks from `@monarcode/session-kit/react`
// with this client.
declare module "@monarcode/session-kit" {
	interface Register {
		auth: typeof auth;
	}
}

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

/**
 * Re-runs the guards in client loaders after a sign-in, sign-out, account
 * switch, profile update, or a refresh that fails once access has expired.
 * Token refreshes alone don't.
 */
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
