import {
	requireSession,
	SessionOutlet,
} from "@monarcode/session-kit/tanstack-router";
import { createFileRoute } from "@tanstack/react-router";

import { Pending, Unavailable } from "../ui";

export const Route = createFileRoute("/_authenticated")({
	beforeLoad: ({ context, location }) =>
		requireSession(context.auth, { location, loginPath: "/login" }),
	errorComponent: ({ error }) => <Unavailable error={error} />,
	component: () => <SessionOutlet pending={<Pending />} />,
});
