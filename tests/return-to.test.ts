import assert from "node:assert/strict";
import { test } from "node:test";

import { safeReturnTo } from "@monarcode/session-kit";

import { useBrowserMocks } from "./helpers.ts";

useBrowserMocks();

test("return URL rejects external origins, backslashes, controls, and login loops", () => {
	for (const value of [
		"//evil.com",
		"/\\evil.com",
		"/\nevil.com",
		"https://evil.com",
		"/login",
		null,
	])
		assert.equal(safeReturnTo(value), "/");
	assert.equal(
		safeReturnTo("/dashboard?tab=one#title"),
		"/dashboard?tab=one#title",
	);
});

test("return URL treats login path variants and custom login paths as loops", () => {
	for (const value of [
		"/login/",
		"/LOGIN",
		"/Login?next=1",
		"/log%69n",
		"/%E0",
	])
		assert.equal(safeReturnTo(value), "/");
	assert.equal(safeReturnTo("/login/callback"), "/login/callback");
	const options = { loginPath: ["/sign-in", "/auth/Register/"] };
	for (const value of [
		"/sign-in",
		"/Sign-In/",
		"/auth/register",
		"/auth/register/",
	])
		assert.equal(safeReturnTo(value, options), "/");
	assert.equal(safeReturnTo("/login", options), "/login");
	assert.throws(() => safeReturnTo("/", { loginPath: "sign-in" }));
});
