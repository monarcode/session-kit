import { redirectIfSignedInLoader } from "@monarcode/session-kit/react-router";

import { auth } from "../auth";
import { LoginForm } from "../ui";

// Runs again after a sign-in, as useAuthRevalidation runs the loaders again.
export const clientLoader = redirectIfSignedInLoader(auth);

export default LoginForm;
