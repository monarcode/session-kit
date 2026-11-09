import { createFileRoute } from "@tanstack/react-router";

import { getProfileFn } from "../../auth/functions";
import { Profile } from "../../ui";

export const Route = createFileRoute("/_authenticated/")({
	// Runs on the server for the first page, calling DummyJSON with the
	// cookie's token; in the browser, it calls the server function.
	loader: () => getProfileFn(),
	component: function Home() {
		return <Profile fromServer={Route.useLoaderData().email} />;
	},
});
