// The site's pages whose examples compile as one small app each, and how to
// read them. `check-docs.mjs` type-checks them, and the site's type hovers
// read the same apps, so the two never disagree on what a page's files are.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../", import.meta.url));

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
import { Route as apiSessionRouteImport } from "./routes/api/session";

const authenticatedRoute = authenticatedRouteImport.update({
  id: "/_authenticated",
  getParentRoute: () => rootRoute,
} as any);
const apiSessionRoute = apiSessionRouteImport.update({
  id: "/api/session",
  path: "/api/session",
  getParentRoute: () => rootRoute,
} as any);

export const routeTree = rootRoute.addChildren([
  authenticatedRoute,
  apiSessionRoute,
]);

declare module "@tanstack/react-router" {
  interface FileRoutesByPath {
    "/_authenticated": {
      id: "/_authenticated";
      path: "";
      fullPath: "/";
      preLoaderRoute: typeof authenticatedRouteImport;
      parentRoute: typeof rootRoute;
    };
    "/api/session": {
      id: "/api/session";
      path: "/api/session";
      fullPath: "/api/session";
      preLoaderRoute: typeof apiSessionRouteImport;
      parentRoute: typeof rootRoute;
    };
  }
}
`;

/** The part of Node's types the server guides' code uses. */
const SERVER_ENV = `
declare const process: { env: Record<string, string | undefined> };
`;

/** An example's path: a TypeScript file, possibly in route-style folders. */
const PATH = String.raw`[\w/()+.$@[\]-]+\.tsx?`;

/**
 * How a document marks an example: a `<!-- file: path -->` comment before the
 * fence in Markdown, which can't show the path, and the fence's `title` in
 * MDX, which Fumadocs shows above the block. Other meta, such as `twoslash`,
 * may sit beside the title.
 */
export const MARKERS = {
	md: new RegExp(
		`<!-- file: (${PATH}) -->\\s*\`\`\`tsx?\\n([\\s\\S]*?)\\n\`\`\``,
		"g",
	),
	mdx: new RegExp(
		`^\`\`\`tsx?[^\\S\\n]+(?:[^\\n]*?\\s)?title="(${PATH})"` +
			"[^\\n]*\\n([\\s\\S]*?)\\n```$",
		"gm",
	),
};

/** An example's path in a fence's meta, as `MARKERS.mdx` reads it. */
export const TITLE = new RegExp(`(?:^|\\s)title="(${PATH})"`);

/** Where the site's pages for the current release line live. */
export const PAGES = "site/content/docs/(latest)";

/** A site page's path, from its slug. */
const page = (slug) => `${PAGES}/${slug}.mdx`;

/** The Getting started app, which the other pages build on. */
const GETTING_STARTED = {
	from: page("getting-started"),
	files: [
		"src/backend.ts",
		"src/auth.ts",
		"src/sign-in.tsx",
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
export const documents = [
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
			files: ["src/backend.ts", "src/auth.ts", "src/sign-in.tsx"],
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
		path: page("server-rendering/server-sessions"),
		resolutions: ["NodeNext", "Bundler"],
		dom: true,
		fixtures: { "src/env.d.ts": SERVER_ENV },
	},
	{
		path: page("server-rendering/hybrid"),
		// It builds on the TanStack Start guide's app.
		resolutions: ["Bundler"],
		dom: true,
		fixtures: {
			"src/routeTree.gen.ts": START_ROUTE_TREE,
			"src/env.d.ts": SERVER_ENV,
		},
		shared: {
			from: page("setups/tanstack-start"),
			files: [
				"src/auth/server.ts",
				"src/routes/api/session.ts",
				"src/start.ts",
				"src/router.tsx",
				"src/routes/__root.tsx",
				"src/routes/_authenticated.tsx",
			],
		},
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
	clientPage("configuration/expiry"),
	clientPage("configuration/storage"),
	clientPage("configuration/errors"),
	clientPage("configuration/debugging"),
	{
		path: page("reference/error-codes"),
		resolutions: ["NodeNext", "Bundler"],
		dom: true,
		fixtures: {},
	},
];

/** A document's marked examples. */
export function markedExamples(path, dom) {
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
 * The files a document shares from another's app, where that document has
 * them or, given `directories`, under each of those in place of their own.
 * `report` hears of a file the other document doesn't have.
 */
function sharedExamples(path, { from, files, directories }, dom, report) {
	const theirs = markedExamples(from, dom);
	return files.flatMap((name) => {
		const file = theirs.find((candidate) => candidate.path === name);
		if (!file) {
			report(`${path}: ${from} has no example named ${name}`);
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
 * Whether the installed `name` is at least `minimum`: `major.minor`, or a
 * full version, whose prerelease (`-rc.2`) is ordered by its last number.
 */
export function installedAtLeast(name, minimum) {
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

/**
 * A document's app: its marked examples, its fixtures, and the files it
 * shares from another document, unless it has its own of the same path.
 * `report` hears of a problem with the document itself.
 */
export function pageApp({ path, dom, fixtures, shared }, report) {
	const files = markedExamples(path, dom);
	if (files.length === 0) {
		report(`${path}: no TypeScript examples found`);
		return files;
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
			report(`${path}: two examples are named ${file.path}`);
		names.add(file.path);
	}
	if (shared)
		files.push(
			...sharedExamples(path, shared, dom, report).filter(
				(file) => !names.has(file.path),
			),
		);
	return files;
}

/**
 * The compiler options examples compile with, in `tsconfig.json` form, under
 * `NodeNext` or `Bundler` resolution, with or without DOM types.
 */
export function compilerSettings(resolution, dom) {
	return {
		target: "es2022",
		lib: ["es2022", ...(dom ? ["dom", "dom.iterable"] : [])],
		module: resolution === "NodeNext" ? "nodenext" : "esnext",
		moduleResolution: resolution === "NodeNext" ? "nodenext" : "bundler",
		jsx: "react-jsx",
		strict: true,
		exactOptionalPropertyTypes: true,
		noEmit: true,
		skipLibCheck: true,
		types: [],
	};
}
