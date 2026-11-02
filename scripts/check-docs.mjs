import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * TypeScript examples marked with a `<!-- file: path -->` comment. Each
 * document's examples are written out and type-checked as one project, under
 * each listed module resolution.
 */
const documents = [
	{ path: "README.md", resolutions: ["NodeNext", "Bundler"] },
	// Metro resolves like a bundler, and Expo apps import without extensions.
	{ path: "docs/expo.md", resolutions: ["Bundler"] },
];

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const compiler = require.resolve("typescript/bin/tsc");

for (const document of documents) await check(document);

async function check({ path: documentPath, resolutions }) {
	const text = await readFile(join(root, documentPath), "utf8");
	const examples = [
		...text.matchAll(
			/<!-- file: ((?:src|app)\/[\w/()+.-]+\.tsx?) -->\s*```tsx?\n([\s\S]*?)\n```/g,
		),
	];
	if (!examples.length)
		throw new Error(`No TypeScript examples found in ${documentPath}`);
	const directory = await mkdtemp(join(root, "tests", ".docs-"));
	try {
		const paths = new Set();
		for (const [, path, code] of examples) {
			if (paths.has(path))
				throw new Error(`Duplicate example in ${documentPath}: ${path}`);
			paths.add(path);
			const target = join(directory, path);
			await mkdir(dirname(target), { recursive: true });
			await writeFile(target, code);
		}
		const fileRoutePaths = [
			"src/routes/__root.tsx",
			"src/routes/login.tsx",
			"src/routes/_authenticated.tsx",
			"src/routes/_authenticated/index.tsx",
		];
		if (fileRoutePaths.every((path) => paths.has(path))) {
			await writeFile(
				join(directory, "src/routeTree.gen.ts"),
				`
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
`,
			);
		}
		for (const moduleResolution of resolutions) {
			const module =
				moduleResolution === "Bundler" ? "ESNext" : moduleResolution;
			const config = join(directory, "tsconfig.json");
			await writeFile(
				config,
				JSON.stringify({
					compilerOptions: {
						target: "ES2022",
						lib: ["ES2022", "DOM", "DOM.Iterable"],
						module,
						moduleResolution,
						jsx: "react-jsx",
						strict: true,
						noEmit: true,
						skipLibCheck: true,
						types: [],
					},
					include: [
						"src/**/*.ts",
						"src/**/*.tsx",
						"app/**/*.ts",
						"app/**/*.tsx",
					],
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
