import { createGetUrl } from "fumadocs-core/source";

export const docsRoute = "/docs";

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
