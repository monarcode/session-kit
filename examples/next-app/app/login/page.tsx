import { session } from "../../lib/auth/session";
import { LoginForm } from "../ui";

export default async function Login({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	// Signed in, before or after the form: the server sends the user on.
	await session.redirectIfSignedIn((await searchParams).redirectTo);
	return <LoginForm />;
}
