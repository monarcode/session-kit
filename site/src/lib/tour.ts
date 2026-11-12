import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { createServerFn } from "@tanstack/react-start";
import { staticFunctionMiddleware } from "@tanstack/start-static-server-functions";
import { highlightHast } from "fumadocs-core/highlight";

/**
 * The landing page's code tour. Each step shows an example from a docs page,
 * read from the page when the site is built, so it's the code `check-docs`
 * compiles and can't drift from the guides.
 */
const TOUR = [
	{
		label: "Create the client",
		page: "getting-started",
		file: "src/auth.ts",
		href: "/docs/getting-started#2-create-the-client",
	},
	{
		label: "Read the session",
		page: "getting-started",
		file: "src/app.tsx",
		href: "/docs/getting-started#4-read-the-session-in-react",
	},
	{
		label: "Guard a route",
		page: "setups/tanstack-router",
		file: "src/routes/_authenticated.tsx",
		href: "/docs/setups/tanstack-router",
	},
] as const;

/** The code of the example titled `file` on a page of the current docs. */
async function readExample(page: string, file: string): Promise<string> {
	const text = await readFile(
		join("content/docs/(latest)", `${page}.mdx`),
		"utf8",
	);
	const fence = new RegExp(
		'^```(tsx?)[^\\n]*\\stitle="' +
			file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
			'"[^\\n]*\\n([\\s\\S]*?)\\n```$',
		"m",
	).exec(text);
	if (!fence) throw new Error(`${page}.mdx has no example titled ${file}`);
	return fence[2]!;
}

export const loadTour = createServerFn({ method: "GET" })
	.middleware([staticFunctionMiddleware])
	.handler(() =>
		Promise.all(
			TOUR.map(async (step) => {
				const code = await readExample(step.page, step.file);
				const lang = step.file.endsWith(".tsx") ? "tsx" : "ts";
				return { ...step, code: await highlightHast(code, { lang }) };
			}),
		),
	);
