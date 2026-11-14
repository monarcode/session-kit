import { StrictMode } from "react";
import { createBrowserRouter, Outlet, useRouteError } from "react-router";

import { AuthProvider } from "@monarcode/session-kit/react";
import {
	redirectIfSignedInLoader,
	requireSessionLoader,
	SessionOutlet,
	useAuthRevalidation,
} from "@monarcode/session-kit/react-router";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";

import { auth } from "./auth";
import { LoginForm, Pending, Profile, Unavailable } from "./ui";

// Types `AuthProvider` and the hooks from `@monarcode/session-kit/react`
// with this client.
declare module "@monarcode/session-kit" {
	interface Register {
		auth: typeof auth;
	}
}

/**
 * Re-runs the guards in loaders after a sign-in, sign-out, account switch,
 * profile update, or a refresh that fails once access has expired. Token
 * refreshes alone don't.
 */
function Root() {
	useAuthRevalidation();
	return <Outlet />;
}

function RouteError() {
	return <Unavailable error={useRouteError()} />;
}

const router = createBrowserRouter([
	{
		element: <Root />,
		HydrateFallback: Pending,
		children: [
			{
				path: "/login",
				loader: redirectIfSignedInLoader(auth),
				element: <LoginForm />,
			},
			{
				loader: requireSessionLoader(auth),
				errorElement: <RouteError />,
				element: <SessionOutlet pending={<Pending />} />,
				children: [{ index: true, element: <Profile /> }],
			},
		],
	},
]);

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<AuthProvider client={auth}>
			<RouterProvider router={router} />
		</AuthProvider>
	</StrictMode>,
);
