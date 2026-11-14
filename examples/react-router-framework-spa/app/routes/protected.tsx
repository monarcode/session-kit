import { useRouteError } from "react-router";

import {
	requireSessionLoader,
	SessionOutlet,
} from "@monarcode/session-kit/react-router";

import { auth } from "../auth";
import { Pending, Unavailable } from "../ui";

export const clientLoader = requireSessionLoader(auth);

export default function Protected() {
	return <SessionOutlet pending={<Pending />} />;
}

export function ErrorBoundary() {
	return <Unavailable error={useRouteError()} />;
}
