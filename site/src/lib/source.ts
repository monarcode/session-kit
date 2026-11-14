import { rehypeCodeDefaultOptions } from "fumadocs-core/mdx-plugins";
import {
	flattenTree,
	getPageTreeRoots,
	type Folder,
	type Item,
} from "fumadocs-core/page-tree";
import { llms, loader } from "fumadocs-core/source";
import { lucideIconsPlugin } from "fumadocs-core/source/lucide-icons";
import { applyMdxPreset } from "fumadocs-mdx/config";
import { defineDocs } from "fumadocs-mdx/macro";
import { transformerTwoslash } from "fumadocs-twoslash";
import { createGenerator, remarkAutoTypeTable } from "fumadocs-typescript";

import { onTwoslashError, rehypePageApps, twoslashOptions } from "./page-apps";
import {
	codeThemes,
	docsRoute,
	getPageMarkdownUrl,
	LATEST,
	latestLabel,
	SITE_URL,
	versionOfPath,
} from "./shared";

const SHELLS = new Set(["sh", "bash", "shell", "zsh"]);
// Tags a hover leaves out: the page around it is the example.
const PAGE_TAGS = new Set(["example", "since"]);

export const docs = defineDocs({
	dir: "content/docs",
	docs: {
		async: true,
		postprocess: { includeProcessedMarkdown: true },
		mdxOptions: applyMdxPreset({
			rehypeCodeOptions: {
				...rehypeCodeDefaultOptions,
				...codeThemes,
				transformers: [
					...(rehypeCodeDefaultOptions.transformers ?? []),
					// Type hovers on blocks marked `twoslash`, which every titled
					// example is (see `rehypePageApps`). A type error in an example
					// fails the build. No cache: it's keyed by the block, so it
					// would hide a change to the types.
					transformerTwoslash({ twoslashOptions, onTwoslashError }),
					// A hover shows a name's type and its docs' first paragraph,
					// which session-kit's docs keep standalone, with the tags that
					// say how to use it, such as `@default` and `@see`. The rest of
					// the docs, the export's own example and its version stay out:
					// the page is the example, and every hover ships in the page.
					// Runs before Twoslash renders its popups.
					{
						name: "hover-docs",
						tokens() {
							for (const node of this.meta.twoslash?.nodes ?? []) {
								if (node.type !== "hover") continue;
								if (node.docs)
									node.docs = node.docs.split(/\n\s*\n/)[0];
								if (node.tags)
									node.tags = node.tags.filter(
										([name]) => !PAGE_TAGS.has(name),
									);
							}
						},
					},
					// Marks each line of a shell block that starts a command, so
					// the docs' styles can give it a `$` prompt. Comments, blank
					// lines and continuations after a `\` get none.
					{
						name: "shell-prompt",
						line(node, line) {
							if (!SHELLS.has(this.options.lang)) return;
							const lines = this.source.split("\n");
							const text = lines[line - 1]?.trim() ?? "";
							const previous = lines[line - 2]?.trimEnd() ?? "";
							if (
								text &&
								!text.startsWith("#") &&
								!previous.endsWith("\\")
							)
								node.properties["data-command"] = "";
						},
					},
				],
			},
			// Before `rehypeCode`, which highlights what it leaves.
			rehypePlugins: (plugins) => [rehypePageApps, ...plugins],
			remarkPlugins: [
				[
					remarkAutoTypeTable,
					{
						// No cache: it's keyed by the page, not the types, so it
						// would keep showing an API that changed.
						generator: createGenerator({ tsconfigPath: "tsconfig.json" }),
					},
				],
			],
		}),
	},
});

export const source = loader({
	source: docs.toFumadocsSource(),
	baseUrl: docsRoute,
	plugins: [
		lucideIconsPlugin(),
		{
			// The current line is named by the package's version, so the label
			// moves from "prerelease" to stable when the release ships.
			transformPageTree: {
				folder: (node, folderPath) =>
					node.root && versionOfPath(folderPath) === LATEST
						? { ...node, name: latestLabel() }
						: node,
			},
		},
	],
});

// Full URLs throughout: these files are read away from the site.
export const docsLlms = llms(source, {
	renderUrl: (node: Item) => {
		const page = source.getNodePage(node);
		return SITE_URL + (page ? getPageMarkdownUrl(page).url : node.url);
	},
	renderPage: async (page) =>
		`# ${page.data.title} (${SITE_URL}${page.url})\n\n${plainMarkdown(await page.data.getText("processed"))}`,
});

/**
 * Rewrites what the processed Markdown keeps of the MDX: headings lose their
 * anchor IDs, a page's cards become a list, and links to the site's pages
 * get its URL.
 */
function plainMarkdown(text: string) {
	return text
		.replace(/^(#+ .*) \[#[\w-]+\]$/gm, "$1")
		.replace(/^<\/?Cards>\n?/gm, "")
		.replace(/<Card\s([\s\S]*?)\/>/g, (_, attributes: string) => {
			const value = (name: string) =>
				new RegExp(`${name}="([^"]*)"`).exec(attributes)?.[1] ?? "";
			const description = value("description");
			return `- [${value("title")}](${SITE_URL}${value("href")})${description ? `: ${description}` : ""}`;
		})
		.replace(/\]\(\/(?!\/)/g, `](${SITE_URL}/`);
}

/**
 * The current release line's root folder in the sidebar. `llms.txt` lists
 * only its pages, so readers and LLMs don't get an older line's API beside
 * the current one.
 */
export function currentFolder(): Folder {
	const folder = getPageTreeRoots(source.getPageTree()).find(
		(root): root is Folder => {
			if (root.type !== "folder") return false;
			const first = flattenTree([root])[0];
			const page = first && source.getNodePage(first);
			return versionOfPath(page?.path ?? "") === LATEST;
		},
	);
	if (!folder) throw new Error("The docs have no current release line");
	return folder;
}

/** The current release line's pages, in the sidebar's order. */
export function currentPages() {
	return flattenTree([currentFolder()]).flatMap(
		(node) => source.getNodePage(node) ?? [],
	);
}
