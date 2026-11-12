import { createFileRoute } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";

import { Features } from "@/components/landing/features";
import { Footer } from "@/components/landing/footer";
import { Hero } from "@/components/landing/hero";
import { Setups } from "@/components/landing/setups";
import { Tour } from "@/components/landing/tour";
import { baseOptions } from "@/lib/layout.shared";
import { loadTour } from "@/lib/tour";

import { version } from "../../../package.json";

export const Route = createFileRoute("/")({
	loader: () => loadTour(),
	head: () => ({
		meta: [
			{
				name: "description",
				content:
					"Your backend signs users in. session-kit handles everything after: it saves and restores the session, refreshes tokens, keeps tabs in step and guards your routes.",
			},
		],
	}),
	component: Home,
});

function Home() {
	const steps = Route.useLoaderData();
	return (
		<HomeLayout
			{...baseOptions()}
			// Only here: in the docs, the sidebar already lists these pages.
			links={[
				{ text: "Docs", url: "/docs" },
				{ text: "Reference", url: "/docs/reference" },
			]}
		>
			<main className="flex flex-1 flex-col">
				<Hero version={version} />
				<Tour steps={steps} />
				<Setups />
				<Features />
			</main>
			<Footer />
		</HomeLayout>
	);
}
