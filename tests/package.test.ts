import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import { sep } from "node:path";
import test from "node:test";

import {
	createAuth,
	fromAccessToken,
	memoryStorage,
	webStorage,
} from "@monarcode/session-kit";
import { Auth, AuthFailure } from "@monarcode/session-kit/effect";
import { createAuthFetch } from "@monarcode/session-kit/http";
import { createAuthHooks } from "@monarcode/session-kit/react";
import {
	requireSession as requireLoaderSession,
	SessionOutlet as RouterSessionOutlet,
	useAuthRevalidation,
} from "@monarcode/session-kit/react-router";
import {
	connectAuth,
	redirectIfSignedIn,
	requireSession,
	SessionOutlet,
	useRouterAuth,
} from "@monarcode/session-kit/tanstack-router";

const packageRoot = new URL("../", import.meta.url);

test("all public entry points import without browser globals", () => {
	for (const fn of [
		createAuth,
		fromAccessToken,
		memoryStorage,
		webStorage,
		createAuthHooks,
		connectAuth,
		requireSession,
		redirectIfSignedIn,
		SessionOutlet,
		useRouterAuth,
		requireLoaderSession,
		RouterSessionOutlet,
		useAuthRevalidation,
		createAuthFetch,
		Auth,
		AuthFailure,
	]) {
		assert.equal(typeof fn, "function");
	}
});

test("only the Effect entry imports effect, an optional peer", async () => {
	const dist = new URL("dist/", packageRoot);
	for (const file of await readdir(dist, { recursive: true })) {
		if (!file.endsWith(".js") || file.startsWith(`effect${sep}`)) continue;
		const code = await readFile(new URL(file, dist), "utf8");
		assert.doesNotMatch(code, /from "effect[/"]/, file);
	}
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
