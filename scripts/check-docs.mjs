import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import ts from "typescript";

import {
	compilerSettings,
	documents,
	installedAtLeast,
	markedExamples,
	PAGES,
	pageApp,
	root,
} from "./docs-pages.mjs";
import { renderReference } from "./reference-docs.mjs";

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
	const report = (message) => problems.push(message);
	const files = pageApp({ path, dom, fixtures, shared }, report);
	if (files.length === 0) return true;
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

function compilerOptions(resolution, dom) {
	const { options, errors } = ts.convertCompilerOptionsFromJson(
		compilerSettings(resolution, dom),
		root,
	);
	if (errors.length > 0)
		throw new Error(
			ts.flattenDiagnosticMessageText(errors[0].messageText, "\n"),
		);
	return options;
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
