import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import { sep } from "node:path";
import test from "node:test";

import {
	createAuth,
	createMirrorAuth,
	fromAccessToken,
	memoryStorage,
	webStorage,
} from "@monarcode/session-kit";
import { Auth, AuthFailure } from "@monarcode/session-kit/effect";
import { sessionBearer } from "@monarcode/session-kit/effetch";
import { createAuthFetch } from "@monarcode/session-kit/http";
import { nextJar, proxyJar } from "@monarcode/session-kit/next";
import {
	AuthProvider,
	createAuthHooks,
	useAuth,
	useAuthClient,
	useMirrorAuth,
} from "@monarcode/session-kit/react";
import {
	requireSession as requireLoaderSession,
	SessionOutlet as RouterSessionOutlet,
	useAuthRevalidation,
} from "@monarcode/session-kit/react-router";
import {
	cookieJarMiddleware,
	routerAuth,
	routerJar,
} from "@monarcode/session-kit/react-router/server";
import { createServerAuth } from "@monarcode/session-kit/server";
import {
	connectAuth,
	redirectIfSignedIn,
	requireSession,
	SessionOutlet,
	useAuth as useRouterState,
	useAuthClient as useRouterClient,
} from "@monarcode/session-kit/tanstack-router";
import {
	connectSession,
	loadSession,
} from "@monarcode/session-kit/tanstack-start";
import {
	startAuth,
	startJar,
} from "@monarcode/session-kit/tanstack-start/server";

const packageRoot = new URL("../", import.meta.url);

test("all public entry points import without browser globals", () => {
	for (const fn of [
		createAuth,
		createMirrorAuth,
		fromAccessToken,
		memoryStorage,
		webStorage,
		createServerAuth,
		loadSession,
		connectSession,
		startJar,
		startAuth,
		nextJar,
		proxyJar,
		useMirrorAuth,
		createAuthHooks,
		AuthProvider,
		useAuth,
		useAuthClient,
		connectAuth,
		requireSession,
		redirectIfSignedIn,
		SessionOutlet,
		useRouterState,
		useRouterClient,
		requireLoaderSession,
		RouterSessionOutlet,
		useAuthRevalidation,
		cookieJarMiddleware,
		routerJar,
		routerAuth,
		createAuthFetch,
		Auth,
		AuthFailure,
		sessionBearer,
	]) {
		assert.equal(typeof fn, "function");
	}
});

/**
 * Whether `code` imports or re-exports `pkg` or one of its subpaths in a
 * statement, not in a JSDoc example.
 */
function imports(code: string, pkg: string): boolean {
	const name = pkg.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
	return new RegExp(
		`^\\s*(?:import|export)\\b[^;]*?["']${name}(?:/[^"']*)?["']`,
		"m",
	).test(code);
}

/**
 * Asserts that only `allowed` files in `dist` import `pkg`, an optional peer.
 * An entry ending in `/` allows a whole directory.
 */
async function assertOnlyImports(pkg: string, allowed: string[]) {
	const dist = new URL("dist/", packageRoot);
	for (const entry of await readdir(dist, { recursive: true })) {
		if (!entry.endsWith(".js")) continue;
		const file = entry.split(sep).join("/");
		if (
			allowed.some((path) =>
				path.endsWith("/") ? file.startsWith(path) : file === path,
			)
		)
			continue;
		const code = await readFile(new URL(entry, dist), "utf8");
		assert.ok(!imports(code, pkg), `${file} imports ${pkg}`);
	}
}

test("the Effect entries never load server code", async () => {
	const dist = new URL("dist/", packageRoot);
	for (const directory of ["effect/", "effetch/"])
		for (const entry of await readdir(new URL(directory, dist))) {
			if (!entry.endsWith(".js")) continue;
			const code = await readFile(new URL(directory + entry, dist), "utf8");
			assert.doesNotMatch(
				code,
				/^\s*(?:import|export)\b[^;]*?["'][^"']*\/server\/[^"']*["']/m,
				`${directory}${entry} loads server code`,
			);
		}
});

test("only the Effect entries import effect and effetch, optional peers", async () => {
	await assertOnlyImports("effect", ["effect/", "effetch/"]);
	await assertOnlyImports("@monarcode/effetch", ["effetch/"]);
});

test("only the Start server entry imports @tanstack/react-start, an optional peer", async () => {
	await assertOnlyImports("@tanstack/react-start", [
		"tanstack-start/server.js",
	]);
});

test("no entry imports next, so any version loads them", async () => {
	await assertOnlyImports("next", []);
});

test("the React Router server entry imports no react-router, so any version loads it", async () => {
	const code = await readFile(
		new URL("dist/react-router/server.js", packageRoot),
		"utf8",
	);
	assert.ok(!imports(code, "react-router"));
});

test("each entry exports readable JavaScript and declarations", async () => {
	const manifest: {
		exports: Record<string, { types: string; import: string }>;
	} = JSON.parse(await readFile(new URL("package.json", packageRoot), "utf8"));
	for (const [name, entry] of Object.entries(manifest.exports)) {
		if (name === "./package.json") continue;
		assert.equal(Object.keys(entry)[0], "types");
		await access(new URL(entry.import, packageRoot));
		await access(new URL(entry.types, packageRoot));
	}
});

test("TanStack Router declarations retain consumer Router registration", async () => {
	const declarations = await readFile(
		new URL("dist/tanstack-router/index.d.ts", packageRoot),
		"utf8",
	);
	assert.match(declarations, /Register extends/);
	assert.match(declarations, /useAuthClient\(\): RouterAuth/);
	assert.doesNotMatch(declarations, /useAuthClient\(\): any/);
});

test("declaration files can name a token user's server session types", async () => {
	const ts = (await import("typescript")).default;
	// Not written to disk: the host below serves it.
	const file = new URL("./declarations.ts", import.meta.url).pathname;
	const source = `
import { fromAccessToken } from "@monarcode/session-kit";
import { nextSession } from "@monarcode/session-kit/next";
import { createServerAuth, type CookieJar } from "@monarcode/session-kit/server";
import { z } from "zod";

export const serverAuth = createServerAuth({
	name: "app",
	user: fromAccessToken(z.object({ sub: z.string() })),
	secret: "a-type-test-secret-that-is-32-chars-long",
});
declare const jar: CookieJar;
export const requestSession = serverAuth.forRequest(jar);
declare const cookies: () => Promise<never>;
declare const redirect: (url: string) => never;
export const session = nextSession(serverAuth, { cookies, redirect });
`;
	const options = {
		strict: true,
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.NodeNext,
		moduleResolution: ts.ModuleResolutionKind.NodeNext,
		declaration: true,
		emitDeclarationOnly: true,
		skipLibCheck: true,
		types: [],
	};
	const host = ts.createCompilerHost(options);
	const { fileExists, readFile } = host;
	host.fileExists = (name) => name === file || fileExists(name);
	host.readFile = (name) => (name === file ? source : readFile(name));
	let declarations = "";
	host.writeFile = (_name, text) => {
		declarations = text;
	};
	const program = ts.createProgram([file], options, host);
	const emitted = program.emit();
	const errors = [
		...ts.getPreEmitDiagnostics(program),
		...emitted.diagnostics,
	].map((diagnostic) =>
		ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
	);
	assert.deepEqual(errors, []);
	for (const name of ["ServerAuth<", "RequestAuth<", "NextSession<"])
		assert.ok(declarations.includes(name), `${name} in ${declarations}`);
});
