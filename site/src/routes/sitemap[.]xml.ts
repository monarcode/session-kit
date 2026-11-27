import { createFileRoute } from "@tanstack/react-router";

import { pageUrl } from "@/lib/shared";
import { currentPages } from "@/lib/source";

const ENTITIES: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&apos;",
};

/** A URL as XML text: a page's file name could hold an `&`. */
function escapeXml(text: string): string {
	return text.replace(/[&<>"']/g, (char) => ENTITIES[char]!);
}

// The home page and the current release line's pages, at the URLs the host
// serves them on. Older lines are marked noindex, so they're left out.
export const Route = createFileRoute("/sitemap.xml")({
	server: {
		handlers: {
			GET: () => {
				const paths = ["/", ...currentPages().map((page) => page.url)];
				return new Response(
					[
						'<?xml version="1.0" encoding="UTF-8"?>',
						'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
						...paths.map(
							(path) =>
								`  <url><loc>${escapeXml(pageUrl(path))}</loc></url>`,
						),
						"</urlset>",
						"",
					].join("\n"),
					{
						headers: { "Content-Type": "application/xml; charset=utf-8" },
					},
				);
			},
		},
	},
});
