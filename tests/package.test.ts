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
import { createAuthHooks, useMirrorAuth } from "@monarcode/session-kit/react";
import {
	requireSession as requireLoaderSession,
	SessionOutlet as RouterSessionOutlet,
	useAuthRevalidation,
} from "@monarcode/session-kit/react-router";
import {
	cookieJarMiddleware,
	routerJar,
} from "@monarcode/session-kit/react-router/server";
import { createServerAuth } from "@monarcode/session-kit/server";
import {
	connectAuth,
	redirectIfSignedIn,
	requireSession,
	SessionOutlet,
	useRouterAuth,
} from "@monarcode/session-kit/tanstack-router";
import {
	loadSession,
	sessionHydration,
} from "@monarcode/session-kit/tanstack-start";
import { startJar } from "@monarcode/session-kit/tanstack-start/server";

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
		sessionHydration,
		startJar,
		nextJar,
		proxyJar,
		useMirrorAuth,
		createAuthHooks,
		connectAuth,
		requireSession,
		redirectIfSignedIn,
		SessionOutlet,
		useRouterAuth,
		requireLoaderSession,
		RouterSessionOutlet,
		useAuthRevalidation,
		cookieJarMiddleware,
		routerJar,
		createAuthFetch,
		Auth,
		AuthFailure,
		sessionBearer,
	]) {
		assert.equal(typeof fn, "function");
	}
});

test("only the Effect entries import effect and effetch, optional peers", async () => {
	const dist = new URL("dist/", packageRoot);
	for (const file of await readdir(dist, { recursive: true })) {
		if (!file.endsWith(".js")) continue;
		const code = await readFile(new URL(file, dist), "utf8");
		if (!file.startsWith(`effect${sep}`) && !file.startsWith(`effetch${sep}`))
			assert.doesNotMatch(code, /from "effect[/"]/, file);
		if (!file.startsWith(`effetch${sep}`))
			assert.doesNotMatch(code, /from "@monarcode\/effetch/, file);
	}
});

test("only the Start server entry imports @tanstack/react-start, an optional peer", async () => {
	const dist = new URL("dist/", packageRoot);
	for (const file of await readdir(dist, { recursive: true })) {
		if (!file.endsWith(".js")) continue;
		const code = await readFile(new URL(file, dist), "utf8");
		if (file !== `tanstack-start${sep}server.js`)
			assert.doesNotMatch(code, /from "@tanstack\/react-start/, file);
	}
});

test("no entry imports next, so any version loads them", async () => {
	const dist = new URL("dist/", packageRoot);
	for (const file of await readdir(dist, { recursive: true })) {
		if (!file.endsWith(".js")) continue;
		const code = await readFile(new URL(file, dist), "utf8");
		// Import statements, not the examples in JSDoc.
		assert.doesNotMatch(code, /^\s*import\b[^;]*from\s*"next[/"]/m, file);
	}
});

test("the React Router server entry imports no react-router, so any version loads it", async () => {
	const code = await readFile(
		new URL("dist/react-router/server.js", packageRoot),
		"utf8",
	);
	assert.doesNotMatch(code, /^\s*import\b[^;]*from\s*"react-router[/"]/m);
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
	assert.match(declarations, /useRouterAuth\(\): RegisteredAuth/);
	assert.doesNotMatch(declarations, /useRouterAuth\(\): any/);
});
