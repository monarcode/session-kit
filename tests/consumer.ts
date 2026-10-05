import {
	createRootRouteWithContext,
	createRouter,
} from "@tanstack/react-router";
import { z } from "zod";

import { createAuthFetch } from "../dist/http/index.js";
import {
	createAuth,
	fromAccessToken,
	memoryStorage,
	webStorage,
	type AuthState,
	type AuthStorage,
	type RefreshFn,
	type UserInput,
} from "../dist/index.js";
import * as reactRouter from "../dist/react-router/index.js";
import { createAuthHooks } from "../dist/react/index.js";
import {
	connectAuth,
	requireSession,
	SessionOutlet,
	useRouterAuth,
} from "../dist/tanstack-router/index.js";

const userSchema = z.object({ id: z.string(), email: z.string() });

const auth = createAuth({
	name: "type-test",
	user: userSchema,
	storage: webStorage(),
	refresh: async () => ({
		accessToken: "new-token",
		expiresIn: 3600,
	}),
});
const root = createRootRouteWithContext<{ auth: typeof auth }>()({});
const router = createRouter({ routeTree: root, context: { auth } });
declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}

connectAuth(router);
createAuthFetch(auth, "https://api.example.com");

// Provider-free hooks typed by the registered Router.
const { useAuth, useAuthClient } = createAuthHooks({
	useClient: useRouterAuth,
});
// Hooks for an explicit client type, with a provider.
const provided = createAuthHooks<typeof auth>();
provided.AuthProvider({ client: auth });
const otherAuth = createAuth({
	name: "other",
	user: z.object({ n: z.number() }),
	storage: webStorage(),
});
// @ts-expect-error The provider takes the client these hooks were made for.
provided.AuthProvider({ client: otherAuth });
SessionOutlet({ pending: "Checking session…" });

async function guard() {
	const { session } = await requireSession(auth, {
		location: { href: "/private" },
		loginPath: "/login",
	});
	const email: string = session.user.email;
	return email;
}
void guard;

function Component() {
	const email: string | undefined = useAuth((state) => state.user?.email);
	const client = useAuthClient();
	const all = useAuth();
	// @ts-expect-error User fields come from the schema.
	useAuth((state) => state.user?.missing);
	// @ts-expect-error signIn requires schema-compatible user input.
	void client.signIn({ accessToken: "token", user: { id: 42 } });
	return { email, all };
}
void Component;

type IsAny<T> = 0 extends 1 & T ? true : false;
type AssertFalse<T extends false> = T;
export type ClientMustNotBeAny = AssertFalse<
	IsAny<ReturnType<typeof useAuthClient>>
>;
type State = ReturnType<ReturnType<typeof useAuthClient>["state"]["get"]>;
export type UserMustNotBeAny = AssertFalse<IsAny<State["user"]>>;

// Checking `status` narrows `user`.
function greet(state: AuthState<{ email: string }>) {
	if (state.status === "authenticated" || state.status === "refreshing") {
		const email: string = state.user.email;
		const sessionId: string = state.sessionId;
		return { email, sessionId };
	}
	const signedOut: null = state.user;
	return signedOut;
}
void greet;

// Sessions carry no tokens; credentials do.
async function sessions() {
	const session = await auth.getSession();
	// @ts-expect-error Sessions hold no tokens.
	void session?.accessToken;
	const credentials = await auth.credentials.get();
	const token: string | undefined = credentials?.accessToken;
	return { id: session?.sessionId, token };
}
void sessions;

// A standalone refresh callback is typed with `RefreshFn`.
const standaloneRefresh: RefreshFn<
	UserInput<typeof userSchema>
> = async () => ({
	accessToken: "token",
	user: { id: "a", email: "a@example.com" },
});
createAuth({
	name: "standalone",
	user: userSchema,
	storage: webStorage(),
	refresh: standaloneRefresh,
});
createAuth({
	name: "bad",
	user: userSchema,
	storage: webStorage(),
	// @ts-expect-error Refresh results must match the schema input.
	refresh: async () => ({ accessToken: "token", user: { id: 42 } }),
});
// @ts-expect-error Storage is required.
createAuth({ name: "no-storage", user: userSchema });

// A user read from the access token: tokens only, and no `updateUser`.
const tokenAuth = createAuth({
	name: "token-user",
	user: fromAccessToken(
		z.object({ sub: z.string(), role: z.enum(["admin", "member"]) }),
		(claims) => ({ id: claims.sub, admin: claims.role === "admin" }),
	),
	storage: memoryStorage(),
	refresh: async () => ({ accessToken: "token" }),
});
void tokenAuth.signIn({ accessToken: "token", refreshToken: "refresh" });
// @ts-expect-error Users come from the token, so signIn takes no user.
void tokenAuth.signIn({ accessToken: "token", user: { id: "a" } });
// @ts-expect-error There is no updateUser; refresh to get a new token.
void tokenAuth.updateUser;
void tokenAuth.refresh();
const admin: boolean | undefined = tokenAuth.state.get().user?.admin;
void admin;
createAuth({
	name: "token-refresh",
	user: fromAccessToken(z.object({ sub: z.string() })),
	storage: memoryStorage(),
	// @ts-expect-error Refresh results carry no user when it comes from the token.
	refresh: async () => ({ accessToken: "token", user: { sub: "a" } }),
});
const claimsUser = createAuth({
	name: "claims",
	user: fromAccessToken(z.object({ sub: z.string() })),
	storage: memoryStorage(),
});
const sub: string | undefined = claimsUser.state.get().user?.sub;
void sub;

// Storage may be synchronous or asynchronous.
const asyncStorage: AuthStorage = {
	get: async () => null,
	set: async () => {},
	remove: async () => {},
};
for (const storage of [
	asyncStorage,
	memoryStorage(),
	webStorage({ area: "session" }),
]) {
	createAuth({ name: "stored", user: userSchema, storage });
}
// @ts-expect-error Storage values are strings.
const numericStorage: AuthStorage = { get: () => 1, set() {}, remove() {} };
void numericStorage;

// React Router: loader guards and components share the TanStack shapes.
async function loader({ request }: { request: Request }) {
	const { session } = await reactRouter.requireSession(auth, {
		request,
		loginPath: "/login",
	});
	const email: string = session.user.email;
	return email;
}
void loader;
reactRouter.SessionOutlet({
	loginPath: "/login",
	unavailable: ({ error, retry }) => `${error?.code}${String(retry)}`,
});
// @ts-expect-error The outlet needs the sign-in path.
reactRouter.SessionOutlet({});
