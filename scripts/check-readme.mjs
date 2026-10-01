import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const readme = await readFile(join(root, "README.md"), "utf8");
const examples = [...readme.matchAll(
	/<!-- file: (src\/[\w/-]+\.tsx?) -->\s*```tsx?\n([\s\S]*?)\n```/g,
)];
if (!examples.length) throw new Error("No README TypeScript examples found");
const directory = await mkdtemp(join(root, "tests", ".readme-"));
const require = createRequire(import.meta.url);
const compiler = require.resolve("typescript/bin/tsc");
try {
	const paths = new Set();
	for (const [, path, code] of examples) {
		if (paths.has(path)) throw new Error(`Duplicate README example: ${path}`);
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
		await writeFile(join(directory, "src/routeTree.gen.ts"), `
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
`);
	}
	for (const [module, moduleResolution] of [
		["NodeNext", "NodeNext"], ["ESNext", "Bundler"],
	]) {
		const config = join(directory, "tsconfig.json");
		await writeFile(config, JSON.stringify({
			compilerOptions: {
				target: "ES2022", lib: ["ES2022", "DOM", "DOM.Iterable"],
				module, moduleResolution, jsx: "react-jsx", strict: true,
				noEmit: true, skipLibCheck: true, types: [],
			},
			include: ["src/**/*.ts", "src/**/*.tsx"],
		}));
		const result = spawnSync(process.execPath, [compiler, "-p", config], {
			cwd: root, stdio: "inherit",
		});
		if (result.error) throw result.error;
		if (result.status !== 0) throw new Error(`README ${moduleResolution} check failed`);
		console.log(`README: ${examples.length} examples passed (${moduleResolution})`);
	}
} finally {
	await rm(directory, { recursive: true, force: true });
}
