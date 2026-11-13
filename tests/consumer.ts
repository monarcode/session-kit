import * as Fetch from "@monarcode/effetch";
import {
	createRootRouteWithContext,
	createRouter,
} from "@tanstack/react-router";
import * as Effect from "effect/Effect";
import type * as HttpClient from "effect/http/HttpClient";
import type * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SecureStore from "expo-secure-store";
import { NextResponse, type NextRequest } from "next/server.js";
import { z } from "zod";

import {
	Auth,
	AuthFailure,
	type AuthFailureCode,
	type RegisteredSession,
} from "../dist/effect/index.js";
import {
	sessionBearer,
	type SessionBearerPlugin,
} from "../dist/effetch/index.js";
import * as expo from "../dist/expo/index.js";
import { createAuthFetch, type AuthFetch } from "../dist/http/index.js";
import {
	createAuth,
	createMirrorAuth,
	fromAccessToken,
	memoryStorage,
	webStorage,
	type AuthClient,
	type AuthDebugEvent,
	type AuthDebugType,
	type AuthErrorCode,
	type AuthLocking,
	type AuthState,
	type AuthStatus,
	type AuthStorage,
	type MirrorAuth,
	type RefreshFn,
	type Session,
	type UserInput,
} from "../dist/index.js";
import { nextJar, proxyJar, type NextCookies } from "../dist/next/index.js";
import * as reactRouter from "../dist/react-router/index.js";
import {
	cookieJarMiddleware,
	routerJar,
	type RouterContextLike,
} from "../dist/react-router/server.js";
import * as react from "../dist/react/index.js";
import {
	createAuthHooks,
	useMirrorAuth,
	type UseMirrorAuthOptions,
} from "../dist/react/index.js";
import {
	createServerAuth,
	type CookieJar,
	type RequestAuth,
} from "../dist/server/index.js";
import {
	connectAuth,
	requireSession,
	SessionOutlet,
	useAuth,
	useAuthClient,
	type RouterAuth,
} from "../dist/tanstack-router/index.js";
import { connectSession, loadSession } from "../dist/tanstack-start/index.js";
import { startJar } from "../dist/tanstack-start/server.js";

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

// One registration types the hooks from `./react` and the Effect service.
declare module "../dist/index.js" {
	interface Register {
		auth: typeof auth;
	}
}

connectAuth(router);
const baseUrl = "https://api.example.com";
createAuthFetch(auth, { baseUrl });
createAuthFetch(auth, { baseUrl, optional: true });
createAuthFetch(auth, { baseUrl, optional: undefined });
// @ts-expect-error The base URL is an option, not an argument.
createAuthFetch(auth, baseUrl);
// @ts-expect-error baseUrl is required.
createAuthFetch(auth, { optional: true });
const authFetch: AuthFetch = createAuthFetch(auth, { baseUrl });
void authFetch("orders", { method: "POST" }).then((response) => response.ok);
void authFetch(new URL("orders", baseUrl));
void authFetch(new Request(`${baseUrl}/orders`), { method: "POST" });
const fakeFetch: AuthFetch = async () => new Response("[]");
const plainFetch: AuthFetch = fetch;
// It fits wherever a `fetch` is taken: the global's type, and the narrower
// ones HTTP clients declare (ky's, then openapi-fetch's).
const asFetch: typeof fetch = authFetch;
const asKyFetch: (input: Request, init?: RequestInit) => Promise<Response> =
	authFetch;
const asOpenApiFetch: (input: Request) => Promise<Response> = authFetch;
void [fakeFetch, plainFetch, asFetch, asKyFetch, asOpenApiFetch];
// @ts-expect-error: a path is required.
void authFetch();

// TanStack Router's hooks, typed by the registered Router.
const routerClient: typeof auth = useAuthClient();
const routerAuth: RouterAuth = routerClient;
void routerAuth;
// The hooks from `./react`, typed by the registered client.
const registeredClient: typeof auth = react.useAuthClient();
const registeredEmail: string | undefined = react.useAuth(
	(state) => state.user?.email,
);
const registeredState: AuthState<z.output<typeof userSchema>> = react.useAuth();
void [registeredClient, registeredEmail, registeredState];
react.AuthProvider({ client: auth });
// @ts-expect-error User fields come from the registered client's schema.
react.useAuth((state) => state.user?.missing);
// @ts-expect-error Without a selector, it returns the state, whatever is asked.
const notState: string = react.useAuth();
// @ts-expect-error Without a selector, it takes no type argument.
react.useAuth<number>();
// @ts-expect-error The router's hook returns the state too.
const notRouterState: string = useAuth();
void [notState, notRouterState];
// The rest of `createAuthHooks`, for an app with several clients.
const fromRouter = createAuthHooks({ useClient: useAuthClient });
const routerEmail: string | undefined = fromRouter.useAuth(
	(state) => state.user?.email,
);
void routerEmail;
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
// @ts-expect-error So does the registered one.
react.AuthProvider({ client: otherAuth });
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
	// @ts-expect-error `user` may still be set while locked.
	const notYet: null = state.user;
	void notYet;
	if (state.status === "locked") return { email: state.user.email };
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

// Debugging: on, a function receiving each event, or options.
const debugBase = { name: "debug", user: userSchema, storage: memoryStorage() };
createAuth({ ...debugBase, debug: true });
createAuth({
	...debugBase,
	debug: (event: AuthDebugEvent) => {
		const type: "refresh" | "state" | "gate" | (string & {}) = event.type;
		void [type, event.name, event.message, event.data, event.error?.code];
	},
});
createAuth({ ...debugBase, debug: { sensitive: true } });
createAuth({ ...debugBase, debug: { log: () => {}, sensitive: false } });
// @ts-expect-error Events have a fixed set of types.
const badType: AuthDebugEvent["type"] = "network";
void badType;
// @ts-expect-error `sensitive` is a boolean.
createAuth({ ...debugBase, debug: { sensitive: "yes" } });
// A storage adapter can report its own events.
const reportingStorage: AuthStorage = {
	...memoryStorage(),
	debug: (key, report, sensitive) => report("ready", { key, sensitive }),
};
void reportingStorage;

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

// `AuthClient` needs both the user and its input, so `updateUser` is never
// silently dropped; `typeof auth` gets both right.
// @ts-expect-error Pass the input type too, or `never` for a token user.
declare const missingInput: AuthClient<{ id: string }>;
void missingInput;
const typed: AuthClient<
	z.infer<typeof userSchema>,
	z.input<typeof userSchema>
> = auth;
void typed.updateUser;
const tokenTyped: AuthClient<{ id: string; admin: boolean }, never> = tokenAuth;
// @ts-expect-error A token user has no `updateUser`.
void tokenTyped.updateUser;

// Expo: `secureStorage()` is an `AuthStorage`, and `SessionGate` takes the
// same `unavailable` render prop as `SessionOutlet`.
const expoAuth = createAuth({
	name: "expo",
	user: userSchema,
	storage: expo.secureStorage({
		keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
		clearOnReinstall: false,
	}),
});
// @ts-expect-error `keychainAccessible` takes one of SecureStore's constants.
expo.secureStorage({ keychainAccessible: "afterFirstUnlock" });
const unavailableProps: expo.UnavailableProps = {
	error: null,
	retry: () => {},
};
void unavailableProps;
expo.SessionGate({
	unavailable: ({ error, retry }) => `${error?.code}${String(retry)}`,
	client: expoAuth,
	children: null,
});
expo.SessionGate({});
expo.SessionGate({ ready: false });
// @ts-expect-error `ready` is a boolean.
expo.SessionGate({ ready: "yes" });
// @ts-expect-error The gate retries through the client, so it needs `retry`.
expo.SessionGate({ client: { state: expoAuth.state, mount: expoAuth.mount } });
expo.rememberDeepLink(expoAuth, "myapp://orders/42", { loginPath: "/sign-in" });
// @ts-expect-error The deep link is kept for one client.
expo.rememberDeepLink("myapp://orders/42");

// Locking: `true`, or the app's `seal` and `open`, which may be async.
createAuth({ ...debugBase, locking: true });
const sealing: AuthLocking = {
	seal: (payload) => payload,
	open: async (sealed) => sealed,
};
const lockable = createAuth({ ...debugBase, locking: sealing });
const relocked: Promise<void> = lockable.lock();
const unlocked: Promise<{ sessionId: string; user: { email: string } } | null> =
	lockable.unlock();
void [relocked, unlocked];
const lockedState = lockable.state.get();
if (lockedState.status === "locked") {
	const lockedEmail: string = lockedState.user.email;
	const lockedId: string = lockedState.sessionId;
	void [lockedEmail, lockedId];
}
const lockedStatus: AuthStatus = "locked";
const lockedCodes: AuthErrorCode[] = [
	"LOCKED",
	"UNLOCK_FAILED",
	"INVALID_OPTIONS",
];
const lockEvents: AuthDebugType = "lock";
void [lockedStatus, lockedCodes, lockEvents];
createAuth({
	name: "token-lock",
	user: fromAccessToken(z.object({ sub: z.string() })),
	storage: memoryStorage(),
	// @ts-expect-error Locking needs a user schema.
	locking: true,
});
// @ts-expect-error `seal` and `open` come together.
createAuth({ ...debugBase, locking: { seal: (payload: string) => payload } });

// Effect: the registered client types every Effect.
const effectSession: Effect.Effect<RegisteredSession, AuthFailure, Auth> =
	Auth.session;
const effectEmail = Auth.session.pipe(
	Effect.map((session) => session.user.email),
);
const effectEmailType: Effect.Effect<string, AuthFailure, Auth> = effectEmail;
const effectMaybe: Effect.Effect<
	Option.Option<{ sessionId: string }>,
	AuthFailure,
	Auth
> = Auth.sessionOption;
const effectStatuses: Stream.Stream<string, never, Auth> = Auth.changes.pipe(
	Stream.map((state) => state.status),
);
const effectHandled: Effect.Effect<string, never, Auth> = effectEmail.pipe(
	Effect.catchTag("AuthFailure", (failure) => Effect.succeed(failure.code)),
);
const effectProvided: Effect.Effect<string, AuthFailure> = Effect.provide(
	effectEmail,
	Auth.layer(auth),
);
Auth.signIn({ accessToken: "a", user: { id: "1", email: "a@example.com" } });
// @ts-expect-error signIn takes the registered client's user input.
Auth.signIn({ accessToken: "a", user: { id: 1 } });
Auth.updateUser({ id: "1", email: "b@example.com" });
// @ts-expect-error updateUser takes the registered client's user input.
Auth.updateUser({ id: "1" });
class ProfileUnavailable {
	readonly _tag = "ProfileUnavailable";
}
declare const fetchProfile: Effect.Effect<
	{ id: string; email: string },
	ProfileUnavailable,
	"Api"
>;
const effectUpdate: Effect.Effect<
	void,
	AuthFailure | ProfileUnavailable,
	Auth | "Api"
> = Auth.updateUser(fetchProfile);
// @ts-expect-error INVALID_OPTIONS is a defect, never a failure.
const effectMisuse: AuthFailureCode = "INVALID_OPTIONS";
void [
	effectSession,
	effectEmailType,
	effectMaybe,
	effectStatuses,
	effectHandled,
	effectProvided,
	effectUpdate,
	effectMisuse,
];

// effetch: make needs Auth once; calls fail with AuthFailure and can override.
const sessionPlugin: SessionBearerPlugin = sessionBearer({
	baseUrl: "https://api.example.com",
	optional: undefined,
});
const makeSessionApi = Fetch.make({
	baseUrl: "https://api.example.com",
	plugins: [sessionPlugin],
});
const madeWithAuth: Effect.Effect<
	Fetch.Client<readonly [SessionBearerPlugin]>,
	never,
	HttpClient.HttpClient | Auth
> = makeSessionApi;
// @ts-expect-error make needs the Auth service.
const madeWithoutAuth: Effect.Effect<unknown, never, HttpClient.HttpClient> =
	makeSessionApi;
declare const sessionApi: Fetch.Client<readonly [SessionBearerPlugin]>;
const sessionCall: Effect.Effect<unknown, AuthFailure | Fetch.FetchError> =
	sessionApi.get("/me");
sessionApi.get("/public", { plugins: { sessionBearer: false } });
sessionApi.get("/me", {
	plugins: { sessionBearer: { signOutOnRepeated401: false } },
});
sessionApi.get("/feed", { plugins: { sessionBearer: { optional: true } } });
// @ts-expect-error Calls can override only optional and signOutOnRepeated401.
sessionApi.get("/me", { plugins: { sessionBearer: { baseUrl: "x" } } });
void [madeWithAuth, madeWithoutAuth, sessionCall];

// Server custody: the engine and the mirror client.
const serverAuth = createServerAuth({
	name: "type-test",
	user: userSchema,
	secret: "a-type-test-secret-that-is-32-chars-long",
	cookie: { sameSite: "strict", secure: undefined },
});
declare const jar: CookieJar;
async function serverSide() {
	const session = await serverAuth.signIn(jar, {
		accessToken: "a",
		user: { id: "1", email: "a@example.com" },
	});
	const email: string = session.user.email;
	// @ts-expect-error signIn needs the user the schema validates.
	await serverAuth.signIn(jar, { accessToken: "a" });
	await serverAuth.updateUser(jar, { id: "1", email });
	const credentials = await serverAuth.clientCredentials.get(jar);
	const expiresIn: number | undefined = credentials?.expiresIn;
	return expiresIn;
}
void serverSide;
const tokenServer = createServerAuth({
	name: "type-test",
	user: fromAccessToken(z.object({ sub: z.string() })),
	secret: ["a-type-test-secret-that-is-32-chars-long"],
});
// @ts-expect-error A user read from the token has no updateUser.
void tokenServer.updateUser;

// One request's session, shaped like a client's read side.
const requestAuth: RequestAuth<z.output<typeof userSchema>> =
	serverAuth.forRequest(jar);
async function requestSide() {
	const session = await requestAuth.getSession();
	const viewEmail: string | undefined = session?.user.email;
	const status: AuthState<unknown>["status"] = requestAuth.state.get().status;
	return [viewEmail, status, await requestAuth.credentials.get()];
}
void requestSide;
createAuthFetch(requestAuth, { baseUrl });
createAuthFetch(tokenServer.forRequest(jar), { baseUrl });
// @ts-expect-error Signing in stays on serverAuth.
void requestAuth.signIn;
// @ts-expect-error So does updateUser.
void requestAuth.updateUser;
// @ts-expect-error The view is read-only.
requestAuth.getSession = async () => null;
// @ts-expect-error So is its state.
requestAuth.state.get = () => requestAuth.state.get();

// On the server, `Auth.layer` takes a request's session with the registered user.
const requestLayer: Layer.Layer<Auth> = Auth.layer(serverAuth.forRequest(jar));
void Effect.runPromise(Effect.provide(Auth.session, requestLayer));
// @ts-expect-error A request's session with another user doesn't fit.
Auth.layer(tokenServer.forRequest(jar));
// @ts-expect-error An Effect that needs the session doesn't run without it.
void Effect.runPromise(Auth.session);

declare const initial: Session<z.output<typeof userSchema>> | null;
const mirror = createMirrorAuth({
	name: "type-test",
	session: initial,
	revalidate: () => serverAuth.getSession(jar),
	signIn: (input: { username: string }) =>
		serverAuth.signIn(jar, {
			accessToken: input.username,
			user: { id: "1", email: "a@example.com" },
		}),
	signOut: () => serverAuth.signOut(jar),
	credentials: {
		get: () => serverAuth.clientCredentials.get(jar),
		renew: (rejected) => serverAuth.clientCredentials.renew(jar, rejected),
	},
});
const mirrorEmail: string | undefined = mirror.state.get().user?.email;
void mirrorEmail;
void mirror.signIn({ username: "emilys" });
// @ts-expect-error signIn takes what the signIn option takes.
void mirror.signIn({ password: "x" });
createAuthFetch(mirror, { baseUrl });
createAuthHooks<typeof mirror>().AuthProvider({ client: mirror });
void requireSession(mirror, {
	location: { href: "/private" },
	loginPath: "/login",
});
const plainMirror: MirrorAuth<{ id: string }> = createMirrorAuth({
	name: "type-test",
	session: null as Session<{ id: string }> | null,
	revalidate: async () => null,
	signOut: async () => {},
});
// @ts-expect-error Without the signIn option, there is no signIn.
void plainMirror.signIn;
// @ts-expect-error The mirror can't lock.
void plainMirror.lock;

// TanStack Start: hydration and the request's jar.
const startRoot = createRootRouteWithContext<{ auth: typeof mirror }>()({});
const startRouter = createRouter({
	routeTree: startRoot,
	context: { auth: mirror },
	// The app's own, beside the session.
	dehydrate: () => ({ theme: "dark" }),
	hydrate: (data: { theme: string }) => void data.theme,
});
const disconnectSession: () => void = connectSession(startRouter);
void disconnectSession;
void connectSession(
	createRouter({
		routeTree: createRootRouteWithContext<{ auth: typeof plainMirror }>()({}),
		context: { auth: plainMirror },
	}),
);
// @ts-expect-error Only a mirror client holds the server's session.
connectSession(router);
void loadSession(mirror);
void loadSession(plainMirror);
// @ts-expect-error Only a mirror client holds the server's session.
void loadSession(auth);
const startCookies: CookieJar = startJar();
void startCookies;

// Next: jars over cookies() and Proxy.
declare const nextCookies: NextCookies;
const pageJar: CookieJar = nextJar(nextCookies);
void pageJar;
void nextJar(nextCookies, { writable: true });
// @ts-expect-error nextJar takes a cookie store.
void nextJar({});
declare const nextRequest: NextRequest;
void proxyJar(nextRequest, NextResponse.next());

// The mirror hook, for any server-rendering framework.
declare const renderAgain: () => void;
const synced = useMirrorAuth({
	create: (session) =>
		createMirrorAuth({
			name: "type-test",
			session,
			revalidate: async () => session,
			signOut: async () => {},
		}),
	session: initial,
	onChange: renderAgain,
});
const syncedUser: z.output<typeof userSchema> | null = synced.state.get().user;
void syncedUser;
useMirrorAuth({
	// @ts-expect-error The client must hold the server session's user.
	create: () => plainMirror,
	session: initial,
	onChange: renderAgain,
});
void useMirrorAuth({
	create: () => mirror,
	session: initial,
	onChange: renderAgain,
}).signIn({ username: "emilys" });
// @ts-expect-error The hook needs to know how to render on the server again.
useMirrorAuth({ create: () => mirror, session: initial });
// @ts-expect-error The options are one object.
useMirrorAuth(() => mirror, initial, renderAgain);
const mirrorOptions: UseMirrorAuthOptions<
	z.output<typeof userSchema>,
	typeof mirror
> = { create: () => mirror, session: initial, onChange: renderAgain };
void useMirrorAuth(mirrorOptions);

// React Router: the request's jar and its middleware.
declare const requestContext: RouterContextLike;
const loaderJar: CookieJar = routerJar(requestContext);
void loaderJar;
// @ts-expect-error routerJar takes the request's context, not its arguments.
routerJar({ request: new Request("https://app.test/") });
const withCookies: Promise<Response> = cookieJarMiddleware(
	{ request: new Request("https://app.test/"), context: requestContext },
	async () => new Response(null),
);
void withCookies;
