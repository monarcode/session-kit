import { createFileRoute } from "@tanstack/react-router";

import { Profile } from "../../ui";

export const Route = createFileRoute("/_authenticated/")({
	component: Profile,
});
