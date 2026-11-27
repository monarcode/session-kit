import { readFileSync } from "node:fs";
import { glob, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { getSlugs } from "fumadocs-core/source";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import { defineConfig } from "vite";

import {
	HOME_IMAGE_PATH,
	IMAGE_AS_BASE64,
	pageImagePath,
	TOUCH_ICON_PATH,
} from "./src/lib/og.ts";
import { siteUrl } from "./src/lib/site.ts";

const PNG_SIGNATURE = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

// The link-preview images and the home-screen icon. The prerender writes
// each response as text, which would corrupt a PNG, so it asks for the
// image as base64 and this writes the bytes over the text it saved.
const imagePrerender = {
	headers: { [IMAGE_AS_BASE64]: "true" },
	onSuccess: async ({
		page,
		html,
	}: {
		page: { path: string };
		html: string;
	}) => {
		const file = join(import.meta.dirname, "dist/client", page.path);
		// The text must be where the prerender saved it, or the site would
		// ship base64 as the image.
		const saved = await readFile(file, "utf8").catch(() => undefined);
		if (saved !== html)
			throw new Error(
				`The prerender didn't save ${page.path} in dist/client, so its image can't be written`,
			);
		const image = Buffer.from(html, "base64");
		// A route that answered with bytes rather than base64 decodes to
		// noise without an error, so check it's a PNG.
		if (!image.subarray(0, 8).equals(PNG_SIGNATURE))
			throw new Error(
				`${page.path} didn't come back as a base64 PNG, so its image can't be written`,
			);
		await writeFile(file, image);
	},
};

// Every docs page, including older versions, which only the version dropdown
// links to, so the crawler wouldn't find them. Each page's image too, which
// only a meta tag names, and the crawler doesn't follow it.
const docsPages: { path: string; prerender?: typeof imagePrerender }[] = [];
for await (const entry of glob("**/*.mdx", {
	cwd: join(import.meta.dirname, "content/docs"),
})) {
	const slugs = getSlugs(entry);
	docsPages.push({ path: ["/docs", ...slugs].join("/") });
	docsPages.push({ path: pageImagePath(slugs), prerender: imagePrerender });
}
if (docsPages.length === 0)
	throw new Error("No docs pages in content/docs to prerender");

// The package's version, which names the current docs in the version dropdown.
const { version } = JSON.parse(
	readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

export default defineConfig({
	define: {
		__PACKAGE_VERSION__: JSON.stringify(version),
		__SITE_URL__: JSON.stringify(siteUrl(process.env)),
	},
	plugins: [
		fumadocsMdx(),
		tailwindcss(),
		tanstackStart({
			// Static files only: every page is prerendered to HTML at build time,
			// as `docs/installation.html` rather than `docs/installation/index.html`.
			// Cloudflare Pages serves the file at `/docs/installation`, the URL
			// every link uses; a folder's `index.html` would redirect it to a URL
			// with a trailing slash.
			prerender: {
				enabled: true,
				crawlLinks: true,
				autoSubfolderIndex: false,
				// A link to a heading on another page is that page again.
				filter: ({ path }) => !path.includes("#"),
			},
			// Routes no page links to, so the crawler doesn't find them.
			pages: [
				...docsPages,
				{ path: "/api/search" },
				{ path: "/llms.txt" },
				{ path: "/llms-full.txt" },
				{ path: "/robots.txt" },
				{ path: "/sitemap.xml" },
				// Written to `404.html` at the output's root.
				{ path: "/404" },
				{ path: HOME_IMAGE_PATH, prerender: imagePrerender },
				{ path: TOUCH_ICON_PATH, prerender: imagePrerender },
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
