# Effect

`@monarcode/session-kit/effect` gives [Effect](https://effect.website) code
the session as a service. Each Effect fails with a tagged `AuthFailure`, so
`Effect.catchTag` handles auth errors as it handles your own. The service
wraps the client you already have: React, the routers and Effect code share
one session.

Read the [README](../README.md) first for how the client, refresh, and errors
work; this guide covers what Effect adds.

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
import * as Layer from "effect/Layer";

import { AuthLive } from "./layer.js";

const baseUrl = "https://api.example.com";

const makeApi = Fetch.make({
  baseUrl,
  plugins: [retry(), sessionBearer({ baseUrl })],
});

// Made once, when the layer is built.
export class Api extends Context.Service<Api, Effect.Success<typeof makeApi>>()(
  "app/Api",
) {
  static readonly layer = Layer.effect(Api, makeApi).pipe(
    Layer.provide(Layer.merge(FetchHttpClient.layer, AuthLive)),
  );
}

export const orders = Api.use((api) => api.get("/orders"));
```

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

import { Api } from "./api.js";
import { auth } from "./auth.js";

declare module "@monarcode/effetch-query" {
  interface Register {
    readonly services: Api;
  }
}

const { useAuth } = createAuthHooks<typeof auth>();

export function Queries({ children }: { children: ReactNode }) {
  const account = useAuth((state) => state.sessionId ?? "signed-out");
  return (
    <QueryProvider
      make={() => QueryClient.make({ layer: Api.layer })}
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
README describes.

## What stays on the client

`Auth` covers what Effect code does with a session: reading it, signing in
and out, and updating the user. Everything else stays on the client, which
React and the routers already drive: `lock` and `unlock`, `refresh` and
`retry`, `mount`, and the client's options.
