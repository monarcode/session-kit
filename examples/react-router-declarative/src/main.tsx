import { StrictMode } from "react";
import {
	BrowserRouter,
	Navigate,
	Route,
	Routes,
	useSearchParams,
} from "react-router";

import { safeReturnTo } from "@monarcode/session-kit";
import { SessionOutlet } from "@monarcode/session-kit/react-router";
import { createRoot } from "react-dom/client";

import { auth } from "./auth";
import { AuthProvider, useAuth } from "./hooks";
import { LoginForm, Pending, Profile, Unavailable } from "./ui";

/** Signing in changes state, and this page then navigates away. */
function Login() {
	const signedIn = useAuth((state) => state.user !== null);
	const [search] = useSearchParams();
	if (signedIn)
		return <Navigate to={safeReturnTo(search.get("redirectTo"))} replace />;
	return <LoginForm onSignedIn={() => {}} />;
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
								loginPath="/login"
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
