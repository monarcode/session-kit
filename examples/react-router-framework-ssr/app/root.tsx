import type { ReactNode } from "react";
import {
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
	useLoaderData,
	useRevalidator,
	useRouteError,
	type LoaderFunctionArgs,
} from "react-router";

import { AuthProvider, useMirrorAuth } from "@monarcode/session-kit/react";
import { routerJar } from "@monarcode/session-kit/react-router/server";

import { createAppAuth, type AppAuth } from "./auth/client";
import { sessionMiddleware } from "./auth/middleware.server";
import { serverAuth } from "./auth/session.server";

// Types `AuthProvider` and the hooks from `@monarcode/session-kit/react`
// with this client.
declare module "@monarcode/session-kit" {
	interface Register {
		auth: AppAuth;
	}
}

export const middleware = sessionMiddleware;

/** Who is signed in, from the cookie. Holds no tokens. */
export async function loader({ context }: LoaderFunctionArgs) {
	return { session: await serverAuth.getSession(routerJar(context)) };
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
				<title>session-kit with React Router (server rendering)</title>
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
 * Gives the components the session the loader read. `useMirrorAuth` follows
 * the loader when it reads another session, and runs the loaders again when
 * the session changes in the browser, as after a sign-out here or in another
 * tab, so the server's redirects run.
 */
export default function App() {
	const { session } = useLoaderData<typeof loader>();
	const { revalidate } = useRevalidator();
	const auth = useMirrorAuth({
		create: createAppAuth,
		session,
		onChange: revalidate,
	});
	return (
		<AuthProvider client={auth}>
			<Outlet />
		</AuthProvider>
	);
}

/** Shown when the server can't read or refresh the session. */
export function ErrorBoundary() {
	const error = useRouteError();
	const { revalidate } = useRevalidator();
	return (
		<div role="alert">
			<p>
				{error instanceof Error ? error.message : "Something went wrong"}
			</p>
			<button onClick={() => void revalidate()}>Retry</button>
		</div>
	);
}
