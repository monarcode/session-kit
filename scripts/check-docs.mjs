import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

/** What TanStack Router's generator would write for the README's routes. */
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
 * Markdown documents whose TypeScript examples, marked with a
 * `<!-- file: path -->` comment, form one small app per document: they can
 * import each other, with `fixtures` standing in for generated files and the
 * app's other dependencies.
 */
const documents = [
	{
		path: "README.md",
		resolutions: ["NodeNext", "Bundler"],
		dom: true,
		fixtures: { "src/routeTree.gen.ts": ROUTE_TREE },
	},
	{
		path: "docs/expo.md",
		// Metro resolves like a bundler, and Expo apps import without extensions.
		resolutions: ["Bundler"],
		// No DOM, so browser-only code fails as it would on a device.
		dom: false,
		fixtures: { "src/locking-deps.d.ts": LOCKING_DEPS },
	},
	{
		path: "docs/tanstack-start.md",
		// Vite resolves like a bundler, and Start apps import without extensions.
		resolutions: ["Bundler"],
		dom: true,
		fixtures: {
			"src/routeTree.gen.ts": START_ROUTE_TREE,
			"src/env.d.ts": SERVER_ENV,
		},
	},
	{
		path: "docs/next.md",
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
		path: "docs/react-router-ssr.md",
		// React Router's Vite plugin resolves like a bundler.
		resolutions: ["Bundler"],
		// The guide's code is React Router 8's, with the `url` argument.
		requires: { "react-router": "8.0" },
		dom: true,
		fixtures: { "app/env.d.ts": SERVER_ENV },
	},
	{
		path: "docs/effect.md",
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
const jsdocExamples = extractJsdocExamples(sourceProgram);
compileExamples("JSDoc", jsdocExamples, ["NodeNext", "Bundler"]);
const checkedDocuments = documents.filter(checkDocument).length;
checkLinks();

if (problems.length > 0) {
	console.error(problems.map((problem) => `✗ ${problem}`).join("\n"));
	process.exit(1);
}
console.log(
	`✓ ${exportCount} exports documented, ${jsdocExamples.length} JSDoc examples and ${checkedDocuments} documents compile, links resolve`,
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

/**
 * Compiles a document's marked examples, with its fixtures, as one app.
 * Returns `false` for a document skipped because a package it needs is older
 * than it requires.
 */
function checkDocument({ path, resolutions, dom, fixtures, requires = {} }) {
	for (const [name, minimum] of Object.entries(requires)) {
		if (!installedAtLeast(name, minimum)) {
			console.log(`- ${path} skipped: it needs ${name} ${minimum} or later`);
			return false;
		}
	}
	const text = readFileSync(join(root, path), "utf8");
	const files = [];
	for (const match of text.matchAll(
		/<!-- file: ([\w/()+.-]+\.tsx?) -->\s*```tsx?\n([\s\S]*?)\n```/g,
	)) {
		const codeStart = match.index + match[0].indexOf("```");
		files.push({
			origin: join(root, path),
			line: text.slice(0, codeStart).split("\n").length + 1,
			path: match[1],
			dom,
			code: match[2],
		});
	}
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

/** Whether the installed `name` is at least `minimum`, as `major.minor`. */
function installedAtLeast(name, minimum) {
	const manifest = readFileSync(
		join(root, "node_modules", name, "package.json"),
		"utf8",
	);
	const [major, minor] = JSON.parse(manifest).version.split(".").map(Number);
	const [wantMajor, wantMinor] = minimum.split(".").map(Number);
	return major > wantMajor || (major === wantMajor && minor >= wantMinor);
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
