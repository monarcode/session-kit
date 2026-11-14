import { useNavigate, useSearchParams } from "react-router";

import { safeReturnTo } from "@monarcode/session-kit";
import { redirectIfSignedInLoader } from "@monarcode/session-kit/react-router";

import { auth } from "../auth";
import { LoginForm } from "../ui";

export const clientLoader = redirectIfSignedInLoader(auth);

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
