// A program of its own, that registers nothing: the hooks still work, with an
// `unknown` user, and TanStack Router's need the Router registered.
import { z } from "zod";

import { Auth } from "../dist/effect/index.js";
import {
	createAuth,
	createMirrorAuth,
	webStorage,
	type AuthClient,
	type AuthState,
	type RegisteredAuth,
} from "../dist/index.js";
import {
	AuthProvider,
	useAuth,
	useAuthClient,
	type ProvidedAuth,
} from "../dist/react/index.js";
import * as router from "../dist/tanstack-router/index.js";

const auth = createAuth({
	name: "unregistered-type-test",
	user: z.object({ id: z.string() }),
	storage: webStorage(),
});

AuthProvider({ client: auth });
// A mirror made without `signIn` fits too.
AuthProvider({
	client: createMirrorAuth({
		name: "unregistered-mirror",
		session: null,
		revalidate: async () => null,
		signOut: async () => {},
	}),
});
const state: AuthState<unknown> = useAuth();
const user: unknown = useAuth((current) => current.user);
// @ts-expect-error Without a registration, the user's fields are unknown.
void useAuth((current) => current.user?.id);
// @ts-expect-error Without a selector, it returns the state, whatever is asked.
const notState: string = useAuth();
const client: ProvidedAuth = useAuthClient();
void client.signOut();
// @ts-expect-error Only what every client has: a mirror has no `retry`.
void client.retry();
// Effect's fallback is a full client, with an `unknown` user.
declare const effectClient: RegisteredAuth;
const fallback: AuthClient<unknown, unknown> = effectClient;
void [state, user, notState, fallback];
void Auth.layer(auth);

// Until the Router is registered, its client is `never`.
const routerClient: never = router.useAuthClient();
void routerClient;
