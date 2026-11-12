import { glob } from "node:fs/promises";

import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { getSlugs } from "fumadocs-core/source";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import { defineConfig } from "vite";

// Every docs page, including older versions, which only the version dropdown
// links to, so the crawler wouldn't find them.
const docsPages: { path: string }[] = [];
for await (const entry of glob("**/*.mdx", { cwd: "content/docs" }))
	docsPages.push({ path: ["/docs", ...getSlugs(entry)].join("/") });

export default defineConfig({
	plugins: [
		fumadocsMdx(),
		tailwindcss(),
		tanstackStart({
			// Static files only: every page is prerendered to HTML at build time.
			prerender: { enabled: true, crawlLinks: true },
			// Routes no page links to, so the crawler doesn't find them.
			pages: [
				...docsPages,
				{ path: "/api/search" },
				{ path: "/llms.txt" },
				{ path: "/llms-full.txt" },
			],
		}),
		react(),
	],
	resolve: {
		tsconfigPaths: true,
		// session-kit is a workspace link: keep one copy of React and the router.
		dedupe: ["react", "react-dom", "@tanstack/react-router"],
	},
});
