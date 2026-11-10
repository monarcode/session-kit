import { safeReturnTo } from "@monarcode/session-kit";
import { redirect } from "next/navigation";

import { getSession } from "../../lib/auth/session";
import { LoginForm } from "../ui";

export default async function Login({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	// Signed in, before or after the form: the server sends the user on.
	if (await getSession())
		redirect(safeReturnTo((await searchParams).redirectTo));
	return <LoginForm />;
}
