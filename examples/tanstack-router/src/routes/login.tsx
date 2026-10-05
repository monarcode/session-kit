import { safeReturnTo } from "@monarcode/session-kit";
import { redirectIfSignedIn } from "@monarcode/session-kit/tanstack-router";
import { createFileRoute, useRouter } from "@tanstack/react-router";

import { LoginForm } from "../ui";

export const Route = createFileRoute("/login")({
	validateSearch: (search: Record<string, unknown>) => ({
		redirectTo: safeReturnTo(search.redirectTo),
	}),
	beforeLoad: ({ context, search }) =>
		redirectIfSignedIn(context.auth, { redirectTo: search.redirectTo }),
	component: Login,
});

function Login() {
	const router = useRouter();
	const { redirectTo } = Route.useSearch();
	return (
		<LoginForm
			onSignedIn={() => router.navigate({ href: redirectTo, replace: true })}
		/>
	);
}
