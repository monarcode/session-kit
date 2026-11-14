import { Outlet } from "react-router";

import { signedIn } from "../auth/session.server";

export const middleware = [signedIn];

// So navigation in the browser runs the middleware, whatever the routes
// nested here load.
export const loader = () => null;

export default function Protected() {
	return <Outlet />;
}
