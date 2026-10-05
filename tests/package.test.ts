import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

import {
	createAuth,
	fromAccessToken,
	memoryStorage,
	webStorage,
} from "@monarcode/session-kit";
import { createAuthFetch } from "@monarcode/session-kit/http";
import { connectAuth, useAuth } from "@monarcode/session-kit/react";

const packageRoot = new URL("../", import.meta.url);

test("all public entry points import without browser globals", () => {
	for (const fn of [
		createAuth,
		fromAccessToken,
		memoryStorage,
		webStorage,
		connectAuth,
		useAuth,
		createAuthFetch,
	]) {
		assert.equal(typeof fn, "function");
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

test("React declarations retain consumer Router registration", async () => {
	const declarations = await readFile(
		new URL("dist/react/hooks.d.ts", packageRoot),
		"utf8",
	);
	assert.match(declarations, /Register extends/);
	assert.match(declarations, /useAuthClient\(\): RegisteredAuth/);
	assert.doesNotMatch(declarations, /useAuthClient\(\): any/);
});
