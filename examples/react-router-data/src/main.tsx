import { StrictMode } from "react";
import {
	createBrowserRouter,
	Outlet,
	RouterProvider,
	useNavigate,
	useRouteError,
	useSearchParams,
} from "react-router";

import { safeReturnTo } from "@monarcode/session-kit";
import {
	redirectIfSignedIn,
	requireSession,
	SessionOutlet,
	useAuthRevalidation,
} from "@monarcode/session-kit/react-router";
import { createRoot } from "react-dom/client";

import { auth } from "./auth";
import { AuthProvider } from "./hooks";
import { LoginForm, Pending, Profile, Unavailable } from "./ui";

/** Re-runs loaders after sign-in, sign-out, account switches, and profile updates. */
function Root() {
	useAuthRevalidation();
	return <Outlet />;
}

function Login() {
	const navigate = useNavigate();
	const [search] = useSearchParams();
	return (
		<LoginForm
			onSignedIn={() =>
				navigate(safeReturnTo(search.get("redirectTo")), { replace: true })
			}
		/>
	);
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
				loader: async ({ request }) => {
					const redirectTo = new URL(request.url).searchParams.get(
						"redirectTo",
					);
					await redirectIfSignedIn(auth, { redirectTo });
					return null;
				},
				element: <Login />,
			},
			{
				loader: ({ request }) =>
					requireSession(auth, { request, loginPath: "/login" }),
				errorElement: <RouteError />,
				element: <SessionOutlet loginPath="/login" pending={<Pending />} />,
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
