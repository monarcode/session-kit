import { createFileRoute } from "@tanstack/react-router";

import { currentPages } from "@/lib/source";

export const Route = createFileRoute("/llms.txt")({
	server: {
		handlers: {
			GET: () =>
				new Response(
					[
						"# Session kit",
						"",
						"> Schema-driven auth state and sessions for React.",
						"",
						...currentPages().map(
							(page) =>
								`- [${page.data.title}](${page.url}.md)${page.data.description ? `: ${page.data.description}` : ""}`,
						),
					].join("\n"),
				),
		},
	},
});
