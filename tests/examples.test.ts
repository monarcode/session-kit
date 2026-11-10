import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const examples = join(import.meta.dirname, "..", "examples");

// Each example app stands alone, so these files are copies rather than
// imports. Edit one, then copy it to the rest.
const copies = {
	"the UI": [
		"tanstack-router/src/ui.tsx",
		"tanstack-start-spa/src/ui.tsx",
		"react-router-declarative/src/ui.tsx",
		"react-router-data/src/ui.tsx",
		"react-router-framework-spa/app/ui.tsx",
	],
	"auth with the user from the sign-in response": [
		"tanstack-router/src/auth.ts",
		"react-router-declarative/src/auth.ts",
		"react-router-framework-spa/app/auth.ts",
	],
	"the TanStack Router hooks": [
		"tanstack-router/src/hooks.ts",
		"tanstack-start-spa/src/hooks.ts",
		"tanstack-start-ssr/src/hooks.ts",
	],
	"the TanStack Router guarded layout": [
		"tanstack-router/src/routes/_authenticated.tsx",
		"tanstack-start-spa/src/routes/_authenticated.tsx",
		"tanstack-start-ssr/src/routes/_authenticated.tsx",
	],
	"the TanStack Router login route": [
		"tanstack-router/src/routes/login.tsx",
		"tanstack-start-spa/src/routes/login.tsx",
		"tanstack-start-ssr/src/routes/login.tsx",
	],
	"the DummyJSON address": [
		"tanstack-start-ssr/src/auth/api.ts",
		"next-app/lib/auth/api.ts",
		"react-router-framework-ssr/app/auth/api.ts",
	],
	"auth with the user from the access token": [
		"tanstack-start-spa/src/auth.ts",
		"react-router-data/src/auth.ts",
	],
};

for (const [name, files] of Object.entries(copies)) {
	test(`example apps share one copy of ${name}`, () => {
		const [first, ...rest] = files.map((file) => ({
			file,
			text: readFileSync(join(examples, file), "utf8"),
		}));
		for (const copy of rest)
			assert.equal(
				copy.text,
				first!.text,
				`${copy.file} differs from ${first!.file}`,
			);
	});
}
