import { relative, sep } from "node:path";

import type { Element, ElementContent, Root, RootContent } from "hast";

import {
	compilerSettings,
	documents,
	installedAtLeast,
	pageApp,
	root,
	TITLE,
} from "../../../scripts/docs-pages.mjs";

/**
 * Twoslash's options. Modules resolve from the repository, where the package
 * and the guides' dependencies are installed, and examples compile with the
 * options `check-docs` uses, under the bundler resolution every page
 * compiles under. Twoslash runs its own TypeScript, so a check of its own:
 * `check-docs` stays the one that names the page and line.
 */
export const twoslashOptions = {
	cwd: root,
	compilerOptions: {
		...compilerSettings("Bundler", true),
		// Twoslash makes every file a module by default, which would turn a
		// fixture's ambient `declare module` into a failed augmentation.
		moduleDetection: "auto",
	},
};

const CUT = "// ---cut---\n";

/**
 * Fails the build on a type error in an example, as `check-docs` would. The
 * dev server logs it and shows the example without hovers instead: a thrown
 * error stops the server while a page is being written.
 */
export function onTwoslashError(error: unknown, code: string) {
	if (process.env.NODE_ENV === "production") throw error;
	console.error(error);
	const start = code.indexOf(CUT);
	return start === -1 ? code : code.slice(start + CUT.length);
}

const NO_DOM_LIB = `// @lib: ${compilerSettings("Bundler", false).lib.join(",")}`;
const TYPESCRIPT = new Set(["language-ts", "language-tsx"]);
// Twoslash's own opt-outs, which would leave the hidden files on show.
const OPT_OUT = /(?:^|\s)no-?twoslash(?:\s|$)/;

/**
 * Marks each titled example on a page that `check-docs` compiles as one app
 * for Twoslash, and hands Twoslash the app's other files as hidden files
 * before it. The example's imports then resolve, and its hovers show the
 * types the page's own code gives them. Runs before `rehypeCode`, on the HTML
 * tree, so the page's Markdown for `llms.txt` stays as written.
 */
export function rehypePageApps() {
	return (tree: Root, file: MdxFile) => {
		const document = documents.find(
			(candidate) => candidate.path === pagePath(file.path),
		);
		if (!document) return;
		// Skipped by `check-docs` too, so there's no app to compile it in.
		const missing = Object.entries(document.requires ?? {}).some(
			([name, minimum]) => !installedAtLeast(name, minimum),
		);
		if (missing) return;
		// `check-docs` reports a page's problems; the site only reads it.
		const app = pageApp(document, () => {});
		// The dev server rebuilds the page when a file it borrows from changes.
		for (const origin of new Set(app.map((other) => other.origin)))
			file.data._compiler?.addDependency(origin);
		visitCode(tree, (code) => {
			const meta = String(code.data?.meta ?? "");
			const title = TITLE.exec(meta)?.[1];
			if (!title || OPT_OUT.test(meta)) return;
			if (!app.some((other) => other.path === title)) return;
			const hidden = app
				.filter((other) => other.path !== title)
				.map(
					(other) =>
						`// @filename: ${other.path}\n${other.code}\n` +
						(other.fixture ? "" : "export {};\n"),
				);
			const source = text(code);
			const lines = [
				// Twoslash puts blocks with the same compiler options in one
				// program, where each copy of a page's `declare module` would
				// merge with the others. An export condition of its own, which
				// no package has, gives each block a program of its own.
				`// @customConditions: ${document.path}#${title}`,
				// The hidden files are `check-docs`' to report.
				"// @noErrorsCutted",
				...(document.dom ? [] : [NO_DOM_LIB]),
				...hidden,
				// As `check-docs` compiles it: a module, even without imports.
				`// @filename: ${title}\nexport {};`,
				CUT + source,
			];
			const value = lines.join("\n");
			code.children = [{ type: "text", value }];
			code.data = { ...code.data, meta: `${meta} twoslash` };
		});
	};
}

/**
 * The parts of the page's file the plugin reads. Fumadocs MDX hands its
 * compiler to plugins as `data._compiler`, as its own `remarkInclude` uses it.
 */
interface MdxFile {
	path?: string | undefined;
	data: { _compiler?: { addDependency(file: string): void } | undefined };
}

/** The page's path from the repository's root, as `documents` names it. */
function pagePath(path: string | undefined) {
	return path ? relative(root, path).split(sep).join("/") : undefined;
}

/**
 * Calls `visit` with the `code` of each TypeScript `pre`, including those in
 * MDX components such as `<Tab>`, which aren't `element`s.
 */
function visitCode(node: Root | RootContent, visit: (code: Element) => void) {
	if (!("children" in node)) return;
	for (const child of node.children as RootContent[]) {
		const code = child.type === "element" ? child.children[0] : undefined;
		if (
			child.type === "element" &&
			child.tagName === "pre" &&
			code?.type === "element" &&
			code.tagName === "code" &&
			classes(code).some((name) => TYPESCRIPT.has(name))
		)
			visit(code);
		else visitCode(child, visit);
	}
}

function classes(node: Element) {
	const value = node.properties.className;
	return Array.isArray(value) ? value.map(String) : [];
}

function text(node: ElementContent): string {
	if (node.type === "text") return node.value;
	return "children" in node ? node.children.map(text).join("") : "";
}
