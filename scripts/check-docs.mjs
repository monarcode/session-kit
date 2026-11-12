import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import { renderReference } from "./reference-docs.mjs";

/** What TanStack Router's generator would write for its guide's routes. */
const ROUTE_TREE = `
import { Route as rootRoute } from "./routes/__root.js";
import { Route as loginRouteImport } from "./routes/login.js";
import { Route as authenticatedRouteImport } from "./routes/_authenticated.js";
import { Route as authenticatedIndexRouteImport } from "./routes/_authenticated/index.js";

const loginRoute = loginRouteImport.update({
  id: "/login",
  path: "/login",
  getParentRoute: () => rootRoute,
} as any);
const authenticatedRoute = authenticatedRouteImport.update({
  id: "/_authenticated",
  getParentRoute: () => rootRoute,
} as any);
const authenticatedIndexRoute = authenticatedIndexRouteImport.update({
  id: "/",
  path: "/",
  getParentRoute: () => authenticatedRoute,
} as any);

export const routeTree = rootRoute.addChildren([
  loginRoute,
  authenticatedRoute.addChildren([authenticatedIndexRoute]),
]);

declare module "@tanstack/react-router" {
  interface FileRoutesByPath {
    "/login": {
      id: "/login";
      path: "/login";
      fullPath: "/login";
      preLoaderRoute: typeof loginRouteImport;
      parentRoute: typeof rootRoute;
    };
    "/_authenticated": {
      id: "/_authenticated";
      path: "";
      fullPath: "/";
      preLoaderRoute: typeof authenticatedRouteImport;
      parentRoute: typeof rootRoute;
    };
    "/_authenticated/": {
      id: "/_authenticated/";
      path: "/";
      fullPath: "/";
      preLoaderRoute: typeof authenticatedIndexRouteImport;
      parentRoute: typeof authenticatedRoute;
    };
  }
}
`;

/**
 * The parts of `@noble/ciphers` and `expo-crypto` the Expo guide's locking
 * example uses. They are the app's dependencies, not session-kit's.
 */
const LOCKING_DEPS = `
declare module "@noble/ciphers/aes.js" {
  export function gcm(
    key: Uint8Array,
    nonce: Uint8Array,
    AAD?: Uint8Array,
  ): {
    encrypt(plaintext: Uint8Array): Uint8Array;
    decrypt(ciphertext: Uint8Array): Uint8Array;
  };
}
declare module "@noble/ciphers/utils.js" {
  export function bytesToHex(bytes: Uint8Array): string;
  export function hexToBytes(hex: string): Uint8Array;
  export function utf8ToBytes(text: string): Uint8Array;
  export function bytesToUtf8(bytes: Uint8Array): string;
}
declare module "expo-crypto" {
  export function getRandomBytes(byteCount: number): Uint8Array;
}
`;

/** What TanStack Router's generator would write for the Start guide's routes. */
const START_ROUTE_TREE = `
import { Route as rootRoute } from "./routes/__root";
import { Route as authenticatedRouteImport } from "./routes/_authenticated";

const authenticatedRoute = authenticatedRouteImport.update({
  id: "/_authenticated",
  getParentRoute: () => rootRoute,
} as any);

export const routeTree = rootRoute.addChildren([authenticatedRoute]);

declare module "@tanstack/react-router" {
  interface FileRoutesByPath {
    "/_authenticated": {
      id: "/_authenticated";
      path: "";
      fullPath: "/";
      preLoaderRoute: typeof authenticatedRouteImport;
      parentRoute: typeof rootRoute;
    };
  }
}
`;

/** The part of Node's types the Start guide's server code uses. */
const SERVER_ENV = `
declare const process: { env: Record<string, string | undefined> };
`;

/**
 * How a document marks an example: a `<!-- file: path -->` comment before the
 * fence in Markdown, which can't show the path, and the fence's `title` in
 * MDX, which Fumadocs shows above the block. Other meta, such as `twoslash`,
 * may sit beside the title.
 */
const MARKERS = {
	md: /<!-- file: ([\w/()+.$@[\]-]+\.tsx?) -->\s*```tsx?\n([\s\S]*?)\n```/g,
	mdx: new RegExp(
		'^```tsx?[^\\S\\n]+(?:[^\\n]*?\\s)?title="([\\w/()+.$@[\\]-]+\\.tsx?)"' +
			"[^\\n]*\\n([\\s\\S]*?)\\n```$",
		"gm",
	),
};

/** Where the site's pages for the current release line live. */
const PAGES = "site/content/docs/(latest)";

/** A site page's path, from its slug. */
const page = (slug) => `${PAGES}/${slug}.mdx`;

/** The Getting started app, which the other pages build on. */
const GETTING_STARTED = {
	from: page("getting-started"),
	files: [
		"src/backend.ts",
		"src/auth.ts",
		"src/sign-in.tsx",
		"src/hooks.ts",
		"src/app.tsx",
		"src/api.ts",
	],
};

/** A page about the client, compiled with the Getting started app. */
const clientPage = (slug) => ({
	path: page(slug),
	resolutions: ["NodeNext", "Bundler"],
	dom: true,
	fixtures: {},
	shared: GETTING_STARTED,
});

/**
 * The site's pages whose TypeScript examples form one small app per page,
 * marked by the fence's `title="path"`. They can import each other, with
 * `fixtures` standing in for generated files and the app's other
 * dependencies. A page that builds on another page's app names the files it
 * uses as `shared`; its own file replaces a shared one of the same path.
 * `requires` skips a page when an installed package is older than it needs.
 */
const documents = [
	{
		path: page("getting-started"),
		resolutions: ["NodeNext", "Bundler"],
		dom: true,
		fixtures: {},
	},
	{
		path: page("setups/tanstack-router"),
		resolutions: ["NodeNext", "Bundler"],
		dom: true,
		fixtures: { "src/routeTree.gen.ts": ROUTE_TREE },
		shared: {
			from: page("getting-started"),
			files: ["src/backend.ts", "src/auth.ts", "src/sign-in.tsx"],
		},
	},
	{
		path: page("setups/react-router"),
		resolutions: ["NodeNext", "Bundler"],
		dom: true,
		fixtures: {},
		shared: {
			from: page("getting-started"),
			files: [
				"src/backend.ts",
				"src/auth.ts",
				"src/hooks.ts",
				"src/sign-in.tsx",
			],
			// Framework mode keeps its code in `app`.
			directories: ["src", "app"],
		},
	},
	{
		path: page("setups/expo"),
		// Metro resolves like a bundler, and Expo apps import without extensions.
		resolutions: ["Bundler"],
		// No DOM, so browser-only code fails as it would on a device.
		dom: false,
		fixtures: { "src/locking-deps.d.ts": LOCKING_DEPS },
	},
	{
		path: page("setups/tanstack-start"),
		// Vite resolves like a bundler, and Start apps import without extensions.
		resolutions: ["Bundler"],
		dom: true,
		fixtures: {
			"src/routeTree.gen.ts": START_ROUTE_TREE,
			"src/env.d.ts": SERVER_ENV,
		},
	},
	{
		path: page("setups/next"),
		// Next apps resolve like a bundler: `next` has no `exports`.
		resolutions: ["Bundler"],
		// The App Router runs React 19, and the guide uses its APIs.
		requires: { "@types/react": "19.0" },
		dom: true,
		fixtures: {
			"env.d.ts": SERVER_ENV,
			// What `next build` generates: Next's global types, such as `server-only`.
			"next-env.d.ts": '/// <reference types="next" />',
		},
	},
	{
		path: page("setups/react-router-ssr"),
		// React Router's Vite plugin resolves like a bundler.
		resolutions: ["Bundler"],
		// The guide's code is React Router 8's, with the `url` argument.
		requires: { "react-router": "8.0" },
		dom: true,
		fixtures: { "app/env.d.ts": SERVER_ENV },
	},
	{
		path: page("effect"),
		resolutions: ["NodeNext", "Bundler"],
		dom: true,
		fixtures: {},
	},
	clientPage("client/state"),
	clientPage("client/sessions"),
	clientPage("client/signing-in-and-out"),
	clientPage("client/updating-the-user"),
	clientPage("client/requests"),
	clientPage("client/other-http-clients"),
	clientPage("client/users-from-tokens"),
	clientPage("client/locking"),
	clientPage("configuration/errors"),
	clientPage("configuration/debugging"),
	{
		path: page("reference/error-codes"),
		resolutions: ["NodeNext", "Bundler"],
		dom: true,
		fixtures: {},
	},
];

/**
 * How each subpath's JSDoc examples compile, where it differs from the
 * default: under NodeNext and Bundler resolution, with DOM types.
 */
const subpathOptions = {
	// The Expo adapter runs where there's no DOM.
	"./expo": { dom: false },
	// Next apps resolve like a bundler: `next` has no `exports`, so
	// `next/headers` resolves only that way.
	"./next": { bundlerOnly: true },
};

const root = fileURLToPath(new URL("../", import.meta.url));

/**
 * Each subpath in `package.json`'s `exports`: its published declarations,
 * and its entry point in `src`, whose exports are the public API.
 */
const subpaths = Object.entries(
	JSON.parse(readFileSync(join(root, "package.json"), "utf8")).exports,
)
	.filter(([name]) => name !== "./package.json")
	.map(([name, entry]) => {
		const types = join(root, entry.types);
		const source = join(
			root,
			"src",
			relative(join(root, "dist"), types).replace(/\.d\.ts$/, ".ts"),
		);
		return {
			name,
			types,
			source,
			directory: join(source, "..") + sep,
			dom: true,
			bundlerOnly: false,
			...subpathOptions[name],
		};
	});
for (const name of Object.keys(subpathOptions))
	if (!subpaths.some((subpath) => subpath.name === name))
		throw new Error(
			`subpathOptions names ${name}, which package.json doesn't export`,
		);

/**
 * The subpath a source file belongs to: the one whose directory holds it
 * most closely, so `src/core` belongs to the root.
 */
function subpathOf(fileName) {
	let best;
	for (const subpath of subpaths)
		if (
			fileName.startsWith(subpath.directory) &&
			(!best || subpath.directory.length > best.directory.length)
		)
			best = subpath;
	return best;
}

// Examples import the package by name, which resolves to `dist` through its
// `exports` only from inside the package, so they compile under it.
const scratch = join(root, "tests", ".docs-check");
const problems = [];
// Real files parsed once, for every example program.
const parsedFiles = new Map();

const sourceProgram = ts.createProgram(
	subpaths.map((subpath) => subpath.source),
	{ ...readCompilerOptions(), noEmit: true },
);
const exportCount = checkExportDocs(sourceProgram);
checkReference(sourceProgram);
const jsdocExamples = extractJsdocExamples(sourceProgram);
compileExamples("JSDoc", jsdocExamples, ["NodeNext", "Bundler"]);
const checkedDocuments = documents.filter(checkDocument).length;
// Only Markdown can hold the `<!-- from: -->` marker, so only the README
// has excerpts.
const excerpts = checkExcerpts("README.md");
checkPagesListed();
checkLinks();

if (problems.length > 0) {
	console.error(problems.map((problem) => `✗ ${problem}`).join("\n"));
	process.exit(1);
}
console.log(
	`✓ ${exportCount} exports documented, ${jsdocExamples.length} JSDoc examples and ${checkedDocuments} documents compile, ${excerpts} excerpts match, links resolve`,
);

function readCompilerOptions() {
	const parsed = ts.getParsedCommandLineOfConfigFile(
		join(root, "tsconfig.json"),
		{},
		{
			...ts.sys,
			onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
				throw new Error(
					ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
				);
			},
		},
	);
	return parsed.options;
}

function locate(node) {
	const file = node.getSourceFile();
	const { line } = file.getLineAndCharacterOfPosition(node.getStart());
	return `${relative(root, file.fileName)}:${line + 1}`;
}

function docOf(node) {
	const doc = ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc).at(-1);
	const tags = new Map(
		(doc?.tags ?? []).map((tag) => [
			tag.tagName.text,
			ts.getTextOfJSDocComment(tag.comment)?.trim() ?? "",
		]),
	);
	return {
		description: Boolean(ts.getTextOfJSDocComment(doc?.comment)?.trim()),
		tags,
	};
}

/**
 * Every export has a description, an `@example` with a TypeScript fence, and
 * `@since`. Members of options and props types, which callers fill in, have a
 * description too. Returns the number of exports.
 */
function checkExportDocs(program) {
	const checker = program.getTypeChecker();
	const requireFull = (name, node) => {
		const { description, tags } = docOf(node);
		const missing = [
			description ? undefined : "a description",
			/```tsx?\n/.test(tags.get("example") ?? "")
				? undefined
				: "an @example with a ```ts fence",
			/^\d+\.\d+\.\d+$/.test(tags.get("since") ?? "") ? undefined : "@since",
		].filter(Boolean);
		if (missing.length > 0)
			problems.push(`${locate(node)}: ${name} needs ${missing.join(", ")}`);
	};
	const requireMemberDocs = (name, members) => {
		for (const member of members) {
			if (member.name === undefined || !ts.isPropertySignature(member))
				continue;
			if (!docOf(member).description)
				problems.push(
					`${locate(member)}: ${name}.${member.name.getText()} needs a description`,
				);
		}
	};
	// Object types, also when joined with `&` or `|`.
	const literalsOf = (type) =>
		ts.isTypeLiteralNode(type)
			? [type]
			: ts.isIntersectionTypeNode(type) || ts.isUnionTypeNode(type)
				? type.types.flatMap(literalsOf)
				: ts.isParenthesizedTypeNode(type)
					? literalsOf(type.type)
					: [];
	const isOverloadImplementation = (node) =>
		ts.isFunctionDeclaration(node) &&
		node.body !== undefined &&
		checker.getSymbolAtLocation(node.name)?.declarations?.length > 1;
	const seen = new Set();
	for (const subpath of subpaths) {
		const moduleSymbol = checker.getSymbolAtLocation(
			program.getSourceFile(subpath.source),
		);
		for (const exported of checker.getExportsOfModule(moduleSymbol)) {
			const symbol =
				exported.flags & ts.SymbolFlags.Alias
					? checker.getAliasedSymbol(exported)
					: exported;
			if (seen.has(symbol)) continue;
			seen.add(symbol);
			for (const declaration of symbol.declarations ?? []) {
				if (isOverloadImplementation(declaration)) continue;
				requireFull(exported.name, declaration);
				if (!/(Options|Props)$/.test(exported.name)) continue;
				if (ts.isInterfaceDeclaration(declaration))
					requireMemberDocs(exported.name, declaration.members);
				if (ts.isTypeAliasDeclaration(declaration))
					for (const literal of literalsOf(declaration.type))
						requireMemberDocs(exported.name, literal.members);
			}
		}
	}
	return seen.size;
}

/**
 * The reference pages are what `scripts/reference-docs.mjs` renders from the
 * JSDoc, whitespace aside (Oxfmt may wrap them), so they can't fall behind it.
 */
function checkReference(program) {
	const squash = (text) => text.replace(/\s+/g, "");
	for (const [path, body] of renderReference(program)) {
		const file = join(root, path);
		if (
			!existsSync(file) ||
			squash(readFileSync(file, "utf8")) !== squash(body)
		)
			problems.push(
				`${path}: out of date with the JSDoc. Run \`pnpm run docs:reference\`.`,
			);
	}
}

/** The fenced `ts` and `tsx` blocks in `src`'s JSDoc comments. */
function extractJsdocExamples(program) {
	const examples = [];
	const sources = program
		.getSourceFiles()
		.filter((file) => file.fileName.startsWith(join(root, "src") + sep));
	for (const source of sources) {
		const text = source.text;
		const { dom, bundlerOnly } = subpathOf(source.fileName);
		for (const comment of text.matchAll(/\/\*\*[\s\S]*?\*\//g)) {
			const firstLine = text.slice(0, comment.index).split("\n").length;
			let block;
			comment[0]
				.split("\n")
				.map((line) => line.replace(/^\s*\*\s?/, ""))
				.forEach((line, index) => {
					const open = /^```(tsx?)$/.exec(line.trim());
					if (!block && open) {
						block = {
							origin: source.fileName,
							line: firstLine + index + 1,
							path: `example-${examples.length}.${open[1]}`,
							dom,
							bundlerOnly,
							code: [],
						};
					} else if (block && line.trim() === "```") {
						examples.push({ ...block, code: block.code.join("\n") });
						block = undefined;
					} else if (block) block.code.push(line);
				});
		}
	}
	return examples;
}

/** A document's marked examples. */
function markedExamples(path, dom) {
	const text = readFileSync(join(root, path), "utf8");
	const files = [];
	for (const match of text.matchAll(MARKERS[markerOf(path)])) {
		const fenceStart = match.index + match[0].indexOf("```");
		files.push({
			origin: join(root, path),
			line: text.slice(0, fenceStart).split("\n").length + 1,
			path: match[1],
			dom,
			code: match[2],
		});
	}
	return files;
}

function markerOf(path) {
	return path.endsWith(".mdx") ? "mdx" : "md";
}

/**
 * Every site page with a titled example is in `documents`, so a new page
 * can't skip the check. Pages of older release lines are skipped: their
 * examples compiled when their line was current.
 */
function checkPagesListed() {
	const listed = new Set(documents.map(({ path }) => path));
	const pages = readdirSync(join(root, PAGES), { recursive: true })
		.filter((name) => name.endsWith(".mdx"))
		.map((name) => `${PAGES}/${name.split(sep).join("/")}`);
	for (const page of pages) {
		if (listed.has(page)) continue;
		if (markedExamples(page, true).length > 0)
			problems.push(`${page}: has titled examples but isn't in documents`);
	}
}

/**
 * The files a document shares from another's app, where that document has
 * them or, given `directories`, under each of those in place of their own.
 */
function sharedExamples(path, { from, files, directories }, dom) {
	const theirs = markedExamples(from, dom);
	return files.flatMap((name) => {
		const file = theirs.find((candidate) => candidate.path === name);
		if (!file) {
			problems.push(`${path}: ${from} has no example named ${name}`);
			return [];
		}
		const slash = name.indexOf("/");
		if (!directories || slash === -1) return [file];
		return directories.map((directory) => ({
			...file,
			path: directory + name.slice(slash),
		}));
	});
}

/**
 * An example marked `<!-- from: path -->` in a Markdown file is an excerpt of
 * that page's marked examples, which compile: it must match part of one,
 * whitespace aside, so the two can't drift apart. Returns how many `path`
 * has.
 */
function checkExcerpts(path) {
	const text = readFileSync(join(root, path), "utf8");
	const squash = (code) => code.replace(/\s+/g, "");
	const excerpts = [
		...text.matchAll(
			/<!-- from: ([\w/.()-]+\.mdx?) -->\s*```tsx?\n([\s\S]*?)\n```/g,
		),
	];
	const marked = text.match(/<!-- from: /g)?.length ?? 0;
	if (marked !== excerpts.length)
		problems.push(
			`${path}: ${marked - excerpts.length} "from:" comment(s) aren't followed by a ts or tsx example`,
		);
	const sources = new Map();
	for (const match of excerpts) {
		const line = text.slice(0, match.index).split("\n").length;
		if (!existsSync(join(root, match[1]))) {
			problems.push(`${path}:${line}: there is no ${match[1]}`);
			continue;
		}
		if (!sources.has(match[1]))
			sources.set(match[1], markedExamples(match[1], true));
		const found = sources
			.get(match[1])
			.some((file) => squash(file.code).includes(squash(match[2])));
		if (!found)
			problems.push(
				`${path}:${line}: this excerpt isn't in ${match[1]}'s examples`,
			);
	}
	return excerpts.length;
}

/**
 * Compiles a document's marked examples, with its fixtures and shared files,
 * as one app. Returns `false` for a document skipped because a package it
 * needs is older than it requires.
 */
function checkDocument({
	path,
	resolutions,
	dom,
	fixtures,
	shared,
	requires = {},
}) {
	const missing = Object.entries(requires).find(
		([name, minimum]) => !installedAtLeast(name, minimum),
	);
	if (missing) {
		console.log(
			`- ${path} skipped: it needs ${missing[0]} ${missing[1]} or later`,
		);
		return false;
	}
	const files = markedExamples(path, dom);
	if (files.length === 0) {
		problems.push(`${path}: no TypeScript examples found`);
		return true;
	}
	for (const [fixture, code] of Object.entries(fixtures))
		files.push({
			origin: join(root, path),
			line: 0,
			path: fixture,
			dom,
			code,
			fixture: true,
		});
	const names = new Set();
	for (const file of files) {
		if (names.has(file.path))
			problems.push(`${path}: two examples are named ${file.path}`);
		names.add(file.path);
	}
	if (shared)
		files.push(
			...sharedExamples(path, shared, dom).filter(
				(file) => !names.has(file.path),
			),
		);
	compileExamples(path, files, resolutions, { together: true });
	return true;
}

/**
 * Type-checks `files` in memory under each module resolution. Files that
 * augment a module (`declare module`), such as TanStack Router's `Register`,
 * compile on their own, since an augmentation applies to every file in a
 * program; the rest share one, unless `together` puts every file in one.
 */
function compileExamples(label, files, resolutions, { together = false } = {}) {
	const directory = join(scratch, label.replace(/[^\w]+/g, "-"));
	const virtual = new Map(
		files.map((file) => [join(directory, file.path), file]),
	);
	const augments = (file) => /\bdeclare\s+(?:module|global)\b/.test(file.code);
	const groups = [];
	for (const dom of [true, false]) {
		const names = [...virtual.keys()].filter(
			(name) => virtual.get(name).dom === dom,
		);
		if (together) groups.push(names);
		else {
			groups.push(names.filter((name) => !augments(virtual.get(name))));
			for (const name of names)
				if (augments(virtual.get(name))) groups.push([name]);
		}
	}
	for (const resolution of resolutions) {
		for (const all of groups) {
			const group = all.filter(
				(name) =>
					resolution === "Bundler" || !virtual.get(name).bundlerOnly,
			);
			if (group.length === 0) continue;
			const options = compilerOptions(resolution, virtual.get(group[0]).dom);
			const program = ts.createProgram(
				group,
				options,
				virtualHost(options, virtual),
			);
			for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
				const message = ts.flattenDiagnosticMessageText(
					diagnostic.messageText,
					"\n",
				);
				const file =
					diagnostic.file && virtual.get(diagnostic.file.fileName);
				if (!file) {
					problems.push(`${label} (${resolution}): ${message}`);
					continue;
				}
				const { line } = diagnostic.file.getLineAndCharacterOfPosition(
					diagnostic.start ?? 0,
				);
				problems.push(
					`${relative(root, file.origin)}:${file.line + line} (${file.path}, ${resolution}): TS${diagnostic.code} ${message}`,
				);
			}
		}
	}
}

/**
 * Whether the installed `name` is at least `minimum`: `major.minor`, or a
 * full version, whose prerelease (`-rc.2`) is ordered by its last number.
 */
function installedAtLeast(name, minimum) {
	const manifest = readFileSync(
		join(root, "node_modules", name, "package.json"),
		"utf8",
	);
	const parts = (version) => {
		const [core, prerelease] = version.split("-");
		const [major = 0, minor = 0, patch = 0] = core.split(".").map(Number);
		// A release comes after its own prereleases.
		const order =
			prerelease === undefined
				? Infinity
				: Number(prerelease.split(".").at(-1));
		return [major, minor, patch, order];
	};
	const have = parts(JSON.parse(manifest).version);
	const want = parts(minimum);
	const first = have.findIndex((part, index) => part !== want[index]);
	return first === -1 || have[first] > want[first];
}

function compilerOptions(resolution, dom) {
	return {
		target: ts.ScriptTarget.ES2022,
		lib: [
			"lib.es2022.d.ts",
			...(dom ? ["lib.dom.d.ts", "lib.dom.iterable.d.ts"] : []),
		],
		module:
			resolution === "NodeNext"
				? ts.ModuleKind.NodeNext
				: ts.ModuleKind.ESNext,
		moduleResolution:
			resolution === "NodeNext"
				? ts.ModuleResolutionKind.NodeNext
				: ts.ModuleResolutionKind.Bundler,
		jsx: ts.JsxEmit.ReactJSX,
		strict: true,
		exactOptionalPropertyTypes: true,
		noEmit: true,
		skipLibCheck: true,
		types: [],
	};
}

/** A compiler host that serves `virtual` files and caches real ones. */
function virtualHost(options, virtual) {
	const host = ts.createCompilerHost(options);
	const getSourceFile = host.getSourceFile.bind(host);
	host.getSourceFile = (fileName, version, ...rest) => {
		const file = virtual.get(fileName);
		if (file)
			return ts.createSourceFile(
				fileName,
				// A fixture may declare ambient modules, which `export {}` would
				// turn into augmentations.
				file.fixture ? file.code : `${file.code}\nexport {};\n`,
				version,
				true,
			);
		// How a dependency parses depends on the module format it's imported as.
		const key = `${fileName}|${typeof version === "object" ? `${version.languageVersion}:${version.impliedNodeFormat}` : version}`;
		if (!parsedFiles.has(key))
			parsedFiles.set(key, getSourceFile(fileName, version, ...rest));
		return parsedFiles.get(key);
	};
	host.fileExists = (fileName) =>
		virtual.has(fileName) || ts.sys.fileExists(fileName);
	host.directoryExists = (directory) =>
		[...virtual.keys()].some((name) => name.startsWith(directory + sep)) ||
		ts.sys.directoryExists(directory);
	return host;
}

/**
 * Every `{@link}` in the published `.d.ts` files resolves, so editors can
 * follow it. A name the declaration file doesn't import stays plain text
 * there: write it as a code span instead.
 */
function checkLinks() {
	const program = ts.createProgram(
		subpaths.map((subpath) => subpath.types),
		{ ...readCompilerOptions(), noEmit: true },
	);
	const checker = program.getTypeChecker();
	const seen = new Set();
	const visitComment = (comment) => {
		if (!comment || typeof comment === "string") return;
		for (const part of comment) {
			if (!ts.isJSDocLink(part) && !ts.isJSDocLinkCode(part)) continue;
			if (!part.name || checker.getSymbolAtLocation(part.name)) continue;
			problems.push(
				`${locate(part)}: {@link ${part.name.getText()}} doesn't resolve in the published types`,
			);
		}
	};
	for (const source of program.getSourceFiles()) {
		if (!source.fileName.startsWith(join(root, "dist") + sep)) continue;
		const visit = (node) => {
			for (const doc of ts.getJSDocCommentsAndTags(node)) {
				if (seen.has(doc)) continue;
				seen.add(doc);
				visitComment(doc.comment);
				for (const tag of ts.isJSDoc(doc) ? (doc.tags ?? []) : [])
					visitComment(tag.comment);
			}
			ts.forEachChild(node, visit);
		};
		visit(source);
	}
}
