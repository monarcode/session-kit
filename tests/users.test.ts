import assert from "node:assert/strict";
import { test } from "node:test";

import { fromAccessToken, type AuthError } from "@monarcode/session-kit";
import { z } from "zod";

import {
	SESSION,
	values,
	cleanups,
	flush,
	input,
	client,
	code,
	broadcast,
	jwt,
	credentialsOf,
	sessionOf,
	saved,
	useBrowserMocks,
} from "./helpers.ts";

useBrowserMocks();

const claims = z.object({
	sub: z.string(),
	email: z.string(),
	role: z.enum(["admin", "member"]),
});
const tokenUser = fromAccessToken(claims, (value) => ({
	id: value.sub,
	email: value.email,
	admin: value.role === "admin",
}));
const alice = { sub: "alice", email: "alice@example.com", role: "member" };

/** A backend issuing a fresh access token on every refresh, with `role`. */
const tokenBackend = () => {
	const backend = {
		role: "member",
		refreshes: 0,
		refresh: async () => ({
			accessToken: jwt({
				...alice,
				role: backend.role,
				jti: ++backend.refreshes,
			}),
		}),
	};
	return backend;
};

test("a user read from the access token needs no user at sign-in and is not saved", async () => {
	const auth = client({ user: tokenUser });
	await auth.signIn({ accessToken: jwt(alice), refreshToken: "refresh-1" });
	const expected = { id: "alice", email: "alice@example.com", admin: false };
	assert.deepEqual(auth.state.get().user, expected);
	assert.equal(Object.isFrozen(auth.state.get().user), true);
	assert.equal("user" in saved(), false);
	assert.equal("updateUser" in auth, false);
	const restored = await sessionOf(client({ user: tokenUser }));
	assert.deepEqual(restored.user, expected);
});

test("without a mapper, the validated claims are the user", async () => {
	const auth = client({
		user: fromAccessToken(z.object({ sub: z.string() })),
	});
	await auth.signIn({ accessToken: jwt({ sub: "alice", exp: 9e9 }) });
	assert.deepEqual(auth.state.get().user, { sub: "alice" });
});

test("a refresh changes the user only when the token's claims change it", async () => {
	const backend = tokenBackend();
	const auth = client({ user: tokenUser, refresh: backend.refresh });
	await auth.signIn({ accessToken: jwt(alice), refreshToken: "refresh-1" });
	const before = auth.state.get();
	await auth.refresh();
	assert.equal(backend.refreshes, 1);
	assert.notEqual((await credentialsOf(auth)).accessToken, jwt(alice));
	assert.equal(auth.state.get().user, before.user);
	assert.equal(auth.state.get().version, before.version);
	backend.role = "admin";
	await auth.refresh();
	assert.equal(auth.state.get().user?.admin, true);
	assert.equal(auth.state.get().version, before.version + 1);
});

test("other tabs follow token changes, keeping an unchanged user", async () => {
	const backend = tokenBackend();
	const a = client({ user: tokenUser, refresh: backend.refresh });
	await a.signIn({ accessToken: jwt(alice), refreshToken: "refresh-1" });
	const b = client({ user: tokenUser, refresh: backend.refresh });
	cleanups.push(b.mount());
	await flush();
	const before = b.state.get();
	await a.refresh();
	await broadcast();
	assert.equal(
		(await credentialsOf(b)).accessToken,
		(await credentialsOf(a)).accessToken,
	);
	assert.equal(b.state.get().user, before.user);
	assert.equal(b.state.get().version, before.version);
	backend.role = "admin";
	await a.refresh();
	await broadcast();
	assert.equal(b.state.get().user?.admin, true);
	assert.equal(b.state.get().version, before.version + 1);
});

test("access tokens that are not JWTs, or whose claims fail the schema, are rejected", async () => {
	const auth = client({ user: tokenUser });
	await assert.rejects(
		auth.signIn({ accessToken: "opaque-token" }),
		code("USER_VALIDATION_FAILED"),
	);
	await assert.rejects(
		auth.signIn({ accessToken: jwt({ ...alice, role: "owner" }) }),
		(error: AuthError) =>
			error.code === "USER_VALIDATION_FAILED" && !!error.issues?.length,
	);
	assert.equal(auth.state.get().user, null);
	assert.equal(values.size, 0);
});

test("a saved token whose claims no longer validate signs out", async () => {
	await client({ user: tokenUser }).signIn({ accessToken: jwt(alice) });
	const stricter = fromAccessToken(
		claims.extend({ role: z.literal("admin") }),
	);
	assert.equal(await client({ user: stricter }).getSession(), null);
	assert.equal(values.has(SESSION), false);
});

test("a custom decode, which may be asynchronous, reads the claims", async () => {
	const decoded: string[] = [];
	const auth = client({
		user: fromAccessToken(z.object({ sub: z.string() }), undefined, {
			decode: async (accessToken) => {
				decoded.push(accessToken);
				return { sub: accessToken.replace("opaque:", "") };
			},
		}),
	});
	await auth.signIn({ accessToken: "opaque:alice" });
	assert.deepEqual(auth.state.get().user, { sub: "alice" });
	assert.deepEqual(decoded, ["opaque:alice"]);
});

test("a user schema that cannot accept its own output fails sign-in", async () => {
	const renaming = z
		.object({ name: z.string() })
		.transform((value) => ({ displayName: value.name }));
	await assert.rejects(
		client({ user: renaming }).signIn(input({ user: { name: "Alice" } })),
		(error: AuthError) =>
			error.code === "USER_VALIDATION_FAILED" &&
			/accept its own output/.test(error.message),
	);
	const drifting = z
		.object({ visits: z.number() })
		.transform((value) => ({ visits: value.visits + 1 }));
	await assert.rejects(
		client({ user: drifting }).signIn(input({ user: { visits: 1 } })),
		(error: AuthError) =>
			error.code === "USER_VALIDATION_FAILED" &&
			/output unchanged/.test(error.message),
	);
	assert.equal(values.size, 0);
});
