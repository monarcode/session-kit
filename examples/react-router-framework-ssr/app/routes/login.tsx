import {
	data,
	redirect,
	useActionData,
	useNavigation,
	type ActionFunctionArgs,
} from "react-router";

import { safeReturnTo } from "@monarcode/session-kit";
import { redirectIfSignedIn } from "@monarcode/session-kit/react-router/server";

import { login } from "../auth/backend";
import { auth, serverAuth } from "../auth/session.server";
import { LoginForm } from "../ui";

/** Signed in already: the server sends the user on to `redirectTo`. */
export const loader = redirectIfSignedIn(serverAuth);

/**
 * Signs in with DummyJSON on the server and sets the cookie. React Router
 * checks that the form came from this site. A failure is returned for the
 * form to show, with status 400, so React Router skips running the loaders
 * again.
 */
export async function action({ request, context, url }: ActionFunctionArgs) {
	const form = await request.formData();
	try {
		await auth(context).signIn(
			await login(
				String(form.get("username")),
				String(form.get("password")),
			),
		);
	} catch (error) {
		return data(
			{
				error: error instanceof Error ? error.message : "Could not sign in",
			},
			{ status: 400 },
		);
	}
	throw redirect(safeReturnTo(url.searchParams.get("redirectTo")));
}

export default function Login() {
	const result = useActionData<typeof action>();
	const navigation = useNavigation();
	return (
		<LoginForm
			error={result?.error ?? ""}
			pending={navigation.state !== "idle"}
		/>
	);
}
