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
- [Requests with credentials](#requests-with-credentials)
- [Updating the user](#updating-the-user)
- [Watching the session](#watching-the-session)
- [What stays on the client](#what-stays-on-the-client)

## Installation

Install `effect` 4.1 or newer beside the package. It's an optional peer
dependency, needed only for this entry point:

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
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Auth } from "@monarcode/session-kit/effect";
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
import * as Effect from "effect/Effect";
import { Auth } from "@monarcode/session-kit/effect";

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

## Requests with credentials

`Auth.credentials` is the access token, kept apart from `Auth.session` so code
that only needs the user never holds a token. After a 401, `Auth.renew` gets
new credentials once for every caller; it fails with `UNAUTHENTICATED` when
that ended the session:

<!-- file: src/orders.ts -->

```ts
import * as Effect from "effect/Effect";
import type { Credentials } from "@monarcode/session-kit";
import { Auth } from "@monarcode/session-kit/effect";

const get = (credentials: Credentials) =>
  Effect.tryPromise((signal) =>
    fetch("https://api.example.com/orders", {
      headers: { Authorization: `Bearer ${credentials.accessToken}` },
      signal,
    }),
  );

export const orders = Effect.gen(function* () {
  const credentials = yield* Auth.credentials;
  const response = yield* get(credentials);
  if (response.status !== 401) return response;
  return yield* get(yield* Auth.renew(credentials));
});
```

Unlike `createAuthFetch`, this doesn't check the origin, refuse a response
for a session that changed during the call, or sign out after a second 401.

## Updating the user

`Auth.updateUser` takes the user, or an Effect that fetches it. The session is
captured before the Effect runs, so a profile fetched for one account fails
with `SESSION_CHANGED` instead of landing on another. The Effect's own
failure comes through unchanged:

<!-- file: src/profile.ts -->

```ts
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { Auth } from "@monarcode/session-kit/effect";
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
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { Auth } from "@monarcode/session-kit/effect";

export const logStatus = Auth.changes.pipe(
  Stream.map((state) => state.status),
  Stream.changes,
  Stream.runForEach((status) => Effect.log(`Auth is ${status}`)),
);
```

## What stays on the client

`Auth` covers what Effect code does with a session: reading it, signing in
and out, and updating the user. Everything else stays on the client, which
React and the routers already drive: `lock` and `unlock`, `refresh` and
`retry`, `mount`, and the client's options.
