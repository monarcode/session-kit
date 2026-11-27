import { createGetUrl } from "fumadocs-core/source";

import { charbox } from "./charbox";
import { OG_SIZE } from "./og";
import { PRODUCTION_URL } from "./site";

export const docsRoute = "/docs";

/**
 * The code theme of docs pages and the landing page: Charbox, the maintainer's
 * Zed theme. Its comments keep about 6:1 on the site's ink. The site is dark
 * only, so it's one theme: each token gets an inline colour, a third of the
 * size of a light and a dark variable, which adds up across type hovers.
 */
export const codeThemes = {
	themes: { dark: charbox },
	defaultColor: "dark",
} as const;

/**
 * What Session kit is, in a few words: the home page's title after the
 * name, and the foot of every link-preview image.
 */
export const TAGLINE = "Type-safe sessions for React";

/** Set by `vite.config.ts` (see `lib/site.ts`). */
declare const __SITE_URL__: string | undefined;

/**
 * Where this build is served: the live site, or a preview's own address.
 * Link previews, canonical URLs, the sitemap and `llms.txt` need full URLs.
 * The MDX compiler loads this file outside Vite, without the build's
 * value, so `typeof` checks for it before it's read.
 */
export const SITE_URL =
	typeof __SITE_URL__ === "string" ? __SITE_URL__ : PRODUCTION_URL;

/**
 * A page's full URL, as the host serves it: `/docs/installation`, the URL
 * every link uses. The same URL with a trailing slash redirects there (see
 * `vite.config.ts`).
 */
export function pageUrl(path: string): string {
	return SITE_URL + path;
}

/**
 * The tags that give a link its preview image, from a path such as
 * `/og/home.png` (see `lib/og.ts`) and the text that describes it.
 */
export function imageMeta(path: string, alt: string) {
	return [
		{ property: "og:image", content: SITE_URL + path },
		{ property: "og:image:width", content: String(OG_SIZE.width) },
		{ property: "og:image:height", content: String(OG_SIZE.height) },
		{ property: "og:image:alt", content: alt },
		{ name: "twitter:card", content: "summary_large_image" },
	];
}

/** The site as a structured-data node, which every page's data is part of. */
export function websiteNode() {
	return {
		"@type": "WebSite",
		"@id": `${SITE_URL}/#website`,
		name: "Session kit",
		url: `${SITE_URL}/`,
	};
}

/** The home page's structured data: the site itself. */
export function websiteJsonLd() {
	return { "@context": "https://schema.org", ...websiteNode() };
}

/** What {@link pageHead} needs to describe a page. */
export interface PageHeadInput {
	title: string;
	description: string;
	/** The page's path, such as `/docs/installation`. */
	path: string;
	/** `article` for a docs page, `website` for the home page. */
	type: "website" | "article";
	/** The path of the page as Markdown, for LLMs and agents. */
	markdown?: string | undefined;
	/** The path of its link-preview image (see `lib/og.ts`). */
	image?: string | undefined;
	/** Its structured data, for search engines. */
	jsonLd?: readonly object[] | undefined;
}

/**
 * A page's head: its title, description and structured data, for the
 * browser, search engines and link previews, with the canonical URL each of
 * them should use. Full URLs throughout, since these are read away from
 * the site, and `session-kit.pages.dev` serves the same pages.
 */
export function pageHead(page: PageHeadInput) {
	const url = pageUrl(page.path);
	return {
		meta: [
			{ title: page.title },
			{ name: "description", content: page.description },
			{ property: "og:title", content: page.title },
			{ property: "og:description", content: page.description },
			{ property: "og:url", content: url },
			{ property: "og:type", content: page.type },
			...(page.image ? imageMeta(page.image, page.title) : []),
		],
		// Written into the page as is, so `<` is escaped: a string can't end
		// the script.
		scripts: (page.jsonLd ?? []).map((data) => ({
			type: "application/ld+json",
			children: JSON.stringify(data).replace(/</g, "\\u003c"),
		})),
		links: [
			{ rel: "canonical", href: url },
			...(page.markdown
				? [
						{
							rel: "alternate",
							type: "text/markdown",
							href: SITE_URL + page.markdown,
						},
					]
				: []),
		],
	};
}

/** The route prerendered to `404.html`, and the meta tag that marks it. */
export const NOT_FOUND_PATH = "/404";
export const NOT_FOUND_MARK = "session-kit-not-found";

export const gitConfig = {
	user: "monarcode",
	repo: "session-kit",
	branch: "main",
};

const getDocsUrl = createGetUrl(docsRoute);

/** The URL of a page's Markdown, for LLMs and the copy button. */
export function getPageMarkdownUrl(page: { slugs: string[] }) {
	const segments = [...page.slugs];
	if (segments.length === 0) segments.push("index.md");
	else segments[segments.length - 1] += ".md";
	return { segments, url: getDocsUrl(segments) };
}

/** The page slugs of a Markdown URL from {@link getPageMarkdownUrl}. */
export function decodeMarkdownUrl(segments: string[]) {
	if (segments.length === 0) return [];
	const out = [...segments];
	out[out.length - 1] = out[out.length - 1]!.replace(/\.md$/, "");
	if (out.length === 1 && out[0] === "index") out.pop();
	return out;
}

/** The search tag and version of the current release line's pages. */
export const LATEST = "latest";

/**
 * The version dropdown's label for a release: `0.1.0` once it's stable, and
 * `0.1.0 prerelease` for an alpha, beta or release candidate of it.
 */
export function versionLabel(release: string): string {
	const [stable, prerelease] = release.split("-", 2);
	return prerelease ? `${stable} prerelease` : stable!;
}

/** Set by `vite.config.ts` from `package.json`. */
declare const __PACKAGE_VERSION__: string;

/**
 * The current line's label, from the package's version as the site builds.
 * A function: the MDX compiler loads `source.ts` outside Vite, which defines
 * the version.
 */
export function latestLabel(): string {
	return versionLabel(__PACKAGE_VERSION__);
}

/**
 * The release line a page belongs to: its version folder (`0.1`), or
 * {@link LATEST} for the current line in `(latest)`.
 */
export function versionOfPath(path: string): string {
	const folder = path.split("/")[0]!;
	return folder.startsWith("(") ? LATEST : folder;
}

/** The release line a docs URL shows, such as `/docs/0.1/…`. */
export function versionOfUrl(pathname: string): string {
	const segment = /^\/docs\/([^/]+)/.exec(pathname)?.[1];
	return segment && /^\d+\.\d+$/.test(segment) ? segment : LATEST;
}
