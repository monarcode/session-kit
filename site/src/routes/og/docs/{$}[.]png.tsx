import { createFileRoute, notFound } from "@tanstack/react-router";

import { decodeImagePath } from "@/lib/og";
import { DocsImage, imageResponse } from "@/lib/og-image";
import { LATEST, versionOfPath } from "@/lib/shared";
import { pageSection, source } from "@/lib/source";

// Each docs page's link preview. `vite.config.ts` lists every one for the
// prerender, since pages name them only in a meta tag, which the crawler
// doesn't follow.
export const Route = createFileRoute("/og/docs/{$}.png")({
	server: {
		handlers: {
			GET: ({ params, request }) => {
				const page = source.getPage(decodeImagePath(params._splat));
				if (!page) throw notFound();

				// Where the page sits: an older line's version, and its place in
				// the sidebar.
				const title = page.data.title ?? "";
				const version = versionOfPath(page.path);
				const section = [
					"Docs",
					...(version === LATEST ? [] : [version]),
					...pageSection({ url: page.url, title }),
				].join(" / ");

				return imageResponse(
					<DocsImage
						section={section}
						title={title}
						description={page.data.description ?? ""}
						path={page.url}
					/>,
					request,
				);
			},
		},
	},
});
