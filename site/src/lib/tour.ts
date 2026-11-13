import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { createServerFn } from "@tanstack/react-start";
import { staticFunctionMiddleware } from "@tanstack/start-static-server-functions";
import { highlightHast } from "fumadocs-core/highlight";
import type { Element, ElementContent } from "hast";

import { codeThemes } from "@/lib/shared";

import { MARKERS } from "../../../scripts/docs-pages.mjs";

/**
 * The landing page's code tour: one app, the TanStack Router setup, which
 * builds on Getting started's client. Each step shows an example from a docs
 * page, read from the page when the site is built, so it's the code
 * `check-docs` compiles and can't drift from the guides.
 */
const TOUR = [
	{
		label: "Create the client",
		page: "getting-started",
		file: "src/auth.ts",
		href: "/docs/getting-started#2-create-the-client",
		guide: "Getting started",
	},
	{
		label: "Guard private routes",
		page: "setups/tanstack-router",
		file: "src/routes/_authenticated.tsx",
		href: "/docs/setups/tanstack-router#3-guard-private-routes",
		guide: "the TanStack Router guide",
	},
	{
		label: "Read the session in a guarded page",
		page: "setups/tanstack-router",
		file: "src/routes/_authenticated/index.tsx",
		href: "/docs/setups/tanstack-router#3-guard-private-routes",
		guide: "the TanStack Router guide",
	},
] as const;

/**
 * The code of the example titled `file` on a page of the current docs, found
 * as `check-docs` finds it. Read from the site's folder: this runs bundled,
 * where `docs-pages.mjs` can't locate the repository.
 */
async function readExample(page: string, file: string): Promise<string> {
	const text = await readFile(
		join("content/docs/(latest)", `${page}.mdx`),
		"utf8",
	);
	const example = [...text.matchAll(MARKERS.mdx)].find(
		(match) => match[1] === file,
	);
	if (!example) throw new Error(`${page}.mdx has no example titled ${file}`);
	return example[2]!;
}

/**
 * The hero's excerpt of Getting started's `src/auth.ts`: the `createAuth`
 * call alone, without its comments, so the config and the hour it plays fit
 * in one view. The tour under the hero shows the whole file.
 */
function configExcerpt(code: string): string {
	const lines = code.split("\n");
	const start = lines.findIndex((line) => line.includes("= createAuth({"));
	const end = lines.findIndex((line, i) => i > start && line === "});");
	if (start < 0 || end < 0) {
		throw new Error("src/auth.ts no longer has the createAuth call");
	}
	return lines
		.slice(start, end + 1)
		.filter((line) => !line.trimStart().startsWith("//"))
		.join("\n");
}

/** The line elements of a highlighted block, without the newlines between. */
function lineElements(root: Awaited<ReturnType<typeof highlightHast>>) {
	const pre = root.children.find(
		(node): node is Element => node.type === "element",
	);
	const code = pre?.children.find(
		(node): node is Element => node.type === "element",
	);
	return (code?.children ?? []).filter(
		(node): node is Element => node.type === "element",
	);
}

function textOf(node: ElementContent): string {
	if (node.type === "text") return node.value;
	if (node.type === "element") return node.children.map(textOf).join("");
	return "";
}

export type ConfigLine = { text: string; code: Element };

export const loadLanding = createServerFn({ method: "GET" })
	.middleware([staticFunctionMiddleware])
	.handler(async () => {
		const steps = await Promise.all(
			TOUR.map(async (step) => {
				const code = await readExample(step.page, step.file);
				const lang = step.file.endsWith(".tsx") ? "tsx" : "ts";
				const hast = await highlightHast(code, { lang, ...codeThemes });
				return { ...step, code: hast };
			}),
		);
		const auth = await readExample("getting-started", "src/auth.ts");
		const highlighted = await highlightHast(configExcerpt(auth), {
			lang: "ts",
			...codeThemes,
		});
		const config: ConfigLine[] = lineElements(highlighted).map((code) => ({
			text: textOf(code),
			code,
		}));
		if (
			!config.some((line) => line.text.trimStart().startsWith("refresh:"))
		) {
			throw new Error("The config excerpt has no refresh line");
		}
		return { steps, config };
	});
