import { rehypeCodeDefaultOptions } from "fumadocs-core/mdx-plugins";
import { llms, loader } from "fumadocs-core/source";
import { lucideIconsPlugin } from "fumadocs-core/source/lucide-icons";
import { applyMdxPreset } from "fumadocs-mdx/config";
import { defineDocs } from "fumadocs-mdx/macro";
import { transformerTwoslash } from "fumadocs-twoslash";
import { createGenerator, remarkAutoTypeTable } from "fumadocs-typescript";

import { codeThemes, docsRoute, LATEST, versionOfPath } from "./shared";

const SHELLS = new Set(["sh", "bash", "shell", "zsh"]);

export const docs = defineDocs({
	dir: "content/docs",
	docs: {
		async: true,
		postprocess: { includeProcessedMarkdown: true },
		mdxOptions: applyMdxPreset({
			rehypeCodeOptions: {
				...rehypeCodeDefaultOptions,
				...codeThemes,
				// Type hovers on blocks marked `twoslash`. They need no imports
				// from other files: each block compiles on its own. No cache: it's
				// keyed by the block, so it would hide a change to the types.
				transformers: [
					...(rehypeCodeDefaultOptions.transformers ?? []),
					transformerTwoslash(),
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
	plugins: [lucideIconsPlugin()],
});

export const docsLlms = llms(source, {
	renderPage: async (page) =>
		`# ${page.data.title} (${page.url})\n\n${await page.data.getText("processed")}`,
});

/**
 * The current release line's pages. `llms.txt` lists only these, so readers
 * and LLMs don't get an older line's API beside the current one.
 */
export function currentPages() {
	return source
		.getPages()
		.filter((page) => versionOfPath(page.path) === LATEST);
}
