![session-kit](https://raw.githubusercontent.com/monarcode/session-kit/main/assets/sk-banner.png)

Schema-driven sessions for React, with TanStack Router, React Router, and Expo
Router support, and server rendering with TanStack Start, Next.js, and React
Router.

**Version: 0.1.0-alpha.6. Early development; not ready for production.**

session-kit keeps the tokens your backend issues and manages the session around
them. Your backend does the authentication; session-kit does the rest:

- **Schema-driven users.** A [Standard Schema](https://standardschema.dev)
  validates the user at sign-in, on refresh, on restore, and when another tab
  saves one, and supplies its TypeScript types. Or read the user from a JWT
  access token with `fromAccessToken`.
- **Refresh you can trust.** Early refresh before expiry, one refresh at a time
  across tabs, recovery after a 401, and a clear split between "sign in again"
  and "try again later".
- **Tabs that agree.** Sign-in, sign-out, account switches, profile updates,
  and refreshes reach every open tab.
- **Expo apps too.** Sessions saved in the iOS keychain or Android Keystore,
  the splash screen held while restoring, and deep links kept across the
  sign-in.
- **Server rendering.** With TanStack Start, Next.js, or React Router
  framework mode, the session lives in an encrypted `httpOnly` cookie on the
  server, so the first response is already signed in and the refresh token
  never reaches the browser.
- **Router guards.** Redirect signed-out users with a return URL, keep guarded
  pages in sync with the session, and re-run guards when auth changes.
- **Tokens stay out of reach.** Reactive state and sessions hold no tokens, so
  they are safe to render and to put in route context. Tokens go only to code
  that attaches them to requests, such as `createAuthFetch`.

## Contents

- [Supported setups](#supported-setups)
- [Installation](#installation)
- [Quick start: TanStack Router](#quick-start-tanstack-router)
- [Other setups](#other-setups)
- [Server rendering](#server-rendering)
- [Expo Router](./docs/expo.md)
- [TanStack Start with server rendering](./docs/tanstack-start.md)
- [Next.js](./docs/next.md)
- [React Router with server rendering](./docs/react-router-ssr.md)
- [Server sessions](./docs/server-sessions.md): what the three share
- [Effect](./docs/effect.md)
- [Using the client](#using-the-client)
  - [State](#state)
  - [Sessions and credentials](#sessions-and-credentials)
  - [Signing in and out](#signing-in-and-out)
  - [Profile updates and authenticated requests](#profile-updates-and-authenticated-requests)
  - [Users from the access token](#users-from-the-access-token)
  - [Locking](#locking)
- [Schemas, refresh, and storage](#schemas-refresh-and-storage)
  - [User schemas](#user-schemas)
  - [Refresh](#refresh)
  - [Expiry](#expiry)
  - [Storage](#storage)
  - [Tabs](#tabs)
  - [Errors](#errors)
  - [Debugging](#debugging)
- [Security notes](#security-notes)
- [Entry points](#entry-points)
- [Development](#development)

## Supported setups

Each router setup has a runnable app in [`examples/`](./examples), all signing
in against DummyJSON's public test API.

| Setup                                      | Import                                   | Example app                                                           |
| ------------------------------------------ | ---------------------------------------- | --------------------------------------------------------------------- |
| TanStack Router                            | `@monarcode/session-kit/tanstack-router` | [`tanstack-router`](./examples/tanstack-router)                       |
| TanStack Start, SPA mode                   | `@monarcode/session-kit/tanstack-router` | [`tanstack-start-spa`](./examples/tanstack-start-spa)                 |
| TanStack Start with server rendering       | `@monarcode/session-kit/tanstack-start`  | [`tanstack-start-ssr`](./examples/tanstack-start-ssr)                 |
| React Router, declarative mode             | `@monarcode/session-kit/react-router`    | [`react-router-declarative`](./examples/react-router-declarative)     |
| React Router, data mode                    | `@monarcode/session-kit/react-router`    | [`react-router-data`](./examples/react-router-data)                   |
| React Router, framework mode, `ssr: false` | `@monarcode/session-kit/react-router`    | [`react-router-framework-spa`](./examples/react-router-framework-spa) |
| React Router, framework mode with SSR      | `@monarcode/session-kit/react-router`    | [`react-router-framework-ssr`](./examples/react-router-framework-ssr) |
| Next.js 16, App Router                     | `@monarcode/session-kit/next`            | [`next-app`](./examples/next-app)                                     |
| Expo Router on iOS and Android, SDK 53+    | `@monarcode/session-kit/expo`            | [`expo-router`](./examples/expo-router)                               |
| React without a router                     | `@monarcode/session-kit/react`           | None                                                                  |

Storage adapters: `webStorage()` for `localStorage` or `sessionStorage`,
`secureStorage()` for `expo-secure-store`, `memoryStorage()`, or your own
[`AuthStorage`](#storage), which may be asynchronous. The server-rendered
setups keep the session on the server instead: see
[Server rendering](#server-rendering).

## Installation

Alpha releases are published to the `latest` distribution tag:

```sh
pnpm add @monarcode/session-kit
```

Pin `@monarcode/session-kit@0.1.0-alpha.6` to use this exact version. Alpha
releases may change the public API; see the [release notes](./CHANGELOG.md).

All peer dependencies are optional, so install only what you use:

| Peer                     | Range                   | Needed for                                             |
| ------------------------ | ----------------------- | ------------------------------------------------------ |
| `react`                  | `^18.0.0 \|\| ^19.0.0`  | `/react`, `/tanstack-router`, `/react-router`, `/expo` |
| `@tanstack/react-router` | `^1.132.0`              | `/tanstack-router`                                     |
| `@tanstack/react-start`  | `^1.169.0`              | `/tanstack-start/server`                               |
| `react-router`           | `^7.0.0 \|\| ^8.0.0`    | `/react-router`                                        |
| `next`                   | `^16.0.0`               | `/next`                                                |
| `effect`                 | `^4.1.0`                | `/effect`                                              |
| `@monarcode/effetch`     | `^0.1.0-rc.1`           | `/effetch`                                             |
| `expo-router`            | `^5.0.2` through `^58`  | `/expo`                                                |
| `expo-secure-store`      | `^14.2.0` through `^58` | `/expo`                                                |
| `expo-file-system`       | `^18.1.0` through `^58` | `/expo`                                                |
| `react-native`           | `>=0.79.0`              | `/expo`                                                |

The Expo ranges cover Expo SDK 53 and newer; install them with
`npx expo install` so they match your SDK, as the
[Expo guide](./docs/expo.md#installation) shows. CI tests the oldest and newest
versions in each range, except that `expo-file-system` is tested only at its
newest: 18.1 publishes no `exports` map, so its types don't resolve under
NodeNext. session-kit never imports React DOM. Any Standard Schema V1 library
describes users; the examples use Zod:

```sh
pnpm add react react-dom @tanstack/react-router zod
```

The package is ESM-only and checked with TypeScript 6.0.3 under NodeNext and
Bundler resolution. It needs `AbortController`, and uses `crypto.randomUUID` and
Web Locks when present, falling back without them. On the server,
`@monarcode/session-kit/server` needs Web Crypto, as in Node.js 20 and newer.

## Quick start: TanStack Router

This example signs in against [DummyJSON's auth API](https://dummyjson.com/docs/auth),
a public test backend, so it runs as written. It is the
[`tanstack-router` example app](./examples/tanstack-router) trimmed to its
essentials. It uses file-based routing, so add the Router plugin before the
React plugin:

```ts
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
// vite.config.ts
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
  ],
});
```

The plugin generates `src/routeTree.gen.ts` from the files under `src/routes`.

### 1. Create the client

`src/auth.ts`

<!-- file: src/auth.ts -->

```ts
import { createAuth, webStorage } from "@monarcode/session-kit";
import { z } from "zod";

const API = "https://dummyjson.com";

export const userSchema = z.object({
  id: z.number(),
  username: z.string(),
  email: z.string(),
  firstName: z.string(),
});

const tokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});
// DummyJSON returns the user's fields beside the tokens.
const loginResponseSchema = tokensSchema.extend(userSchema.shape);

export const auth = createAuth({
  name: "my-app",
  user: userSchema,
  storage: webStorage(),
  refresh: async ({ refreshToken, signal }) => {
    const response = await fetch(`${API}/auth/refresh`, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    // Rejected refresh tokens mean "sign in again": DummyJSON answers 403
    // for an invalid one and 401 for a missing one.
    if (response.status === 401 || response.status === 403) return null;
    // Anything else is operational: keep the session and report the error.
    if (!response.ok) throw new Error(`Refresh failed (${response.status})`);
    return tokensSchema.parse(await response.json());
  },
});

export async function signInWithPassword(username: string, password: string) {
  const response = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) throw new Error(`Sign-in failed (${response.status})`);
  const { accessToken, refreshToken, ...user } = loginResponseSchema.parse(
    await response.json(),
  );
  await auth.signIn({ accessToken, refreshToken, user });
}

export type AppAuth = typeof auth;
```

Create one client per auth `name` in each tab. DummyJSON's tokens are JWTs, so
expiry comes from their `exp` and `iat` claims; see
[Expiry](#expiry). Requests omit `credentials: "include"`: session-kit keeps
tokens out of cookies and attaches them itself.

### 2. Create the hooks

`src/auth-hooks.ts`

<!-- file: src/auth-hooks.ts -->

```ts
import { createAuthHooks } from "@monarcode/session-kit/react";
import { useRouterAuth } from "@monarcode/session-kit/tanstack-router";

export const { useAuth, useAuthClient } = createAuthHooks({
  useClient: useRouterAuth,
});
```

`useRouterAuth` reads the client from Router context, so the hooks need no
provider, and Router registration in step 6 gives them your user type.
`useAuth()` returns the reactive state; `useAuth(selector)` re-renders only when
the selection changes. `useAuthClient()` returns the client for actions.

### 3. Type the root route

`src/routes/__root.tsx`

<!-- file: src/routes/__root.tsx -->

```tsx
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";

import { useAuth } from "../auth-hooks.js";
import type { AppAuth } from "../auth.js";

export const Route = createRootRouteWithContext<{ auth: AppAuth }>()({
  component: Root,
});

function Root() {
  // Shows failures that outlive the page that caused them, such as a sign-out
  // that could not clear storage.
  const error = useAuth((state) => state.error);
  return (
    <>
      {error && <p role="alert">{error.message}</p>}
      <Outlet />
    </>
  );
}
```

### 4. Add the sign-in route

`src/routes/login.tsx`

<!-- file: src/routes/login.tsx -->

```tsx
import { useState, type FormEvent } from "react";

import { safeReturnTo } from "@monarcode/session-kit";
import { redirectIfSignedIn } from "@monarcode/session-kit/tanstack-router";
import { createFileRoute, useRouter } from "@tanstack/react-router";

import { signInWithPassword } from "../auth.js";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    redirectTo: safeReturnTo(search.redirectTo),
  }),
  beforeLoad: ({ context, search }) =>
    redirectIfSignedIn(context.auth, { redirectTo: search.redirectTo }),
  component: Login,
});

function Login() {
  const router = useRouter();
  const { redirectTo } = Route.useSearch();
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError("");
    try {
      await signInWithPassword(
        String(form.get("username")),
        String(form.get("password")),
      );
      await router.navigate({ href: redirectTo, replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign in");
    }
  }

  return (
    <form onSubmit={submit}>
      <h1>Sign in</h1>
      {/* DummyJSON's documented test user. */}
      <input
        name="username"
        aria-label="Username"
        defaultValue="emilys"
        autoComplete="username"
      />
      <input
        name="password"
        aria-label="Password"
        type="password"
        defaultValue="emilyspass"
        autoComplete="current-password"
      />
      {error && <p role="alert">{error}</p>}
      <button>Sign in</button>
    </form>
  );
}
```

`safeReturnTo` accepts only same-origin paths and returns `/` for anything else,
including the sign-in page itself, so a stale `redirectTo` cannot loop. Pass
`{ loginPath }` if sign-in lives somewhere other than `/login`.
`redirectIfSignedIn` sends signed-in users on to `redirectTo`, checked the
same way.

### 5. Guard private routes

`src/routes/_authenticated.tsx` is a pathless layout: its child routes are
guarded without `authenticated` appearing in their URLs.

<!-- file: src/routes/_authenticated.tsx -->

```tsx
import {
  requireSession,
  SessionOutlet,
} from "@monarcode/session-kit/tanstack-router";
import {
  createFileRoute,
  type ErrorComponentProps,
} from "@tanstack/react-router";

import { useAuthClient } from "../auth-hooks.js";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: ({ context, location }) =>
    requireSession(context.auth, { location, loginPath: "/login" }),
  errorComponent: SessionError,
  component: () => <SessionOutlet pending={<p>Checking session…</p>} />,
});

/** Shown after a failed refresh; a repeated failure stays in state.error. */
function SessionError({ error }: ErrorComponentProps) {
  const auth = useAuthClient();
  return (
    <div role="alert">
      <p>{error instanceof Error ? error.message : "Something went wrong"}</p>
      <button onClick={() => void auth.retry().catch(() => {})}>Retry</button>
    </div>
  );
}
```

`requireSession` redirects signed-out users to `loginPath` with `redirectTo`
set to where they were going, and puts `{ session }` in route context: child
routes get `session.user`, typed and never `null`. A failed refresh reaches the
error component instead of a redirect, because the user is still signed in.

`SessionOutlet` renders child routes while the session the guard accepted is
still the signed-in one. After a sign-out or an account switch it shows
`pending` until the guard runs again, and remounts child routes for the new
account, so nothing from the previous one stays on screen. Profile updates and
token refreshes keep child routes mounted.

`src/routes/_authenticated/index.tsx`

<!-- file: src/routes/_authenticated/index.tsx -->

```tsx
import { createFileRoute } from "@tanstack/react-router";

import { useAuth, useAuthClient } from "../../auth-hooks.js";

export const Route = createFileRoute("/_authenticated/")({
  component: Home,
});

function Home() {
  const user = useAuth((state) => state.user);
  const auth = useAuthClient();
  return (
    <main>
      <h1>Welcome, {user?.firstName}</h1>
      <button onClick={() => void auth.signOut().catch(() => {})}>
        Sign out
      </button>
    </main>
  );
}
```

### 6. Create and connect the Router

`src/router.tsx`

<!-- file: src/router.tsx -->

```tsx
import { connectAuth } from "@monarcode/session-kit/tanstack-router";
import { createRouter } from "@tanstack/react-router";

import { auth } from "./auth.js";
import { routeTree } from "./routeTree.gen.js";

export const router = createRouter({
  routeTree,
  context: { auth },
  defaultPendingComponent: () => <p>Loading…</p>,
});

// Restores the session, runs expiry timers and tab sync, and re-runs guards
// when auth changes. Call it once, beside the Router.
export const disconnectAuth = connectAuth(router);

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
```

With synchronous storage and a synchronous schema, `connectAuth` restores the
saved session before the first render. Call `disconnectAuth` on app teardown or
hot-module disposal; it stops background work without signing out.

### 7. Render the app

`src/main.tsx`

<!-- file: src/main.tsx -->

```tsx
import { StrictMode } from "react";

import { RouterProvider } from "@tanstack/react-router";
import { createRoot } from "react-dom/client";

import { router } from "./router.js";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
```

## Other setups

The same client works everywhere; only the router wiring changes. The
[example apps](./examples) show each setup complete; these are the guards each
one uses:

| Setup                                      | Guards                                                                     |
| ------------------------------------------ | -------------------------------------------------------------------------- |
| TanStack Router                            | `requireSession` in `beforeLoad`, `SessionOutlet`                          |
| TanStack Start, SPA mode                   | Same as TanStack Router                                                    |
| React Router, declarative mode             | `SessionOutlet` alone                                                      |
| React Router, data mode                    | `requireSession` in loaders, `SessionOutlet`, `useAuthRevalidation`        |
| React Router, framework mode, `ssr: false` | `requireSession` in `clientLoader`, `SessionOutlet`, `useAuthRevalidation` |
| Expo Router                                | `Stack.Protected`, `SessionGate`, `rememberDeepLink`                       |

**TanStack Start in SPA mode.** Create the client and call `connectAuth` inside
`getRouter()`. Set `defaultSsr: false` in `src/start.ts`: Start's own server
still renders requests in SPA mode, and guards need the browser's saved
session. `connectAuth` does nothing while the Router renders on a server, so
the build-time shell shows your pending component.

**React Router.** Import from `@monarcode/session-kit/react-router`, and create
hooks with a provider: `createAuthHooks<typeof auth>()` returns `AuthProvider`,
`useAuth`, and `useAuthClient`. Render `<AuthProvider client={auth}>` around
the router; it mounts the client in a layout effect, so a synchronous restore
happens before the first paint, and never on a server.

- **Declarative mode**: `<SessionOutlet loginPath="/login" />` is the guard. It
  shows `pending` while restoring, sends signed-out users to `loginPath` with
  `redirectTo`, and renders `unavailable({ error, retry })` after a failed
  refresh, or throws to the nearest error boundary without it.
- **Data and framework mode**: `requireSession(auth, { request, loginPath })`
  guards loaders and returns `{ session }`, and
  `redirectIfSignedIn(auth, { redirectTo })` guards the sign-in loader. Call
  `useAuthRevalidation()` once in the root layout so loaders re-run when auth
  changes. Render `SessionOutlet` as the element of the guarded route: when
  another account signs in, it shows `pending` until the loader accepts the
  new session, so child routes never see the previous account's loader data.
  With a router `basename`, pass the same `basename` to `requireSession`.

**Expo Router.** Save the session with `secureStorage()` from
`@monarcode/session-kit/expo`, guard screens with Expo Router's
`Stack.Protected`, and wrap the root navigator in `SessionGate`, which holds
the splash screen while restoring, renders `unavailable({ error, retry })`
after a failed refresh, and re-checks the session when the app returns to the
foreground. `rememberDeepLink` in `+native-intent.tsx` keeps a deep link for
after the sign-in. The [Expo guide](./docs/expo.md) walks through the whole
app.

**Without a router.** `createAuthHooks<typeof auth>()` and `AuthProvider` work
in any React app.

**Effect.** `@monarcode/session-kit/effect` provides the client as an Effect
service, `Auth`, whose Effects fail with a tagged `AuthFailure`, and
`@monarcode/session-kit/effetch` adds `sessionBearer`, an effetch plugin that
sends the access token. The [Effect guide](./docs/effect.md) covers both.

## Server rendering

With server rendering, the session lives on the server: both tokens and the
user sit in one encrypted, `httpOnly` cookie that page scripts can't read. The
first response already shows the signed-in page, with no "Checking session…"
state, and the refresh token never reaches the browser.

- **On the server**, `createServerAuth` from `@monarcode/session-kit/server`
  seals the cookie with your secret and refreshes before rendering. Each of
  its methods takes the request's cookie jar, which each framework's adapter
  gives you.
- **In the browser**, `createMirrorAuth` makes a client that starts from the
  session the server rendered. `AuthProvider`, the hooks, and the router
  guards work with it, and sign-ins and sign-outs reach every tab.
- **Your server code** signs in and out with your backend and calls your API
  with the access token. To call it from the browser too, with
  `createAuthFetch` or `sessionBearer`, opt in with `clientCredentials`: page
  scripts then get the access token in memory, never the refresh token.

| Framework                             | On the server                                   | In the browser                                      | Guide                                      |
| ------------------------------------- | ----------------------------------------------- | --------------------------------------------------- | ------------------------------------------ |
| TanStack Start                        | `startJar()`, refreshing in request middleware  | `sessionHydration`, `loadSession`                   | [TanStack Start](./docs/tanstack-start.md) |
| Next.js 16, App Router                | `nextJar(await cookies())`, `proxyJar` in Proxy | `useMirrorAuth` from `@monarcode/session-kit/react` | [Next.js](./docs/next.md)                  |
| React Router framework mode, with SSR | `cookieJarMiddleware`, `routerJar(context)`     | `useMirrorAuth` from `@monarcode/session-kit/react` | [React Router](./docs/react-router-ssr.md) |

Locking isn't available with server rendering. For another server, such as
the Next.js Pages Router, build a `CookieJar` over its cookies and use
`createServerAuth` directly. [Server sessions](./docs/server-sessions.md)
covers the secret, cookie jars, refreshing across instances, and limits.

## Using the client

### State

```ts
const state = auth.state.get();
const { unsubscribe } = auth.state.subscribe((next) => {});
```

`subscribe` reports later changes, not the current value. A listener that
throws does not interrupt auth; its error is rethrown asynchronously, where
error reporting can catch it. Checking `status` narrows `user`:

| `status`          | Meaning                                                                   | `user` |
| ----------------- | ------------------------------------------------------------------------- | ------ |
| `initializing`    | The saved session is being restored.                                      | `null` |
| `authenticated`   | Access is usable.                                                         | Set    |
| `refreshing`      | A refresh is replacing expired or rejected access.                        | Set    |
| `locked`          | With `locking`, a session is saved, but its tokens wait for `unlock()`.   | Set    |
| `unauthenticated` | No session; sign-in is needed.                                            | `null` |
| `unavailable`     | Restoring failed, or a failed refresh left no usable access; see `error`. | `null` |

A locked session keeps its user, so check `status`, not `user`, to know
whether access is usable.

`state.sessionId` is new on every sign-in and stable across refreshes and
profile updates; scope private cached data, such as TanStack Query results, to
it. `state.version` changes when guards must run again, which is what
`connectAuth` and `useAuthRevalidation` watch. `state.error` holds the latest
failure.

### Sessions and credentials

- `auth.getSession()` resolves who is signed in, `{ sessionId, user }`, or
  `null`, restoring or refreshing first if needed. It never holds tokens.
- `auth.credentials.get()` resolves `{ sessionId, accessToken, expiresAt }` for
  code that attaches tokens to requests. `credentials.renew(credentials)`
  recovers after a 401, and `credentials.reject(credentials)` ends a session
  the server keeps refusing.
- `auth.isCurrent({ sessionId })` tells whether a session is still the current
  one.

### Signing in and out

- `auth.signIn({ accessToken, refreshToken?, expiresIn?, user })` validates and
  saves a new session, replacing any current one. The latest call wins, and
  invalid input keeps the previous session.
- `auth.signOut()` ends the session in every tab and clears storage. The
  optional `revoke` callback then receives the ended tokens, so your backend can
  revoke them; a failed revocation is reported as `REVOKE_FAILED` without
  undoing the sign-out.
- `auth.refresh()` refreshes now, even while the access token is usable.
  `auth.retry()` tries again after a failed refresh.

### Profile updates and authenticated requests

`updateUser` replaces the user and keeps the session. Pass a function to fetch
the new user: if the session changes meanwhile, the result is discarded instead
of landing on another account. `createAuthFetch` attaches the access token:

<!-- file: src/profile.ts -->

```ts
import { createAuthFetch } from "@monarcode/session-kit/http";

import { auth, userSchema } from "./auth.js";

const authFetch = createAuthFetch(auth, "https://dummyjson.com/");

export async function reloadProfile() {
  await auth.updateUser(async () => {
    const response = await authFetch("auth/me");
    if (!response.ok) throw new Error(`Profile failed (${response.status})`);
    return userSchema.parse(await response.json());
  });
}
```

`createAuthFetch` restricts requests to the configured origin and rejects
redirects. After a 401 it refreshes, then replays GET and HEAD once; other
methods are never replayed. A second 401 ends that session, unless you pass
`{ signOutOnRepeated401: false }` for APIs that answer 401 for other reasons.
Signed out, it rejects with `UNAUTHENTICATED`; pass `{ optional: true }` when
one `authFetch` serves public and private endpoints, to send those requests
without a token instead.

### Users from the access token

If your backend puts the user in a JWT access token, read it from there.
`signIn` and the refresh callback then take tokens only, the user changes
whenever the token does, and there is no `updateUser`; call `auth.refresh()` to
pick up a changed user:

```ts
const auth = createAuth({
  name: "my-app",
  user: fromAccessToken(
    z.object({ sub: z.string(), email: z.string() }),
    (claims) => ({ id: claims.sub, email: claims.email }),
  ),
  storage: webStorage(),
});

await auth.signIn({ accessToken, refreshToken });
```

The token is decoded without verifying its signature, which suits a browser: a
user object in a JSON response is trusted to the same degree. Pass `{ decode }`
to verify or decode it yourself. Leave claims that change on every refresh,
such as `exp` or `jti`, out of the user. OAuth providers may change their
access token format, so this suits backends you control. The
[`tanstack-start-spa`](./examples/tanstack-start-spa) and
[`react-router-data`](./examples/react-router-data) examples use this source.

### Locking

For native apps that ask a returning user to unlock, for example with
biometrics, before the app opens. With `locking`, a saved session restores as
`locked`: `user` and `sessionId` are set, but the tokens wait for
`auth.unlock()`.

```ts
const auth = createAuth({
  ...options,
  locking: {
    // Your app's own encryption, with a key it holds in memory.
    seal: (payload) => encrypt(key, payload),
    open: (sealed) => decrypt(key, sealed),
  },
});

await auth.unlock(); // once the app has its key: `authenticated`
await auth.lock(); // `locked` again; the saved session stays
```

- **Sealing.** `seal` encrypts the tokens, a JSON string, whenever they are
  saved, and `open` decrypts them when unlocking, and only then. The user and
  session ID are saved beside them, readable while
  locked. Either function may return a promise. session-kit depends on no
  crypto or biometrics library. `locking: true` stores the tokens as they are,
  for a lock screen in front of an otherwise ordinary session.
- **Unlocking.** `unlock()` resolves the session. Expired access is refreshed
  at once, and a refresh token the backend rejects signs out and resolves
  `null`. Any other refresh failure rejects with `REFRESH_FAILED`, but the
  session is unlocked all the same: `unavailable` until `retry()`, so check
  `status` rather than treating every rejection as still locked. When `open`
  throws, `unlock()` rejects with `UNLOCK_FAILED` and the session stays
  locked. A saved session that can't be used signs out and rejects with
  `INVALID_SESSION`. Overlapping calls share one unlock.
- **While locked.** `getSession`, `retry`, `refresh`, `updateUser`,
  `credentials.get`, and `credentials.renew` reject with `LOCKED`, rather than
  waiting for an unlock that may never come. Nothing refreshes, and timers are
  off. `signIn` replaces the session, which is the password path. `signOut`
  clears it, without calling `revoke`, since the tokens are sealed.
- **Locking again.** `lock()` takes the tokens out of memory and keeps the
  saved session. A refresh already running still saves its tokens, so keep
  the key until the promise settles.
- **Native apps.** Locking is built for apps with one JavaScript context. In
  a browser, tabs don't follow each other with `locking`: a sign-in, sign-out
  or lock in one tab doesn't reach the others, and with rotating refresh
  tokens, two tabs refreshing the same session can sign one of them out. The
  router adapters treat a locked session as signed out. Locking needs a user
  schema: a user read from the access token can't be shown without its token.
- **Existing sessions.** A session saved before `locking` was added restores
  as `locked` too, and is sealed when unlocked. If sealing fails then, it stays
  as it was, and the next save seals it. Turning `locking` off later
  makes sealed sessions unreadable, which signs those users out.

The [Expo guide](./docs/expo.md#locking) has a worked example: a key behind
the device's biometrics, AES-GCM sealing, and a welcome-back screen.

## Schemas, refresh, and storage

### User schemas

The user schema's output must be a plain JSON object. It is saved beside the
tokens and validated again when restored, so the schema must accept its own
output and return it unchanged; sign-in rejects one that does not, such as a
one-way transform, instead of signing users out on their next reload. Accepted
users are copied and frozen. A user another tab saved that this tab's schema
rejects signs every tab out with `USER_VALIDATION_FAILED`, as restoring it
would.

### Refresh

| The refresh callback… | Meaning                                                                               |
| --------------------- | ------------------------------------------------------------------------------------- |
| Returns tokens        | Install them. An omitted refresh token or user keeps the current one.                 |
| Returns `null`        | The backend rejected the refresh token: sign out and clear storage.                   |
| Throws                | Operational failure: keep the session, report `REFRESH_FAILED`, and wait for a retry. |

While connected, the early refresh runs at the earlier of 60 seconds before
expiry or halfway through the token's lifetime, once per token. If it fails,
access stays usable until expiry. Expired or rejected access shows
`refreshing`, with the user still visible, while a refresh runs. If that
refresh fails, access becomes `unavailable` and `getSession()` rethrows the
failure until `auth.retry()`, a sign-in, or a sign-out, so re-running guards
cannot start a refresh loop. Validation and refresh have a 15-second deadline.

To treat every refresh failure as a sign-out, return `null` instead of
throwing.

### Expiry

Expiry comes from `expiresAt`, `expiresIn`, or a JWT's `exp` and `iat`
claims; the `Tokens` type documents which one wins and how a wrong browser
clock affects each.

### Storage

The required `storage` option chooses where the session is saved:

- `webStorage()` uses `localStorage`, shared by every tab.
- `webStorage({ area: "session" })` uses `sessionStorage`: one session per tab,
  ending with the tab. Browsers copy `sessionStorage` into a duplicated tab
  and into windows opened with `window.open`, so both start with the same
  refresh token but never see each other's saves. If the backend rotates
  refresh tokens, whichever tab refreshes second sends a spent token and is
  signed out, or, with reuse detection, both are. Prefer `localStorage` with
  rotating refresh tokens.
- `secureStorage()`, from `@monarcode/session-kit/expo`, uses
  `expo-secure-store` on iOS and Android. It splits sessions over
  SecureStore's 2048-byte limit across keys and reads synchronously; see the
  [Expo guide](./docs/expo.md#secure-storage).
- `memoryStorage()` never persists the session.
- Any object implementing `AuthStorage` works, including one whose operations
  return promises, such as a native secure store. Auth applies operations one
  at a time, in the order it issued them.

Tokens and the user share one `<name>:auth:session` entry, so every save is a
single write other tabs see whole; a user read from the access token is not
saved. `maxAge` (seconds, default 30 days, renewed on each save) bounds how
long a saved session is restored. Sessions saved by earlier alphas are not
restored, so users sign in once after upgrading.

### Tabs

While connected, tabs follow each other through `storage` events: a sign-out
signs out every tab, a sign-in or account switch switches them, and profile
updates and refreshes appear everywhere. Refresh runs under the
`<name>:auth:refresh` Web Lock, so one tab at a time spends the refresh token
and the others reuse what it saved; rotating refresh tokens work with several
tabs open. Without Web Locks, two tabs refreshing at the same instant can both
spend the token; a short reuse window on the backend covers that. An Expo app
has one JavaScript context, so it has no tabs to follow and needs no lock.
With [`locking`](#locking), tabs don't follow each other.

### Errors

Errors from session-kit's own logic are `AuthError`s, whether thrown,
rejected with, or published in `state.error`. Match on their `code`, an
`AuthErrorCode`, such as `REFRESH_FAILED`, `SESSION_CHANGED`,
`USER_VALIDATION_FAILED`, or `INVALID_OPTIONS` for misuse. `cause` holds
whatever failed underneath, and `issues` a schema's issues. `authFetch` lets
`fetch`'s and `Request`'s own failures, such as a network error, through
unchanged.

If storage cannot be written, the session ends and the error is published. If
it cannot be cleared, sign-out still takes effect in this tab, but the promise
rejects and the error stays visible: retry `signOut()` once storage is
available, because undeleted credentials could survive a reload.

### Debugging

The `debug` option reports what auth does: restores, refreshes and why they
ran, timers, storage operations and how long they took, other tabs' changes,
state changes, and what ended a session.

```ts
const auth = createAuth({ ...options, debug: true });
// [session-kit:my-app] refresh: started (proactive) { sessionId: "…", reason: "proactive" }
```

- `true` logs each event as one `console.info` line.
- A function receives each `AuthDebugEvent` instead: `{ name, type, message,
  data?, error? }`, for example to add Sentry breadcrumbs. `type` is one of a
  fixed set, such as `"refresh"` or `"storage"`; the wording of `message` and
  the fields in `data` may change in any release.
- Events leave out tokens, saved values, and user fields; a session appears as
  its `sessionId`, and an error as its code and message, without the cause.
  `{ sensitive: true }` puts them in, so keep it to development builds.
  `{ log, sensitive }` sets both.

A storage adapter can add its own events through the optional `debug` member
of `AuthStorage`, as `secureStorage()` does.

## Security notes

- In browsers, tokens and users are readable by same-origin JavaScript, as
  with any browser-stored credential. In Expo apps, `secureStorage()` keeps
  them in the iOS keychain or encrypted with an Android Keystore key, out of
  Android backups with the `expo-secure-store` config plugin, and removes a
  session an earlier install left in the iOS keychain. Either way, your
  backend must authenticate every request and authorize private operations;
  route guards, screen guards, and local user fields do not.
- With browser storage, tokens never go in cookies, so browsers do not send
  them automatically. With [server rendering](#server-rendering), they sit in
  an encrypted `httpOnly` cookie that page scripts can't read; only the access
  token reaches page scripts, and only with `clientCredentials`.
- Sessions, route context, and loader results hold no tokens. Never put tokens
  in loader results or hydrated page data yourself.

## Entry points

| Import                                         | Exports                                                                                                                |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `@monarcode/session-kit`                       | `createAuth`, `createMirrorAuth`, `fromAccessToken`, `webStorage`, `memoryStorage`, `safeReturnTo`, `AuthError`, types |
| `@monarcode/session-kit/react`                 | `createAuthHooks`, `useMirrorAuth`, hook types                                                                         |
| `@monarcode/session-kit/tanstack-router`       | `connectAuth`, `requireSession`, `redirectIfSignedIn`, `SessionOutlet`, `useRouterAuth`, `RegisteredAuth`              |
| `@monarcode/session-kit/react-router`          | `SessionOutlet`, `requireSession`, `redirectIfSignedIn`, `useAuthRevalidation`                                         |
| `@monarcode/session-kit/react-router/server`   | `cookieJarMiddleware`, `routerJar`, types                                                                              |
| `@monarcode/session-kit/expo`                  | `secureStorage`, `SessionGate`, `rememberDeepLink`, types                                                              |
| `@monarcode/session-kit/server`                | `createServerAuth`, types                                                                                              |
| `@monarcode/session-kit/tanstack-start`        | `sessionHydration`, `loadSession`, types                                                                               |
| `@monarcode/session-kit/tanstack-start/server` | `startJar`                                                                                                             |
| `@monarcode/session-kit/next`                  | `nextJar`, `proxyJar`, types                                                                                           |
| `@monarcode/session-kit/http`                  | `createAuthFetch`                                                                                                      |
| `@monarcode/session-kit/effect`                | `Auth`, `AuthFailure`, `Register`, types                                                                               |
| `@monarcode/session-kit/effetch`               | `sessionBearer`, types                                                                                                 |

Do not import internal `dist` paths.

## Development

Use Node.js 24 or newer and pnpm. The repository is a pnpm workspace: the
package at the root, and the example apps in `examples/`.

```sh
pnpm install
pnpm run check
```

`check` runs Oxlint and Oxfmt, builds the package, runs the tests, and
type-checks the tests, the consumer declarations, and every TypeScript example
marked with a `file:` comment: this README's under NodeNext and Bundler
resolution, the [Expo guide](./docs/expo.md)'s under Bundler resolution,
as Metro resolves, without DOM types, the server-rendering guides' under
Bundler resolution, and the [Effect guide](./docs/effect.md)'s under both. `pnpm test` runs the runtime tests
twice: with synchronous storage, and with storage that settles every operation
late, removals last, to catch ordering bugs. `pnpm run build:examples` builds
the package and every example app.

Tests are TypeScript files that Node runs directly. Behavior tests are split by
area and share the browser mocks in `tests/helpers.ts`; React tests mount real
React DOM, TanStack Router, and React Router in jsdom, and server tests run
TanStack Start's and React Router's real request handling and use Next.js's
own request, response and cookie classes. Expo tests replace
`expo-secure-store`, `expo-file-system`, `expo-router`, and `react-native` with
the mocks in `tests/mocks/`. CI also runs the tests and type tests against the
oldest supported peers, and builds the examples. Before each commit, Husky runs
the lint and format checks. The manual alpha release workflow is documented in
[RELEASING.md](./RELEASING.md).

### Try a local build

Run `pnpm pack`, then install the tarball in your app, replacing `<version>`
with the version in `package.json`:

```sh
pnpm add /absolute/path/to/monarcode-session-kit-<version>.tgz
```
