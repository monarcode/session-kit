import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import { z } from "zod";

import { Auth } from "../dist/effect/index.js";
// A program of its own: one `Register` per program, here the mirror client a
// server-rendered app registers.
import { createMirrorAuth, type Session } from "../dist/index.js";
import { createServerAuth, type CookieJar } from "../dist/server/index.js";

const userSchema = z.object({ id: z.number(), firstName: z.string() });
type User = z.output<typeof userSchema>;

const serverAuth = createServerAuth({
	name: "mirror-type-test",
	user: userSchema,
	secret: "a-type-test-secret-that-is-32-chars-long",
});
declare const getSessionFn: () => Promise<Session<User> | null>;

const createAppAuth = () =>
	createMirrorAuth({
		name: "mirror-type-test",
		session: null,
		revalidate: getSessionFn,
		signIn: (data: { username: string }) => {
			void data;
			return getSessionFn().then((session) => session!);
		},
		signOut: async () => {},
	});

declare module "../dist/effect/index.js" {
	interface Register {
		auth: ReturnType<typeof createAppAuth>;
	}
}

declare const jar: CookieJar;
const requestLayer: Layer.Layer<Auth> = Auth.layer(serverAuth.forRequest(jar));
const browserLayer: Layer.Layer<Auth> = Auth.layer(createAppAuth());
const firstName: Effect.Effect<string, unknown, Auth> = Effect.map(
	Auth.session,
	(session) => session.user.firstName,
);
void [requestLayer, browserLayer, firstName];

const otherServer = createServerAuth({
	name: "mirror-type-test",
	user: z.object({ sub: z.string() }),
	secret: "a-type-test-secret-that-is-32-chars-long",
});
// @ts-expect-error A request's session with another user doesn't fit.
Auth.layer(otherServer.forRequest(jar));
const plain = createMirrorAuth({
	name: "mirror-type-test",
	session: null,
	revalidate: getSessionFn,
	signOut: async () => {},
});
// @ts-expect-error A mirror that isn't the registered one doesn't fit.
Auth.layer(plain);
