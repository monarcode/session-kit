# @monarcode/session-kit

Schema-driven browser sessions for React, with TanStack Router and React Router
support.

**Version: 0.1.0-alpha.4. Early development; not ready for production.**

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
- **Router guards.** Redirect signed-out users with a return URL, keep guarded
  pages in sync with the session, and re-run guards when auth changes.
- **Tokens stay out of reach.** Reactive state and sessions hold no tokens, so
  they are safe to render and to put in route context. Tokens go only to code
  that attaches them to requests, such as `createAuthFetch`.

## Installation

Alpha releases are published to the `latest` distribution tag:

```sh
pnpm add @monarcode/session-kit
```

Pin `@monarcode/session-kit@0.1.0-alpha.4` to use this exact version. Alpha
releases may change the public API; see the [release notes](./CHANGELOG.md).

All peer dependencies are optional, so install only what you use:

| Peer                     | Range                  | Needed for                                    |
| ------------------------ | ---------------------- | --------------------------------------------- |
| `react`                  | `^18.0.0 \|\| ^19.0.0` | `/react`, `/tanstack-router`, `/react-router` |
| `@tanstack/react-router` | `^1.132.0`             | `/tanstack-router`                            |
| `react-router`           | `^7.0.0 \|\| ^8.0.0`   | `/react-router`                               |

CI tests the oldest and newest versions in each range. session-kit never
imports React DOM. Any Standard Schema V1 library describes users; the
examples use Zod:

```sh
pnpm add react react-dom @tanstack/react-router zod
```

The package is ESM-only and checked with TypeScript 6.0.3 under NodeNext and
Bundler resolution. It needs `AbortController`, and uses `crypto.randomUUID` and
Web Locks when present, falling back without them.

## Quick start: TanStack Router

This example signs in against [DummyJSON's auth API](https://dummyjson.com/docs/auth),
a public test backend, so it runs as written. It is the
[`tanstack-router` example app](./examples/tanstack-router) trimmed to its
essentials. It uses file-based routing, so add the Router plugin before the
React plugin:

```ts
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

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
import type { AppAuth } from "../auth.js";
import { useAuth } from "../auth-hooks.js";

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
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { safeReturnTo } from "@monarcode/session-kit";
import { redirectIfSignedIn } from "@monarcode/session-kit/tanstack-router";
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
  createFileRoute,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import {
  requireSession,
  SessionOutlet,
} from "@monarcode/session-kit/tanstack-router";
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
import { createRouter } from "@tanstack/react-router";
import { connectAuth } from "@monarcode/session-kit/tanstack-router";
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
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router.js";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
```

## Other setups

The same client works everywhere; only the router wiring changes. Each setup has
a complete app in [`examples/`](./examples), all signing in against DummyJSON.

| Setup                                      | Example app                                                           | Guards                                                                     |
| ------------------------------------------ | --------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| TanStack Router                            | [`tanstack-router`](./examples/tanstack-router)                       | `requireSession` in `beforeLoad`, `SessionOutlet`                          |
| TanStack Start, SPA mode                   | [`tanstack-start-spa`](./examples/tanstack-start-spa)                 | Same as TanStack Router                                                    |
| React Router, declarative mode             | [`react-router-declarative`](./examples/react-router-declarative)     | `SessionOutlet` alone                                                      |
| React Router, data mode                    | [`react-router-data`](./examples/react-router-data)                   | `requireSession` in loaders, `SessionOutlet`, `useAuthRevalidation`        |
| React Router, framework mode, `ssr: false` | [`react-router-framework-spa`](./examples/react-router-framework-spa) | `requireSession` in `clientLoader`, `SessionOutlet`, `useAuthRevalidation` |

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

**Without a router.** `createAuthHooks<typeof auth>()` and `AuthProvider` work
in any React app.

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
| `unauthenticated` | No session; sign-in is needed.                                            | `null` |
| `unavailable`     | Restoring failed, or a failed refresh left no usable access; see `error`. | `null` |

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

Expiry comes from the first of these the tokens provide:

1. `expiresAt`: Unix time in milliseconds, compared with the browser clock.
2. `expiresIn`: lifetime in seconds, as in OAuth `expires_in`, counted from
   receipt.
3. A JWT's `exp - iat` lifetime, counted from receipt.
4. A JWT's `exp` alone, compared with the browser clock.

Browser clocks can be minutes off; options 2 and 3 are unaffected by that.
Opaque tokens without expiry are refreshed only after a 401.

### Storage

The required `storage` option chooses where the session is saved:

- `webStorage()` uses `localStorage`, shared by every tab.
- `webStorage({ area: "session" })` uses `sessionStorage`: one session per tab,
  ending with the tab.
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
spend the token; a short reuse window on the backend covers that.

### Errors

`state.error` and rejected promises carry an `AuthError` whose `code` is one of
`USER_VALIDATION_FAILED`, `INVALID_SESSION`, `PERSISTENCE_FAILED`,
`REFRESH_FAILED`, `REVOKE_FAILED`, `SESSION_CHANGED`, or `UNAUTHENTICATED`.
Validation errors include the schema's `issues`, and underlying failures appear
in `cause`. Work superseded by a newer sign-in or sign-out rejects with
`SESSION_CHANGED`.

If storage cannot be written, the session ends and the error is published. If
it cannot be cleared, sign-out still takes effect in this tab, but the promise
rejects and the error stays visible: retry `signOut()` once storage is
available, because undeleted credentials could survive a reload.

## Security notes

- Tokens and users are readable by same-origin JavaScript, as with any
  browser-stored credential. Your backend must authenticate every request and
  authorize private operations; route guards and local user fields do not.
- Tokens never go in cookies, so browsers do not send them automatically.
- Server rendering is not supported yet: sessions live in the browser. Never put
  tokens in loader results or hydrated page data.

## Entry points

| Import                                   | Exports                                                                                                   |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `@monarcode/session-kit`                 | `createAuth`, `fromAccessToken`, `webStorage`, `memoryStorage`, `safeReturnTo`, `AuthError`, types        |
| `@monarcode/session-kit/react`           | `createAuthHooks`, hook types                                                                             |
| `@monarcode/session-kit/tanstack-router` | `connectAuth`, `requireSession`, `redirectIfSignedIn`, `SessionOutlet`, `useRouterAuth`, `RegisteredAuth` |
| `@monarcode/session-kit/react-router`    | `SessionOutlet`, `requireSession`, `redirectIfSignedIn`, `useAuthRevalidation`                            |
| `@monarcode/session-kit/http`            | `createAuthFetch`                                                                                         |

Do not import internal `dist` paths.

## Development

Use Node.js 24 or newer and pnpm. The repository is a pnpm workspace: the
package at the root, and the example apps in `examples/`.

```sh
pnpm install
pnpm run check
```

`check` runs Oxlint and Oxfmt, builds the package, runs the tests, type-checks
the tests, the consumer declarations, and every TypeScript example in this
README marked with a `file:` comment, under NodeNext and Bundler resolution.
`pnpm test` runs the runtime tests twice: with synchronous storage, and with
storage that settles every operation late, removals last, to catch ordering
bugs. `pnpm run build:examples` builds the package and every example app.

Tests are TypeScript files that Node runs directly. Behavior tests are split by
area and share the browser mocks in `tests/helpers.ts`; React tests mount real
React DOM, TanStack Router, and React Router in jsdom. CI also runs the tests
and type tests against the oldest supported peers, and builds the examples.
Before each commit, Husky runs the lint and format checks. The manual alpha
release workflow is documented in [RELEASING.md](./RELEASING.md).

### Try a local build

Run `pnpm pack`, then install the tarball in your app, replacing `<version>`
with the version in `package.json`:

```sh
pnpm add /absolute/path/to/monarcode-session-kit-<version>.tgz
```
