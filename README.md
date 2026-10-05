# @monarcode/session-kit

Schema-driven browser authentication for React and TanStack Router.

**Version: 0.1.0-alpha.3. Early development; not ready for production.**

One auth client lives in Router context, and typed React hooks read it from
there, with no separate provider. Outside TanStack Router, the same hooks read
the client from an `AuthProvider`. Nano Stores makes its state reactive. Tokens
and the validated user profile are stored together in one entry.

## Installation

Alpha releases are published to the `latest` distribution tag:

```sh
pnpm add @monarcode/session-kit
```

Pin `@monarcode/session-kit@0.1.0-alpha.3` to use this exact version. Alpha
releases may change the public API. See [release notes](./CHANGELOG.md).

Both peer dependencies are optional, so install only what you use: React
`^18.0.0 || ^19.0.0` for `/react` and `/tanstack-router`, and TanStack React
Router `^1.127.0` for `/tanstack-router`. The package itself never imports
React DOM. CI checks both the oldest and the newest versions in those ranges.
This example uses Zod for its Standard Schema implementation:

```sh
pnpm add react@19.3.0 react-dom@19.3.0 @tanstack/react-router@1.170.38 zod@4.4.3
```

Zod is optional: any compatible Standard Schema V1 implementation can describe
users. The package is ESM-only and sets no Node.js engine requirement, though its
Nano Stores dependency declares Node.js 20 or 22 and newer for server-side
rendering and test runners. It is checked with
TypeScript 6.0.3 under NodeNext and Bundler resolution. Older TypeScript versions
have not been verified. Auth needs `AbortController`; it uses
`crypto.randomUUID` and Web Locks when present, and falls back without them.

### Migrating from @monarcode/tanstack-auth

Replace the dependency with `@monarcode/session-kit`, and
change import prefixes from `@monarcode/tanstack-auth` to
`@monarcode/session-kit`, then follow the breaking changes in the
[release notes](./CHANGELOG.md). TanStack Router is the supported router in
this alpha; additional adapters are planned for later development.

## Quick start

This example uses TanStack Router's file-based routing in a React browser app.
It assumes the app already has a `root` HTML element and the Router Vite plugin.
If file routing is not configured yet, add the plugin before the React plugin:

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
Keep that generated file in the Router import below, and never edit it by hand.

The example expects these same-origin backend endpoints. Supply them in your
application; the package does not implement a login server:

| Endpoint                 | Request                    | Successful response                                 |
| ------------------------ | -------------------------- | --------------------------------------------------- |
| `POST /api/auth/login`   | JSON `{ email, password }` | `{ accessToken, refreshToken?, expiresIn?, user }`  |
| `POST /api/auth/refresh` | JSON `{ refreshToken }`    | `{ accessToken, refreshToken?, expiresIn?, user? }` |

`expiresIn` is the access token lifetime in **seconds**, as in OAuth
`expires_in`. In this example, a refresh 401 means terminal rejection; other
failures are operational. Adapt that mapping to your backend's contract. See
[Refresh and errors](#refresh-and-errors) for other ways to supply expiry.

### 1. Define the user and client

`src/auth.ts`

<!-- file: src/auth.ts -->

```ts
import { z } from "zod";
import { createAuth, webStorage } from "@monarcode/session-kit";

export const userSchema = z.object({
  id: z.string(),
  email: z.string(),
});

const tokensSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).optional(),
  expiresIn: z.number().positive().optional(),
});
export const loginResponseSchema = tokensSchema.extend({ user: userSchema });
const refreshResponseSchema = tokensSchema.extend({
  user: userSchema.optional(),
});

export const auth = createAuth({
  name: "my-app",
  user: userSchema,
  storage: webStorage(),
  refresh: async ({ refreshToken, signal }) => {
    // Use plain fetch here to avoid recursive auth refresh.
    const response = await fetch("/api/auth/refresh", {
      method: "POST",
      signal,
      redirect: "error",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (response.status === 401) return null;
    if (!response.ok) throw new Error(`Refresh failed (${response.status})`);
    return refreshResponseSchema.parse(await response.json());
  },
});

export type AppAuth = typeof auth;
```

Create one active client per auth name in each tab. The `user` schema supplies
both runtime validation and inferred input/output types. Its output must be a
plain JSON object, saved beside the tokens and validated again when restored, so
the schema must accept its own output and return it unchanged. Sign-in rejects a
schema that does not, such as one with a one-way transform, instead of signing
users out on their next reload. Accepted user data is copied and frozen; use
`updateUser` to replace it.

If your backend puts the user in a JWT access token instead, read it from there.
`signIn` and the refresh callback then take tokens only, the user changes when
the token does, and there is no `updateUser`; call `auth.refresh()` to pick up a
changed user:

```ts
import {
  createAuth,
  fromAccessToken,
  webStorage,
} from "@monarcode/session-kit";

export const auth = createAuth({
  name: "my-app",
  user: fromAccessToken(
    z.object({ sub: z.string(), email: z.string() }),
    (claims) => ({ id: claims.sub, email: claims.email }),
  ),
  storage: webStorage(),
});

await auth.signIn({ accessToken, refreshToken });
```

The token is decoded without verifying its signature, which is fine in the
browser: a user object in a JSON response is trusted to the same degree. Leave
claims that change on every refresh, such as `exp` or `jti`, out of the user. OAuth
providers may change their access token format; this suits backends you control.

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

`useRouterAuth` reads the client from Router context, so these hooks need no
provider, and Router registration in step 7 gives them your user and client
types. `useAuth()` reads the full reactive snapshot; `useAuth(selector)`
subscribes to a selected value. `useAuthClient()` returns the stable client for
actions. Without TanStack Router, call `createAuthHooks<typeof auth>()` and
render the `AuthProvider` it returns around your app with `client={auth}`; the
provider also mounts the client, starting its timers and tab sync.

### 3. Type the root route

`src/routes/__root.tsx`

<!-- file: src/routes/__root.tsx -->

```tsx
import {
  createRootRouteWithContext,
  Outlet,
  useRouter,
} from "@tanstack/react-router";
import type { AppAuth } from "../auth.js";
import { useAuth, useAuthClient } from "../auth-hooks.js";

export const Route = createRootRouteWithContext<{ auth: AppAuth }>()({
  component: Root,
});

function Root() {
  const error = useAuth((state) => state.error);
  const auth = useAuthClient();
  const router = useRouter();

  return (
    <>
      {error && (
        <div role="alert">
          <p>{error.message}</p>
          {error.code === "PERSISTENCE_FAILED" && (
            <button
              onClick={() => {
                void auth
                  .signOut()
                  .then(() => router.invalidate())
                  .catch(() => {
                    // The failure stays in state.error for this banner.
                  });
              }}
            >
              Clear saved session again
            </button>
          )}
        </div>
      )}
      <Outlet />
    </>
  );
}
```

The root route defines the Router context shared by every generated file route.
Keeping the error banner above `Outlet` makes cleanup failures visible after a
protected route unmounts.

### 4. Add the login route

`src/routes/login.tsx`

<!-- file: src/routes/login.tsx -->

```tsx
import { useState, type FormEvent } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { safeReturnTo } from "@monarcode/session-kit";
import { redirectIfSignedIn } from "@monarcode/session-kit/tanstack-router";
import { loginResponseSchema } from "../auth.js";
import { useAuthClient } from "../auth-hooks.js";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    redirectTo: safeReturnTo(search.redirectTo),
  }),
  beforeLoad: ({ context, search }) =>
    redirectIfSignedIn(context.auth, { redirectTo: search.redirectTo }),
  component: Login,
});

function Login() {
  const auth = useAuthClient();
  const router = useRouter();
  const { redirectTo } = Route.useSearch();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        redirect: "error",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
        }),
      });
      if (!response.ok) throw new Error(`Sign-in failed (${response.status})`);
      await auth.signIn(loginResponseSchema.parse(await response.json()));
      await router.navigate({
        href: safeReturnTo(redirectTo),
        replace: true,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign in");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <h1>Sign in</h1>
      <label>
        Email{" "}
        <input name="email" type="email" autoComplete="username" required />
      </label>
      <label>
        Password{" "}
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
```

`safeReturnTo` accepts only same-origin paths and returns `/` for anything else,
including the sign-in page itself, so a stale `redirectTo` cannot loop. It
treats `/login`, `/login/`, and `/LOGIN` alike. If sign-in lives elsewhere, pass
its path, or several: `safeReturnTo(value, { loginPath: ["/sign-in", "/signup"] })`.
`redirectIfSignedIn` sends a signed-in user on to `redirectTo`, checked the same
way, and takes the same `loginPath` option.

### 5. Add a pathless protected layout

The leading underscore makes `_authenticated.tsx` a pathless layout. Its child
routes inherit the guard without adding `authenticated` to the URL.

`src/routes/_authenticated.tsx`

<!-- file: src/routes/_authenticated.tsx -->

```tsx
import {
  createFileRoute,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { AuthError } from "@monarcode/session-kit";
import {
  requireSession,
  SessionOutlet,
} from "@monarcode/session-kit/tanstack-router";
import { useAuth, useAuthClient } from "../auth-hooks.js";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: ({ context, location }) =>
    requireSession(context.auth, { location, loginPath: "/login" }),
  errorComponent: SessionError,
  component: () => <SessionOutlet pending={<p>Checking session…</p>} />,
});

function SessionError({ error }: ErrorComponentProps) {
  const auth = useAuthClient();
  const retrying = useAuth((state) => state.status === "refreshing");
  if (!(error instanceof AuthError) || error.code !== "REFRESH_FAILED") {
    return <p role="alert">Something went wrong.</p>;
  }
  return (
    <div role="alert">
      <p>We couldn't reach the sign-in service.</p>
      <button
        disabled={retrying}
        onClick={() => {
          // A repeated failure is also published to state.error.
          void auth.retry().catch(() => {});
        }}
      >
        {retrying ? "Retrying…" : "Retry"}
      </button>
    </div>
  );
}
```

`requireSession` redirects signed-out users to `loginPath` with `redirectTo`
set to where they were going, and puts `{ session }` in route context for child
routes: `session.user` is typed and never `null`, and a session holds no tokens.
If the session changes while it is checked, it checks again. A failed refresh
reaches the error component, whose Retry button calls `auth.retry()`.

`SessionOutlet` renders the child routes while the session the guard accepted
is still the signed-in one. After a sign-out or another account signing in, it
shows `pending` until the guard runs again, and it remounts child routes for a
new account, so nothing from the previous account stays on screen. Profile
updates and token refreshes keep child routes mounted.

### 6. Add a protected index route

Placing `index.tsx` inside the `_authenticated` directory makes `/` a child of
the protected layout. Add other private routes beside it, such as
`src/routes/_authenticated/settings.tsx`.

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
      <h1>Welcome, {user?.email}</h1>
      <button
        onClick={() =>
          void auth.signOut().catch(() => {
            // The root error banner displays persistence failures.
          })
        }
      >
        Sign out
      </button>
    </main>
  );
}
```

### 7. Create and connect the Router

`src/router.tsx`

<!-- file: src/router.tsx -->

```tsx
import { createRouter, useRouter } from "@tanstack/react-router";
import { connectAuth } from "@monarcode/session-kit/tanstack-router";
import { auth } from "./auth.js";
import { routeTree } from "./routeTree.gen.js";

export const router = createRouter({
  routeTree,
  context: { auth },
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
  defaultPendingComponent: () => <p>Loading…</p>,
  defaultErrorComponent: ({ error }) => <RouteError error={error} />,
});

function RouteError({ error }: { error: unknown }) {
  const router = useRouter();
  return (
    <div role="alert">
      <p>
        {error instanceof Error ? error.message : "Could not load this page"}
      </p>
      <button onClick={() => void router.invalidate().catch(console.error)}>
        Retry
      </button>
    </div>
  );
}

// Call once beside the stable Router, outside component rendering.
export const disconnectAuth = connectAuth(router);

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
```

`Register` gives `useRouterAuth`, and through it your hooks, the
application's user and client types. Keep it in the consuming app.

Outside React, `auth.state.get()` returns the current snapshot and
`auth.state.subscribe(listener)` reports later changes, not the current value; it
returns `{ unsubscribe }`. A listener that throws does not interrupt auth: its
error is rethrown asynchronously, where error reporting can capture it.
Checking `state.status` narrows `state.user`: it is set exactly while
`authenticated` or `refreshing`.

`auth.getSession()` resolves who is signed in, `{ sessionId, user }`, and never
holds tokens. Code that attaches tokens to requests uses `auth.credentials`:
`get()` resolves `{ sessionId, accessToken, expiresAt }`, `renew()` recovers
after a 401, and `reject()` ends a session the server keeps refusing.
`createAuthFetch` does this for you. `auth.refresh()` refreshes immediately,
even while the access token is usable.

`connectAuth` initializes auth, starts expiry timers, clears inactive Router
cache entries on guard-relevant changes, and queues Router revalidation. Call
`disconnectAuth` during app teardown or your bundler's hot-module disposal.
Disconnecting stops background work without signing out.

### 8. Render the app

`src/main.tsx`

<!-- file: src/main.tsx -->

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { router, disconnectAuth } from "./router.js";

const root = createRoot(document.getElementById("root")!);
root.render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

export function dispose() {
  root.unmount();
  disconnectAuth();
}
```

## Profile updates and authenticated requests

`updateUser` replaces the complete profile. For an asynchronous update, use its
callback form so a response from an old session cannot overwrite a new account.
This optional example assumes `PATCH /api/profile` returns the complete user:

<!-- file: src/profile.ts -->

```ts
import { createAuthFetch } from "@monarcode/session-kit/http";
import { auth, userSchema } from "./auth.js";

export async function updateEmail(email: string) {
  await auth.updateUser(async () => {
    const request = createAuthFetch(auth, `${location.origin}/api/`);
    const response = await request("profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!response.ok)
      throw new Error(`Profile update failed (${response.status})`);
    return userSchema.parse(await response.json());
  });
}
```

Handle the returned promise in your UI. Account switching uses `signIn`, which
creates a new session ID. A profile update keeps the current session ID.

`createAuthFetch` attaches a Bearer token, restricts requests to the configured
origin, and rejects redirects. On a 401 it attempts refresh. GET and HEAD are
replayed at most once; mutations are never automatically replayed. A second 401
ends only the matching session. If some endpoints answer 401 for reasons other
than a rejected token, pass `{ signOutOnRepeated401: false }` as the third
argument so they return the 401 without signing out. Network or refresh errors
reject the request.

## Refresh and errors

| Refresh callback outcome | Meaning                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------- |
| Return tokens            | Install validated tokens; omitted refresh token or user retains the current value. |
| Return `null`            | Terminal rejection: sign out and clear persistence.                                |
| Throw                    | Operational failure: retain recoverable credentials and expose the error.          |

A failed proactive refresh leaves access usable until its expiry. Expired or
explicitly rejected access is `refreshing` while a refresh runs: `user` stays
visible and guards wait for the outcome without re-running. A token-only refresh
does not change `version`.

If the refresh fails, access becomes `unavailable` and guards run once more.
Until `auth.retry()`, a sign-in, or a sign-out, `getSession()` rethrows that
`REFRESH_FAILED` error without contacting the backend, so the guard re-run cannot
start another refresh. Guards should let the error reach an error component
instead of turning it into a login redirect; the protected layout example offers
a Retry button that calls `auth.retry()`.

To treat every refresh failure as a sign-out instead, return `null` from the
refresh callback rather than throwing:

```ts
refresh: async ({ refreshToken, signal }) => {
  try {
    return await requestRefresh(refreshToken, signal);
  } catch {
    return null;
  }
},
```

Expiry comes from the first of these that the tokens provide:

1. `expiresAt`: Unix time in milliseconds, compared with the browser clock.
2. `expiresIn`: lifetime in seconds, counted from when auth receives the tokens.
3. A JWT's `exp - iat` lifetime, counted from receipt.
4. A JWT's `exp` alone, compared with the browser clock.

Browser clocks can be minutes off. Options 2 and 3 are unaffected; with 1 and 4,
a fast clock can make fresh tokens look expired and block sign-in. Options 2 and
3 assume newly issued tokens. `Credentials.expiresAt` is always on the browser
clock, and restored sessions keep their saved expiry. JWT decoding supplies only
a scheduling hint, without verifying signatures. Opaque tokens without expiry
cannot be proactively refreshed. While connected, refresh is scheduled at the
earlier of 60 seconds before expiry or halfway through the remaining lifetime.
There is one proactive attempt per installed token, with no recurring retry loop.
An attempt cancelled by unmounting or by a new sign-in does not count.
Validation and refresh work have a 15-second deadline.

| State status      | Meaning                                                                 |
| ----------------- | ----------------------------------------------------------------------- |
| `initializing`    | Restoration has not completed.                                          |
| `authenticated`   | Access is locally usable; `user` is available.                          |
| `refreshing`      | A refresh is replacing expired or rejected access; `user` is available. |
| `unauthenticated` | No session; sign-in is needed.                                          |
| `unavailable`     | Restoration failed or current credentials cannot supply usable access.  |

`state.error` is an `AuthError` or `null`; user data is hidden outside the
`authenticated` and `refreshing` states. Error codes are `USER_VALIDATION_FAILED`, `INVALID_SESSION`,
`PERSISTENCE_FAILED`, `REFRESH_FAILED`, `REVOKE_FAILED`, `SESSION_CHANGED`, and
`UNAUTHENTICATED`.
Validation errors can include `issues`; underlying failures can appear in `cause`.
Application callbacks can also throw ordinary errors.

A storage write failure clears the in-memory session and attempts cleanup.
Sign-out takes effect in the current tab even if storage deletion fails; its
promise rejects and the error remains visible. Retry `signOut()` after storage
becomes available, because undeleted credentials can survive a reload.
If restoration rejects saved data and cleanup fails, `getSession()` rejects
with `PERSISTENCE_FAILED` and `state.error` exposes the same error. Its `cause`
retains both the restoration and cleanup failures. Retry `signOut()` to clear
the remaining data after storage becomes available.

## Storage and limits

- Tokens and the profile share one `<name>:auth:session` entry, so every save
  is a single write that other tabs see whole. A user read from the access token
  is not saved; restoring reads it again. Sessions saved by earlier alphas are
  removed, not restored; users sign in once after upgrading. Tokens are never
  placed in cookies, so the browser does not send them automatically;
  `createAuthFetch` attaches the access token explicitly.
- The required `storage` option chooses where that entry lives.
  `webStorage()` uses `localStorage`; `webStorage({ area: "session" })` keeps
  a separate session per tab in `sessionStorage`, ending with the tab; and
  `memoryStorage()` never persists it. Any object implementing `AuthStorage`
  works, including storage whose operations return promises: auth applies
  them one at a time, in the order it issued them.
- `maxAge` is in seconds, defaults to 30 days, and renews on successful writes.
  Expired entries are removed on the next restoration. It does not extend backend
  token validity. A full storage quota fails visibly with `PERSISTENCE_FAILED`.
- Tokens and profiles are readable by same-origin JavaScript. The backend must
  independently authenticate requests and authorize private operations. Local
  profile fields and route guards do not establish server authorization.
- Sign-out clears local credentials, then calls the optional `revoke` callback
  with the ended tokens so your backend can revoke them. A failed revocation
  does not undo the sign-out: `signOut()` still resolves and `state.error`
  reports `REVOKE_FAILED`. Sessions the backend already rejected are not revoked.
- Tabs coordinate refresh through the `<name>:auth:refresh` Web Lock: one tab at
  a time spends the refresh token, and a tab that needs a refresh first uses
  tokens another tab already saved. Rotating refresh tokens therefore work with
  several tabs open. Profile updates keep tokens another tab refreshed, and a
  refresh or rejection never overwrites or clears an account another tab signed
  in; this tab switches to whatever storage holds instead.
- Browsers without Web Locks still check storage before refreshing and before
  signing out, but two tabs refreshing at the same instant can both spend the
  token. A short refresh-token reuse window on the backend covers that case and
  a refresh response lost to a timeout.
- While connected through `connectAuth`, tabs update each other live through
  `storage` events. A sign-out in one tab signs out the others, a sign-in or
  account switch switches them (with a new `sessionId`), and profile updates
  appear everywhere. Each of these changes `version` once, so guards rerun.
  A refresh elsewhere replaces this tab's tokens without changing `version`,
  and clears a refresh failure this tab was showing. An account change cancels
  this tab's pending auth work with `SESSION_CHANGED`. A user another tab saved
  that this tab's schema rejects signs every tab out with
  `USER_VALIDATION_FAILED`, as restoring it would. Scope private Query data
  to `sessionId`, so another tab's account switch cannot show the old account's
  data.
- Query cache management belongs to your app. Scope private data to the sign-in
  session ID, and reject late results from an old session. Router revalidation
  does not clear a separate TanStack Query cache.
- SSR and TanStack Start are not implemented. Import safety does not make the
  browser client a server session adapter. Start needs a separate request-scoped
  design. Never put tokens in route loader results or hydrated page data.

## Entry points

| Import                                   | Exports                                                                                                        |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `@monarcode/session-kit`                 | `createAuth`, `fromAccessToken`, `webStorage`, `memoryStorage`, `safeReturnTo`, `AuthError`, public auth types |
| `@monarcode/session-kit/react`           | `createAuthHooks` and hook types                                                                               |
| `@monarcode/session-kit/tanstack-router` | `connectAuth`, `requireSession`, `redirectIfSignedIn`, `SessionOutlet`, `useRouterAuth`, `RegisteredAuth`      |
| `@monarcode/session-kit/http`            | `createAuthFetch`                                                                                              |

Generated declarations retain schema inference and consumer Router registration.
Declaration maps are disabled so declaration navigation targets installed `.d.ts`
files. Do not import internal `dist` paths.

## Development

Use Node.js 24 or newer and pnpm. `devEngines` enforces the Node.js version for
contributors only; it does not affect installing the package:

```sh
pnpm install
pnpm run check
```

`check` runs Oxlint and Oxfmt checks, builds the package, runs the auth behavior,
React hook, package smoke, and release validation tests, then type-checks the
tests, consumer declarations, and every marked TypeScript example in this README
under NodeNext and Bundler resolution. The docs
checker supplies the generated route tree that a consumer's Router plugin owns.
After building, `pnpm test` runs the runtime tests twice: `test:sync` with the
default storage, and `test:async` with storage that settles every operation
late, removals last. `pnpm run test:docs` checks
README examples alone. The documentation checker extracts the examples into a
temporary project; it does not execute them or contact the example backend.

`pnpm install` activates Husky locally. Before each commit, the hook runs
`pnpm run lint` and `pnpm run format:check` across the repository. These checks
do not modify files; lint errors or formatting differences block the commit,
while lint warnings remain non-blocking. Run `pnpm run lint:fix` to apply safe
lint fixes and `pnpm run format` to format eligible files. Both tools exclude
generated files and build output using their committed configs.
CI and release workflows disable Husky and enforce these checks through
`pnpm run check`.

Tests are TypeScript files that Node runs directly, without a build step. Behavior
tests are split by area (sessions, storage, refresh, expiry, Router, HTTP,
return URLs, and tabs) and share the browser mocks in `tests/helpers.ts`. They use mocked
storage, HTTP, and timers, plus a real Router with memory history. The
`development` condition enables its client redirect test.
Hook tests mount React DOM in jsdom, including StrictMode subscription cleanup.
These tests do not cover a live backend or a real browser. `pnpm pack` runs the
package checks before creating a local tarball; it does not publish to npm.
GitHub Actions installs from the frozen pnpm lockfile, runs the same checks, and
creates a local tarball in the runner's temporary directory on pushes to `main`
and pull requests. The CI workflow does not publish or create a release.
The separate manual alpha release workflow is documented in
[RELEASING.md](https://github.com/monarcode/session-kit/blob/main/RELEASING.md).

### Try a local build

Run `pnpm pack` in this repository, then install the resulting tarball in your
app. Replace `<version>` with the version in `package.json`:

```sh
pnpm add /absolute/path/to/monarcode-session-kit-<version>.tgz
```
