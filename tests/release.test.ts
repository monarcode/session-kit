import assert from "node:assert/strict";
import { test } from "node:test";

import { checkRegistry, prepareRelease } from "../scripts/prepare-release.mjs";

const manifest = {
	name: "@monarcode/session-kit",
	version: "0.1.0-alpha.1",
	repository: { url: "git+https://github.com/monarcode/session-kit.git" },
	publishConfig: {
		access: "public",
		registry: "https://registry.npmjs.org/",
	},
};
const changelog =
	"# Changelog\n\n## 0.1.0-alpha.1\n\nNew fix.\n\n### Tests\n\nVerified.\n\n## 0.1.0-alpha.0\n\nOld notes.\n";

test("release notes contain only the selected version, including subsections", () => {
	assert.deepEqual(prepareRelease(manifest, changelog, manifest.version), {
		version: manifest.version,
		tag: "v0.1.0-alpha.1",
		notes: "New fix.\n\n### Tests\n\nVerified.",
	});
	assert.equal(
		prepareRelease(
			manifest,
			changelog.replaceAll("\n", "\r\n"),
			manifest.version,
		).tag,
		"v0.1.0-alpha.1",
	);
});

test("release rejects invalid alpha versions and a package version mismatch", () => {
	for (const version of [
		"0.1.0",
		"0.1.0-beta.1",
		"v0.1.0-alpha.1",
		"0.1.0-alpha.01",
		"01.1.0-alpha.1",
		"0.1.0-alpha.1\n",
		"$(echo bad)",
		undefined,
	]) {
		assert.throws(
			() => prepareRelease(manifest, changelog, version),
			/alpha version/,
		);
	}
	assert.throws(
		() => prepareRelease(manifest, changelog, "0.1.0-alpha.2"),
		/match package/,
	);
});

test("release requires the expected package identity and publishing settings", () => {
	for (const change of [
		{ name: "other" },
		{ repository: {} },
		{ publishConfig: { access: "restricted" } },
	]) {
		assert.throws(
			() =>
				prepareRelease(
					{ ...manifest, ...change },
					changelog,
					manifest.version,
				),
			/configuration/,
		);
	}
});

test("release requires unique, nonempty notes for the version", () => {
	for (const notes of [
		"# Changelog",
		`${changelog}\n## 0.1.0-alpha.1\nDuplicate`,
		"## 0.1.0-alpha.1\n\n## 0.1.0-alpha.0\nOld",
	]) {
		assert.throws(
			() => prepareRelease(manifest, notes, manifest.version),
			/heading|empty/,
		);
	}
});

/** A fetch stand-in answering with only what `checkRegistry` reads. */
const registry = (status: number, ok: boolean) =>
	(async () => ({ status, ok })) as unknown as typeof fetch;

test("registry preflight allows only an unpublished version and propagates failures", async () => {
	await checkRegistry(manifest.version, registry(404, false));
	await assert.rejects(
		checkRegistry(manifest.version, registry(200, true)),
		/already published/,
	);
	await assert.rejects(
		checkRegistry(manifest.version, registry(503, false)),
		/HTTP 503/,
	);
	await assert.rejects(
		checkRegistry(manifest.version, async () => {
			throw new Error("Network unavailable");
		}),
		/Network unavailable/,
	);
});
