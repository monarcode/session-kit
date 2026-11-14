import { StrictMode } from "react";
import {
	BrowserRouter,
	Navigate,
	Route,
	Routes,
	useSearchParams,
} from "react-router";

import { isSignedIn, safeReturnTo } from "@monarcode/session-kit";
import { AuthProvider, useAuth } from "@monarcode/session-kit/react";
import { SessionOutlet } from "@monarcode/session-kit/react-router";
import { createRoot } from "react-dom/client";

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
 * Doesn't navigate after `signIn`: the state change re-renders this page,
 * which then redirects.
 */
function Login() {
	const signedIn = useAuth(isSignedIn);
	const [search] = useSearchParams();
	if (signedIn)
		return <Navigate to={safeReturnTo(search.get("redirectTo"))} replace />;
	return <LoginForm />;
}

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<AuthProvider client={auth}>
			<BrowserRouter>
				<Routes>
					<Route path="/login" element={<Login />} />
					<Route
						element={
							<SessionOutlet
								pending={<Pending />}
								unavailable={({ error }) => (
									<Unavailable error={error} />
								)}
							/>
						}
					>
						<Route index element={<Profile />} />
					</Route>
				</Routes>
			</BrowserRouter>
		</AuthProvider>
	</StrictMode>,
);
