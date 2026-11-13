import type { CSSProperties } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";

import { Closing } from "@/components/landing/closing";
import { Features } from "@/components/landing/features";
import { Footer } from "@/components/landing/footer";
import { Hero } from "@/components/landing/hero";
import { ScopeNote } from "@/components/landing/scope-note";
import { Setups } from "@/components/landing/setups";
import { Tour } from "@/components/landing/tour";
import { baseOptions } from "@/lib/layout.shared";
import { loadLanding } from "@/lib/tour";

import { version } from "../../../package.json";

export const Route = createFileRoute("/")({
	loader: () => loadLanding(),
	head: () => ({
		meta: [
			{
				name: "description",
				content:
					"Your backend signs users in. Session kit handles everything after: it saves and restores the session, refreshes tokens, keeps tabs in step and guards your routes.",
			},
		],
	}),
	component: Home,
});

function Home() {
	const { steps, config } = Route.useLoaderData();
	return (
		<HomeLayout
			{...baseOptions()}
			// The landing page is a code buffer: one monospaced face throughout.
			className="live-source"
			style={{ "--fd-layout-width": "72rem" } as CSSProperties}
			// Only here: in the docs, the sidebar already lists these pages.
			links={[
				{ text: "Docs", url: "/docs" },
				{ text: "Reference", url: "/docs/reference" },
			]}
		>
			{/* HomeLayout is the page's <main>. */}
			<div className="flex flex-1 flex-col">
				<Hero version={version} config={config} />
				<Tour steps={steps} />
				<ScopeNote />
				<Setups />
				<Features />
				<Closing />
			</div>
			<Footer />
		</HomeLayout>
	);
}
