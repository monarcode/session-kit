import {
	redirect,
	useActionData,
	useNavigation,
	type ActionFunctionArgs,
	type LoaderFunctionArgs,
} from "react-router";

import { safeReturnTo } from "@monarcode/session-kit";

import { login } from "../auth/backend";
import { auth } from "../auth/session.server";
import { LoginForm } from "../ui";

/** Signed in, before or after the form: the server sends the user on. */
export async function loader({ context, url }: LoaderFunctionArgs) {
	if (await auth(context).getSession())
		throw redirect(safeReturnTo(url.searchParams.get("redirectTo")));
	return null;
}

/**
 * Signs in with DummyJSON on the server and sets the cookie. React Router
 * checks that the form came from this site. A failure is returned for the
 * form to show.
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
		return {
			error: error instanceof Error ? error.message : "Could not sign in",
		};
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
