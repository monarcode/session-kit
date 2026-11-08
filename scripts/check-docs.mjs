import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

/**
 * Documents whose TypeScript examples, marked with a `<!-- file: path -->`
 * comment, are written out and type-checked as one project per document:
 * under each listed module resolution, with `lib`, and with `fixtures`, the
 * generated files the examples import.
 */
const documents = [
	{
		path: "README.md",
		resolutions: ["NodeNext", "Bundler"],
		lib: ["ES2022", "DOM", "DOM.Iterable"],
		fixtures: { "src/routeTree.gen.ts": ROUTE_TREE },
	},
	{
		path: "docs/expo.md",
		// Metro resolves like a bundler, and Expo apps import without extensions.
		resolutions: ["Bundler"],
		// No DOM, so browser-only code fails as it would on a device.
		lib: ["ES2022"],
		fixtures: { "src/locking-deps.d.ts": LOCKING_DEPS },
	},
];

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const compiler = require.resolve("typescript/bin/tsc");

for (const document of documents) await check(document);

async function check({ path: documentPath, resolutions, lib, fixtures }) {
	const text = await readFile(join(root, documentPath), "utf8");
	const examples = [
		...text.matchAll(
			/<!-- file: ([\w/()+.-]+\.tsx?) -->\s*```tsx?\n([\s\S]*?)\n```/g,
		),
	];
	if (!examples.length)
		throw new Error(`No TypeScript examples found in ${documentPath}`);
	const directory = await mkdtemp(join(root, "tests", ".docs-"));
	try {
		const files = { ...fixtures };
		for (const [, path, code] of examples) {
			if (path in files)
				throw new Error(`Duplicate example in ${documentPath}: ${path}`);
			files[path] = code;
		}
		for (const [path, code] of Object.entries(files)) {
			const target = join(directory, path);
			await mkdir(dirname(target), { recursive: true });
			await writeFile(target, code);
		}
		for (const moduleResolution of resolutions) {
			const config = join(directory, "tsconfig.json");
			await writeFile(
				config,
				JSON.stringify({
					compilerOptions: {
						target: "ES2022",
						lib,
						module:
							moduleResolution === "Bundler"
								? "ESNext"
								: moduleResolution,
						moduleResolution,
						jsx: "react-jsx",
						strict: true,
						noEmit: true,
						skipLibCheck: true,
						types: [],
					},
					files: Object.keys(files),
				}),
			);
			const result = spawnSync(process.execPath, [compiler, "-p", config], {
				cwd: root,
				stdio: "inherit",
			});
			if (result.error) throw result.error;
			if (result.status !== 0)
				throw new Error(`${documentPath} ${moduleResolution} check failed`);
			console.log(
				`${documentPath}: ${examples.length} examples passed (${moduleResolution})`,
			);
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}
