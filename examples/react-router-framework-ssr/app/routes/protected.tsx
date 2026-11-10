import { Outlet } from "react-router";

import { requireSession } from "../auth/middleware.server";

export const middleware = [requireSession];

export default function Protected() {
	return <Outlet />;
}
