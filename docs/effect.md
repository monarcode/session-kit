# Effect

`@monarcode/session-kit/effect` gives [Effect](https://effect.website) code
the session as a service. Each Effect fails with a tagged `AuthFailure`, so
`Effect.catchTag` handles auth errors as it handles your own. The service
wraps the client you already have: React, the routers and Effect code share
one session.

Read the [README](../README.md) first for how the client, refresh, and errors
work; this guide covers what Effect adds. A complete app is in
[`examples/tanstack-start-spa-effetch`](../examples/tanstack-start-spa-effetch).

## Contents

- [Installation](#installation)
- [1. Register the client](#1-register-the-client)
- [2. Provide the service](#2-provide-the-service)
- [3. Read the session](#3-read-the-session)
- [Handling failures](#handling-failures)
- [Requests with effetch](#requests-with-effetch)
- [Updating the user](#updating-the-user)
- [Watching the session](#watching-the-session)
- [Caching with effetch-query](#caching-with-effetch-query)
- [On the server](#on-the-server)
- [What stays on the client](#what-stays-on-the-client)

## Installation

Install `effect` 4.1 or newer beside the package. It's an optional peer
dependency, needed only for this entry point and `./effetch`:

```sh
pnpm add @monarcode/session-kit effect zod
```

## 1. Register the client

Create the client as usual, then register its type once, so every Effect
carries your user:

<!-- file: src/auth.ts -->

```ts
import { createAuth, webStorage } from "@monarcode/session-kit";
import { z } from "zod";

export const userSchema = z.object({
  id: z.number(),
  firstName: z.string(),
});

export const auth = createAuth({
  name: "app",
  user: userSchema,
  storage: webStorage(),
});

declare module "@monarcode/session-kit/effect" {
  interface Register {
    auth: typeof auth;
  }
}
```

## 2. Provide the service

`Auth.layer` provides the client as the `Auth` service. It doesn't mount the
client: `AuthProvider`, `SessionGate` or the router adapters do that, as
before. Tests can provide another client instead.

<!-- file: src/layer.ts -->

```ts
import { Auth } from "@monarcode/session-kit/effect";

import { auth } from "./auth.js";

export const AuthLive = Auth.layer(auth);
```

## 3. Read the session

`Auth.session` is the current session, refreshing expired access first. It
fails with `UNAUTHENTICATED` when signed out; `Auth.sessionOption` gives
`Option.none()` instead, for code where that's expected:

<!-- file: src/greeting.ts -->

```ts
import { Auth } from "@monarcode/session-kit/effect";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { AuthLive } from "./layer.js";

export const greeting = Auth.sessionOption.pipe(
  Effect.map(
    Option.match({
      onNone: () => "Welcome",
      onSome: (session) => `Welcome back, ${session.user.firstName}`,
    }),
  ),
);

export const showGreeting = () =>
  Effect.runPromise(Effect.provide(greeting, AuthLive));
```

## Handling failures

Every `Auth` Effect fails with `AuthFailure`. Its `code` is the client's
`AuthErrorCode`, and its `cause` the `AuthError` itself. Misuse, which the
client reports as `INVALID_OPTIONS`, is a defect rather than a failure.

<!-- file: src/account.ts -->

```ts
import { Auth } from "@monarcode/session-kit/effect";
import * as Effect from "effect/Effect";

export const accountName = Auth.session.pipe(
  Effect.map((session) => session.user.firstName),
  Effect.catchTag("AuthFailure", (failure) =>
    failure.code === "UNAUTHENTICATED"
      ? Effect.succeed("Guest")
      : Effect.fail(failure),
  ),
);
```

Code outside `Auth` that rejects with an `AuthError`, such as
`createAuthFetch`, converts it with `Auth.fromAuthError`.

## Requests with effetch

With [effetch](https://github.com/monarcode/effetch), the `sessionBearer`
plugin from `@monarcode/session-kit/effetch` sends the access token and
handles a 401 as `createAuthFetch` does. Install `@monarcode/effetch` too,
another optional peer dependency. Put the plugin last, so a retry reads the
current token, and give it the client's `baseUrl`: the token goes only to
that origin. `Fetch.make` then needs the `Auth` service, once:

<!-- file: src/api.ts -->

```ts
import * as Fetch from "@monarcode/effetch";
import { retry } from "@monarcode/effetch/plugins";
import { sessionBearer } from "@monarcode/session-kit/effetch";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as Layer from "effect/Layer";

import { AuthLive } from "./layer.js";

const baseUrl = "https://api.example.com";

const make = Fetch.make({
  baseUrl,
  plugins: [retry(), sessionBearer({ baseUrl })],
});

export class ApiClient extends Context.Service<
  ApiClient,
  Effect.Success<typeof make>
>()("ApiClient") {}

// `fetch`, without the tracing headers Effect adds to every request: from a
// browser, they fail the preflight of an API that doesn't allow them.
const FetchLive = Layer.merge(
  FetchHttpClient.layer,
  Layer.succeed(HttpClient.TracerPropagationEnabled, false),
);

/** The API client, over whichever `Auth` is provided. */
export const ApiClientLive = Layer.effect(ApiClient, make);

/** The app's services: the API client, made once, and the session it uses. */
export const AppLayer = ApiClientLive.pipe(
  Layer.provideMerge(AuthLive),
  Layer.provide(FetchLive),
);

export const orders = Effect.gen(function* () {
  const api = yield* ApiClient;
  return yield* api.get("/orders");
});
```

The README's [Effect and effetch](../README.md#effect-and-effetch) section
lays a whole app out this way: the session, the API client, one runtime, and
effetch-query.

Calls can fail with `AuthFailure`, and skip the plugin with
`plugins: { sessionBearer: false }`, for a public endpoint such as the sign-in
request. When one client serves public and private endpoints, give the
plugin `optional: true`: a call made while signed out is then sent without a
token, and a private endpoint answers with its own 401. A locked client still
fails with `LOCKED`.

With another HTTP client, use `Auth.credentials`, the access token, kept apart
from `Auth.session` so code that only needs the user never holds a token.
After a 401, `Auth.renew(credentials)` gets new credentials once for every
caller.

## Updating the user

`Auth.updateUser` takes the user, or an Effect that fetches it. The session is
captured before the Effect runs, so a profile fetched for one account fails
with `SESSION_CHANGED` instead of landing on another. The Effect's own
failure comes through unchanged:

<!-- file: src/profile.ts -->

```ts
import { Auth } from "@monarcode/session-kit/effect";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

import { userSchema } from "./auth.js";

class ProfileUnavailable extends Data.TaggedError("ProfileUnavailable") {}

declare const fetchProfile: Effect.Effect<unknown, ProfileUnavailable>;

export const reloadProfile = Auth.updateUser(
  Effect.map(fetchProfile, (body) => userSchema.parse(body)),
);
```

## Watching the session

`Auth.changes` is a `Stream` of the client's `AuthState`: the current state,
then every change, until the stream ends:

<!-- file: src/watch.ts -->

```ts
import { Auth } from "@monarcode/session-kit/effect";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

export const logStatus = Auth.changes.pipe(
  Stream.map((state) => state.status),
  Stream.changes,
  Stream.runForEach((status) => Effect.log(`Auth is ${status}`)),
);
```

## Caching with effetch-query

With [effetch-query](https://github.com/monarcode/effetch-query) 0.1.0-rc.2
or newer (and its `@effect/atom-react` peer for React), a cache must not
outlive the account that filled it. Let `QueryProvider` own its
client (`make` instead of `client`) and pass the session ID as `resetKey`:
signing out or switching accounts then disposes the client, with its cache
and its requests in flight, and renders the tree with a new one.

<!-- file: src/queries.tsx -->

```tsx
import type { ReactNode } from "react";

import { QueryClient } from "@monarcode/effetch-query";
import { QueryProvider } from "@monarcode/effetch-query/react";
import { createAuthHooks } from "@monarcode/session-kit/react";

import { type ApiClient, AppLayer } from "./api.js";
import { auth } from "./auth.js";

declare module "@monarcode/effetch-query" {
  interface Register {
    readonly services: ApiClient;
  }
}

const { useAuth } = createAuthHooks<typeof auth>();

export function Queries({ children }: { children: ReactNode }) {
  const account = useAuth((state) => state.sessionId ?? "signed-out");
  return (
    <QueryProvider
      make={() => QueryClient.make({ layer: AppLayer })}
      resetKey={account}
    >
      {children}
    </QueryProvider>
  );
}
```

Render it inside `AuthProvider` or `SessionGate`, above every `Suspense`
boundary. A refresh, a failed refresh or a profile update keeps the
`sessionId`, and so the cache. So does locking: queries that need a token
fail with `LOCKED` until `unlock()`, then refetch as usual. Until a saved
session is restored, the key is `"signed-out"`, and the restore replaces
that client.

The owned form is for the browser and React Native. With server rendering,
give `QueryProvider` a `client` per request instead, as effetch-query's
README describes, made on the server over that request's session
([Queries on the server](#queries-on-the-server)).

## On the server

With server rendering, server functions, actions and route handlers run
Effects too, and the session they read is the cookie the server keeps
([Server sessions](./server-sessions.md)). `serverAuth.forRequest(jar)` is
one request's session, and `Auth.layer` takes it, so `Auth.session`,
`Auth.credentials` and `sessionBearer` work there: `sessionBearer` sends the
cookie's token, and saves a renewed one after a 401.

The engine is `createServerAuth`, with the user schema the app registers.
These files build on the guide's `userSchema` and `ApiClientLive`; in a
server-rendered app, the registered client is the browser's
`createMirrorAuth` one, set up as each framework's guide shows
([TanStack Start](./tanstack-start.md), [Next.js](./next.md),
[React Router](./react-router-ssr.md)), not `createAuth`.

<!-- file: src/server/auth.ts -->

```ts
import { createServerAuth } from "@monarcode/session-kit/server";

import { userSchema } from "../auth.js";

declare const secret: string; // from the environment

export const serverAuth = createServerAuth({
  name: "app",
  user: userSchema,
  secret,
  refresh: async ({ refreshToken, signal }) => {
    const response = await fetch("https://api.example.com/auth/refresh", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (response.status === 401) return null;
    if (!response.ok) throw new Error(`Refresh failed (${response.status})`);
    return response.json();
  },
});
```

A request's session belongs to that request, and so does everything that
uses it. Build those per request, and keep a runtime for what belongs to no
user:

<!-- file: src/server/run.ts -->

```ts
import { Auth } from "@monarcode/session-kit/effect";
import type { CookieJar } from "@monarcode/session-kit/server";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import { type ApiClient, ApiClientLive } from "../api.js";
import { serverAuth } from "./auth.js";

/** Built once: what belongs to no user. */
const serverRuntime = ManagedRuntime.make(FetchHttpClient.layer);

/** Built per request: its session, and the services that use it. */
export const requestLayer = (jar: CookieJar) =>
  ApiClientLive.pipe(
    Layer.provideMerge(Auth.layer(serverAuth.forRequest(jar))),
  );

/** Runs `effect` with the session of the request `jar` belongs to. */
export function runRequest<A, E>(
  jar: CookieJar,
  effect: Effect.Effect<A, E, ApiClient | Auth>,
): Promise<A> {
  return serverRuntime.runPromise(Effect.provide(effect, requestLayer(jar)));
}
```

The runtime has no `Auth` and no `ApiClient`, so an Effect that needs them
doesn't compile until it goes through `runRequest`, and nothing a service
keeps outlives its request. Building them costs microseconds, next to the
request your API answers.

Each framework's adapter gives the jar, in the server function, action or
handler:

<!-- file: src/server/orders.ts -->

```ts
import type { CookieJar } from "@monarcode/session-kit/server";

import { orders } from "../api.js";
import { runRequest } from "./run.js";

// TanStack Start: startJar(). Next.js: nextJar(await cookies(), { writable: true }).
// React Router: routerJar(context).
export const ordersFor = (jar: CookieJar) => runRequest(jar, orders);
```

### Signing in on the server

`Auth.signIn` and `Auth.updateUser` aren't available on a request's session:
the user comes in through `serverAuth`. Ask your backend with an Effect, then
seal what it returns:

<!-- file: src/server/sign-in.ts -->

```ts
import type { CookieJar } from "@monarcode/session-kit/server";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { ApiClient } from "../api.js";
import { serverAuth } from "./auth.js";
import { runRequest } from "./run.js";

const login = (username: string, password: string) =>
  Effect.gen(function* () {
    const api = yield* ApiClient;
    return yield* api.post("/auth/login", {
      body: { username, password },
      output: Schema.Struct({
        accessToken: Schema.String,
        refreshToken: Schema.String,
        id: Schema.Finite,
        firstName: Schema.String,
      }),
      plugins: { sessionBearer: false },
    });
  });

export async function signIn(
  jar: CookieJar,
  username: string,
  password: string,
) {
  const { accessToken, refreshToken, ...user } = await runRequest(
    jar,
    login(username, password),
  );
  return serverAuth.signIn(jar, { accessToken, refreshToken, user });
}
```

### Queries on the server

To render a page with its data, make a query cache per request, on the
server, over that request's layer, and dispose of it once the page is sent:

<!-- file: src/server/query-client.ts -->

```ts
import { QueryClient } from "@monarcode/effetch-query";
import type { CookieJar } from "@monarcode/session-kit/server";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";

import { requestLayer } from "./run.js";

export const queryClientFor = (jar: CookieJar) =>
  QueryClient.make({
    layer: requestLayer(jar).pipe(Layer.provide(FetchHttpClient.layer)),
  });
```

Give it no `memoMap`: see below. Prefetch before the page starts streaming,
or refresh in middleware first, since a cookie set once streaming has begun
is lost. In the browser, the cache is the owned one above, over the mirror
client.

### Things to know

- **One registration.** An app with server rendering registers its mirror
  client, and that registration types `Auth` on the server too: `Auth.layer`
  takes a request's session whose user is the registered one. In the
  browser, the mirror is `Auth`; `sessionBearer` needs its `credentials`
  option there.
- **Name the services in `runRequest`'s signature,** as above, rather than
  inferring them from `requestLayer`. With a mirror registered, the
  registration depends on the server functions the mirror calls, which call
  `runRequest`, and TypeScript reports a circular type. For the same reason,
  the server functions the mirror is made from (its `revalidate`, `signIn`
  and `signOut`) read the session with `serverAuth`, not `Auth.session`.
- **Keep a request's layer off a shared `memoMap`,** such as the runtime's
  or one passed to `QueryClient.make`. Layers are shared by identity there,
  so overlapping requests can get one build: a service that keeps `Auth`
  when it's built would then serve one request's session to another.
- **Read-only jars,** such as a Next.js Server Component's: `Auth.session`
  returns the cookie's session as it is, while `Auth.credentials` and
  `sessionBearer` fail with `REFRESH_FAILED` once access has expired, and
  after a 401, which can't be renewed there. Refresh in middleware or a
  proxy first, with `serverAuth.refreshIfDue`, as the framework guides do.
  Sign out in an action or route handler.
- **Only `Auth`'s Effects,** as `Auth.layer` says.

## What stays on the client

`Auth` covers what Effect code does with a session: reading it, signing in
and out, and updating the user. Everything else stays on the client, which
React and the routers already drive: `lock` and `unlock`, `refresh` and
`retry`, `mount`, and the client's options. On the server, signing in and
updating the user are `serverAuth`'s.
