import { useRouteError } from "react-router";

import {
	requireSession,
	SessionOutlet,
} from "@monarcode/session-kit/react-router";

import { auth } from "../auth";
import { Pending, Unavailable } from "../ui";

export function clientLoader({ request }: { request: Request }) {
	return requireSession(auth, { request, loginPath: "/login" });
}

export default function Protected() {
	return <SessionOutlet loginPath="/login" pending={<Pending />} />;
}

export function ErrorBoundary() {
	return <Unavailable error={useRouteError()} />;
}
