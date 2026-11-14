import { useNavigate, useSearchParams } from "react-router";

import { safeReturnTo } from "@monarcode/session-kit";
import { redirectIfSignedIn } from "@monarcode/session-kit/react-router";

import { auth } from "../auth";
import { LoginForm } from "../ui";

export const clientLoader = redirectIfSignedIn(auth);

export default function Login() {
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
