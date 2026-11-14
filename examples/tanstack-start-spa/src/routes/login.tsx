import { safeReturnTo } from "@monarcode/session-kit";
import { redirectIfSignedIn } from "@monarcode/session-kit/tanstack-router";
import { createFileRoute } from "@tanstack/react-router";

import { LoginForm } from "../ui";

export const Route = createFileRoute("/login")({
	validateSearch: (search: Record<string, unknown>) => ({
		redirectTo: safeReturnTo(search.redirectTo),
	}),
	// Runs again after a sign-in, as connectAuth runs the guards again.
	beforeLoad: ({ context, search }) =>
		redirectIfSignedIn(context.auth, { redirectTo: search.redirectTo }),
	component: LoginForm,
});
