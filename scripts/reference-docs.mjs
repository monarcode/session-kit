// Writes the site's API reference from the JSDoc: a page per entry point,
// listing each export with its summary, and the error codes page.
//
//   pnpm run docs:reference
//
// `check-docs` renders the same pages and fails when the files differ, so
// the reference can't fall behind the code. Don't edit the pages by hand.

import { readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const OUT = "site/content/docs/(latest)/reference";

/** Each entry point's page: its file, title, description and guide. */
const PAGES = {
	".": [
		"core",
		"Core",
		"The client and storage: create one auth client per app.",
		["Getting started", "/docs/getting-started"],
	],
	"./react": [
		"react",
		"React",
		"React hooks and the provider that read a client's state.",
		[
			"Read the session in React",
			"/docs/getting-started#4-read-the-session-in-react",
		],
	],
	"./tanstack-router": [
		"tanstack-router",
		"TanStack Router",
		"Route guards and router wiring for TanStack Router.",
		["TanStack Router", "/docs/setups/tanstack-router"],
	],
	"./react-router": [
		"react-router",
		"React Router",
		"Route guards and revalidation for React Router.",
		["React Router", "/docs/setups/react-router"],
	],
	"./react-router/server": [
		"react-router-server",
		"React Router server",
		"Server sessions in React Router's framework mode.",
		["React Router with server rendering", "/docs/setups/react-router-ssr"],
	],
	"./http": [
		"http",
		"HTTP",
		"A fetch that sends the access token and refreshes on a 401.",
		["Authenticated requests", "/docs/client/requests"],
	],
	"./server": [
		"server",
		"Server",
		"Sessions kept on the server, in an encrypted cookie.",
		["Server sessions", "/docs/server-rendering/server-sessions"],
	],
	"./tanstack-start": [
		"tanstack-start",
		"TanStack Start",
		"Server sessions and hydration for TanStack Start.",
		["TanStack Start", "/docs/setups/tanstack-start"],
	],
	"./tanstack-start/server": [
		"tanstack-start-server",
		"TanStack Start server",
		"TanStack Start's server-side cookie access.",
		["TanStack Start", "/docs/setups/tanstack-start"],
	],
	"./next": [
		"next",
		"Next.js",
		"Server sessions for the Next.js App Router.",
		["Next.js", "/docs/setups/next"],
	],
	"./expo": [
		"expo",
		"Expo",
		"Secure storage, the session gate and deep links for Expo Router.",
		["Expo Router", "/docs/setups/expo"],
	],
	"./effect": [
		"effect",
		"Effect",
		"The session as an Effect service.",
		["Effect and effetch", "/docs/effect"],
	],
	"./effetch": [
		"effetch",
		"effetch",
		"An effetch plugin that sends the access token.",
		["Effect and effetch", "/docs/effect"],
	],
};

const GROUPS = ["Functions", "Components", "Classes", "Values", "Types"];

/**
 * The reference pages, by path from the repository root. `program` covers
 * each entry point's source file; one is created when it's left out.
 */
export function renderReference(program = createProgram()) {
	const checker = program.getTypeChecker();
	const pages = new Map();
	for (const [name, entry] of entries()) {
		const [slug, title, description, [guide, guideUrl]] = PAGES[name] ?? [];
		if (!slug) throw new Error(`reference-docs.mjs has no page for ${name}`);
		const file = program.getSourceFile(sourceOf(entry));
		const exports = checker
			.getExportsOfModule(checker.getSymbolAtLocation(file))
			.sort((a, b) => a.name.localeCompare(b.name));
		const names = new Set(exports.map((exported) => exported.name));
		const groups = new Map(GROUPS.map((group) => [group, []]));
		for (const exported of exports) {
			const symbol =
				exported.flags & ts.SymbolFlags.Alias
					? checker.getAliasedSymbol(exported)
					: exported;
			const declaration =
				(symbol.declarations ?? []).find(
					(node) => !(ts.isFunctionDeclaration(node) && node.body),
				) ?? symbol.declarations?.[0];
			if (!declaration) continue;
			groups.get(groupOf(exported.name, declaration)).push({
				name: exported.name,
				summary: summaryOf(declaration, names),
				table: /(Options|Props)$/.test(exported.name),
			});
		}
		const importPath =
			name === "." ? pkg.name : `${pkg.name}/${name.slice(2)}`;
		const types = `node_modules/${pkg.name}/${entry.types.replace(/^\.\//, "")}`;
		let body = `---
title: ${JSON.stringify(title)}
description: ${JSON.stringify(description)}
---

\`\`\`ts
import { … } from "${importPath}";
\`\`\`

Guide: [${guide}](${guideUrl}).
`;
		for (const [group, items] of groups) {
			if (items.length === 0) continue;
			body += `\n## ${group}\n`;
			for (const item of items) {
				body += `\n### ${item.name}\n\n${item.summary}\n`;
				if (item.table)
					body += `\n<auto-type-table cwd path="${types}" name="${item.name}" />\n`;
			}
		}
		pages.set(`${OUT}/${slug}.mdx`, body);
	}
	pages.set(`${OUT}/error-codes.mdx`, renderErrorCodes(program));
	return pages;
}

function renderErrorCodes(program) {
	const source = program.getSourceFile(join(root, "src", "core", "errors.ts"));
	const alias = source.statements.find(
		(statement) =>
			ts.isTypeAliasDeclaration(statement) &&
			statement.name.text === "AuthErrorCode",
	);
	let body = `---
title: Error codes
description: Every AuthErrorCode, what it means and when you'll see it.
---

Every error Session kit throws or reports is an \`AuthError\`. Match on its
\`code\`; the \`message\` is for people, and may change.

\`\`\`ts title="src/error-codes.ts"
import { AuthError } from "@monarcode/session-kit";

export function isLocked(error: unknown): boolean {
	return error instanceof AuthError && error.code === "LOCKED";
}
\`\`\`

How errors reach your app, and how to show them:
[Errors](/docs/configuration/errors).
`;
	// TypeScript doesn't attach JSDoc to union members, so each code's comment
	// is read from the text between it and the code before it.
	let previous = alias.type.pos;
	for (const member of alias.type.types) {
		const before = source.text.slice(previous, member.getStart(source));
		previous = member.end;
		const doc =
			[...before.matchAll(/\/\*\*([\s\S]*?)\*\//g)].at(-1)?.[1] ?? "";
		const text = doc
			.split("\n")
			.map((line) => line.replace(/^\s*\*\s?/, ""))
			.join("\n")
			.trim();
		body += `\n## ${member.literal.text}\n\n${toMarkdown(text)}\n`;
	}
	return body;
}

function createProgram() {
	return ts.createProgram(
		entries().map(([, entry]) => sourceOf(entry)),
		{
			strict: true,
			noEmit: true,
			jsx: ts.JsxEmit.ReactJSX,
			module: ts.ModuleKind.NodeNext,
			moduleResolution: ts.ModuleResolutionKind.NodeNext,
			target: ts.ScriptTarget.ES2022,
			skipLibCheck: true,
		},
	);
}

function entries() {
	return Object.entries(pkg.exports).filter(
		([name]) => name !== "./package.json",
	);
}

function sourceOf(entry) {
	return join(
		root,
		"src",
		relative(join(root, "dist"), join(root, entry.types)).replace(
			/\.d\.ts$/,
			".ts",
		),
	);
}

function groupOf(name, declaration) {
	if (ts.isFunctionDeclaration(declaration))
		return /^[A-Z]/.test(name) ? "Components" : "Functions";
	if (ts.isClassDeclaration(declaration)) return "Classes";
	if (ts.isVariableDeclaration(declaration))
		return /^[A-Z]/.test(name) ? "Values" : "Functions";
	return "Types";
}

/**
 * A declaration's first paragraph, with a list that it introduces. A link to
 * an export on the same page becomes an anchor; others become code spans.
 */
function summaryOf(node, names) {
	const doc = ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc).at(-1);
	const comment = doc?.comment;
	let text = "";
	for (const part of typeof comment === "string"
		? [{ text: comment }]
		: (comment ?? [])) {
		if (
			ts.isJSDocLink(part) ||
			ts.isJSDocLinkCode(part) ||
			ts.isJSDocLinkPlain(part)
		) {
			const name = part.name?.getText() ?? "";
			text += names.has(name)
				? `[\`${name}\`](#${name.toLowerCase()})`
				: `\`${name}\``;
		} else text += part.text;
	}
	const blocks = text.trim().split(/\n\s*\n/);
	const kept = [blocks[0] ?? ""];
	// A first paragraph ending in a colon introduces a list.
	if (/:\s*$/.test(blocks[0] ?? "") && /^\s*- /.test(blocks[1] ?? ""))
		kept.push(blocks[1]);
	return kept.map(toMarkdown).join("\n\n");
}

/** One block of JSDoc text as Markdown: list items keep their own lines. */
function toMarkdown(block) {
	const lines = [];
	for (const line of block.split("\n").map((part) => part.trim())) {
		if (lines.length === 0 || line.startsWith("- ")) lines.push(line);
		else lines[lines.length - 1] += ` ${line}`;
	}
	return lines.map(escapeMdx).join("\n");
}

/** Escapes what MDX would read as JSX or an expression, outside code spans. */
function escapeMdx(text) {
	return text
		.split(/(`[^`]*`)/)
		.map((part, index) =>
			index % 2 ? part : part.replace(/[{}<>]/g, (char) => `\\${char}`),
		)
		.join("");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	for (const [path, body] of renderReference())
		writeFileSync(join(root, path), body);
	console.log(`✓ wrote the reference to ${OUT}`);
}
