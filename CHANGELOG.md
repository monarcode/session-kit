# Changelog

## 0.1.0-alpha.4

### Added

- `createAuth` takes a `storage` adapter. `webStorage()` saves the session in
  `localStorage`; `webStorage({ area: "session" })` uses `sessionStorage`, so
  each tab has its own session that ends with the tab. `memoryStorage()` keeps
  the session in memory only. Custom storage implements the new `AuthStorage`
  type, and its operations may return promises.
- Auth applies storage operations one at a time, in the order it issued them,
  and re-checks its own session after every read. Storage that settles late or
  out of order cannot erase a newer sign-in, and a profile update cannot
  restore tokens this tab refreshed meanwhile.
- `fromAccessToken(claims, map?)` reads the user from a JWT access token. Its
  claims are validated by a Standard Schema and `map` turns them into the user.
  `signIn` and the refresh callback then take tokens only, the user is not
  saved, and it changes whenever the token does. A `decode` option replaces the
  default, which decodes the JWT without verifying its signature.
- `auth.refresh()` refreshes immediately, even while the access token is still
  usable, for example to pick up a changed user.
- An optional `revoke` callback receives the ended tokens after `signOut()`
  clears the session. A failed revocation does not undo the sign-out; it is
  published as the new `REVOKE_FAILED` error code.
- Checking `state.status` narrows `state.user`: `AuthState` is now a
  discriminated union in which `user` is set exactly while `authenticated` or
  `refreshing`.
- Session IDs no longer require `crypto.randomUUID`, and user validation no
  longer requires `structuredClone`, for environments such as React Native.
- A new `/tanstack-router` entry point holds the Router integration:
  `connectAuth`, plus guards that replace the protected-layout code apps used
  to copy. `requireSession` redirects signed-out users with a `redirectTo`
  search param and puts `{ session }` in route context; `SessionOutlet` renders
  child routes only while that session is current, remounting them for a new
  account; `redirectIfSignedIn` sends signed-in users away from the sign-in
  page; `useRouterAuth` reads the client from Router context.
- React 18 is supported (`^18.0.0 || ^19.0.0`). CI tests React 18.0.0 as the
  oldest version.
- A new `/react-router` entry point supports React Router 7 and 8 in
  declarative mode, data mode, and framework mode with `ssr: false`.
  `SessionOutlet` guards routes in declarative mode, showing `pending` while
  restoring, sending signed-out users to `loginPath` with `redirectTo`, and
  offering a retry through `unavailable` after a failed refresh. In data mode,
  `requireSession` and `redirectIfSignedIn` guard loaders, and
  `useAuthRevalidation` re-runs loaders when auth changes. React Router is an
  optional peer dependency.
- TanStack Start in SPA mode is supported. `connectAuth` does nothing while
  the Router renders on a server, so Start's build-time shell shows the pending
  UI instead of a storage error. Apps served by Start's own server should set
  `defaultSsr: false`, so guards run in the browser.
- `webStorage()` explains when browser storage does not exist at all, as on a
  server, instead of reporting a bare `TypeError`.
- Mounting restores the saved session at once when storage and the user
  source both answer synchronously, as with `webStorage()` and a synchronous
  schema, so `initializing` is never rendered. `AuthProvider` mounts in a
  layout effect, before the browser paints. Asynchronous storage, schemas, or
  token decoding restore as before.

### Changed

- **Breaking:** `createAuth` takes the user schema as `user` instead of
  `userSchema`, and `storage` is required. Pass `storage: webStorage()` to keep
  the previous behavior.
- **Breaking:** `getSession()` and `retry()` resolve `{ sessionId, user }`
  without tokens, so a session is safe in route context. Access tokens come
  from `auth.credentials.get()`, which resolves
  `{ sessionId, accessToken, expiresAt }`. `auth.refresh(session)` is now
  `auth.credentials.renew(credentials)`, `auth.rejectSession(session)` is now
  `auth.credentials.reject(credentials)`, and `isCurrent` takes any object
  with a `sessionId`.
- **Breaking:** `createRefreshFn` is removed. Pass the refresh callback inline,
  or type a standalone one with `RefreshFn<UserInput<typeof schema>>`.
- **Breaking:** `AuthClient` takes the user type first: `AuthClient<User, Input>`.
- **Breaking:** `/react` no longer depends on TanStack Router and exports only
  `createAuthHooks`, which returns `useAuth`, `useAuthClient`, and an
  `AuthProvider` typed for one client. With TanStack Router, keep the
  provider-free setup with
  `createAuthHooks({ useClient: useRouterAuth })`; elsewhere, render
  `AuthProvider`, which also mounts the client. `connectAuth` moved to
  `/tanstack-router`, and `safeReturnTo` to the package root.
- **Breaking:** both peer dependencies are optional, and React DOM is no longer
  one. Install TanStack Router only for `/tanstack-router`, and React only for
  the React entry points.
- **Breaking:** sign-in, `updateUser`, and a refresh that returns a user reject
  with `USER_VALIDATION_FAILED` when the user schema does not accept its own
  output unchanged. Such a schema used to pass sign-in, then fail restoration
  and sign users out on their next reload.
- **Breaking:** sessions are saved in a new format. Sessions saved by earlier
  alphas, including the two-key format of 0.1.0-alpha.1, are not restored, so
  users sign in once after upgrading.
- A refresh that returns a user equal to the current one keeps the same user
  object and does not change `version`, so guards do not run again.

## 0.1.0-alpha.3

### Added

- `AuthStatus` names the union of `AuthState.status` values, for helpers and
  exhaustive `switch` statements.

### Changed

- Reactive state uses Nano Stores instead of TanStack Store. Apps on Router
  versions that depend on an older TanStack Store no longer bundle two copies.
- **Breaking:** `AuthClient.state` is typed by this package rather than
  `@tanstack/store`. `state.subscribe` takes a listener function; observer
  objects (`{ next, error, complete }`) are no longer accepted.
- **Breaking:** the `AuthError` constructor takes schema `issues` in its options
  object, `new AuthError(code, message, { cause, issues })`, instead of as a
  fourth argument. The new `AuthErrorOptions` type describes those options.

### Fixed

- A `state.subscribe` listener that throws no longer makes `signIn` (or another
  operation) reject after it succeeded, or stops later listeners, including
  `useAuth` and `connectAuth`, from seeing the change. The error is rethrown
  asynchronously instead.
- When another tab saves a user that this tab's schema rejects, for example
  while two deploys are open, this tab no longer keeps the old profile with no
  error. It signs every tab out with `USER_VALIDATION_FAILED`, as restoring
  that session would.

## 0.1.0-alpha.2

### Changed

- **Breaking:** `AuthState.status` adds `"refreshing"`. Exhaustive `switch`
  statements over `status` need a case for it.
- While a refresh replaces expired or rejected access (after a 401, at expiry,
  or when restoring an expired saved session), `status` is `"refreshing"` and
  `user` stays visible. Previously the state passed through `"unavailable"` with
  `user: null`, so the UI briefly looked signed out.
- A refresh that only replaces the token no longer changes `version`, so
  `connectAuth` no longer invalidates the router twice per 401. A failed refresh,
  a terminal rejection, or a changed user still changes `version` once.
- **Breaking:** after a failed refresh, `getSession()` rethrows that
  `REFRESH_FAILED` error instead of starting another refresh. It keeps doing so
  until `auth.retry()`, a sign-in, or a sign-out. This prevents a loop where each
  failure re-ran Router guards and each guard started a new refresh.

- **Breaking:** a JWT with both `iat` and `exp`, and no explicit expiry, now
  expires `exp - iat` seconds after auth receives it, instead of at absolute
  `exp`. A browser clock that runs ahead of the server no longer makes fresh
  tokens look expired and block sign-in. A JWT without `iat` still uses `exp`.

- **Breaking:** tokens and profile are saved together in one
  `<name>:auth:session` localStorage entry, so another tab can never read half a
  save. Entries written by 0.1.0-alpha.1 are removed, not restored,
  so users sign in once after upgrading.
- Tabs no longer sign each other out when the backend rotates refresh tokens.
  Refresh runs under a `<name>:auth:refresh` Web Lock, so one tab at a time
  spends the refresh token, and a tab first uses tokens another tab already
  saved. Previously a tab refreshing with a token another tab had already spent
  got `null`, signed out, and cleared storage for every tab.
- A profile update keeps tokens another tab refreshed instead of overwriting
  them with this tab's older ones.
- A refresh, a terminal rejection, or a second 401 never overwrites or clears an
  account another tab signed in, or signs it out. This tab switches to what
  storage holds; the pending call rejects with `SESSION_CHANGED`.
- While connected, tabs follow each other live through `storage` events. Signing
  out in one tab signs out every tab, so guards redirect to sign-in. Signing in
  or switching accounts in one tab switches the others, with a new `sessionId`.
  Profile updates appear in every tab. Each of these changes `version` once. A
  refresh elsewhere quietly replaces tokens and clears this tab's
  `REFRESH_FAILED` state, without changing `version`. Previously other tabs kept
  working with the old session until reload.

- Peer ranges are wider: React and React DOM `^19.0.0` (was `^19.3.0`), and
  TanStack React Router `^1.127.0` (was `^1.170.38`). CI tests the oldest
  versions in each range.
- The published package no longer declares `engines.node`. Installing it with
  `engine-strict` on Node.js 22 or older no longer fails. Node.js 24 is still
  required to develop the package, through `devEngines`.

### Added

- Tokens accept `expiresIn` (seconds, as in OAuth `expires_in`), counted from
  receipt. Passing both `expiresIn` and `expiresAt` is rejected.
- `auth.retry()` tries a failed refresh again. The README's protected layout
  example uses it in a Retry button.
- The README shows how to treat every refresh failure as a sign-out by returning
  `null` from the refresh callback.
- `createAuthFetch` accepts `{ signOutOnRepeated401: false }`, so an endpoint
  that answers 401 for reasons other than a rejected token cannot sign users out.
- `safeReturnTo` accepts `{ loginPath }`, one path or several, for apps whose
  sign-in page is not `/login`.

### Fixed

- `safeReturnTo` treats `/login/`, `/LOGIN`, and percent-encoded spellings of
  the login path as redirect loops. Previously only the exact `/login` was
  caught.
- `createAuthFetch` releases the first 401 response body when the refresh
  throws, and releases a response that arrives after the session changed.
- A proactive refresh cancelled by unmounting, or by a new sign-in, no longer
  counts as that token's one proactive attempt. Previously, after a remount, the
  token waited until expiry to refresh.

## 0.1.0-alpha.1

### Changed

- Tokens now persist in a `<name>:auth:tokens` localStorage entry instead of a
  cookie, so browsers no longer attach access and refresh tokens to every
  same-origin request. The profile remains in `<name>:auth:user`.
- **Breaking:** the `cookieMaxAge` option is renamed `maxAge`.
- The 3,800-character token budget is removed.

## 0.1.0-alpha.0

This continues `@monarcode/tanstack-auth@0.1.0-alpha.0` with the same APIs and
entry points. Additional router adapters are planned for later development.

Initial alpha for React browser apps using TanStack Router. The intended npm
distribution tag is `next`. The API may change during alpha development.

### Included

- `createAuth` validates users with Standard Schema V1 and infers their input
  and output types. Tokens persist in cookies; validated profiles persist in
  localStorage.
- Session restoration, sign-in, sign-out, account switching, and profile updates
  expose reactive state through TanStack Store.
- Optional refresh supports explicit expiry or JWT expiry hints, proactive
  scheduling, shared in-flight refresh work within one client, and recovery after
  operational failures. Session changes prevent stale async results from
  restoring old credentials.
- `connectAuth` connects a stable auth client in Router context to initialization
  and route revalidation. `useAuth` and `useAuthClient` retain consumer Router and
  schema inference; `safeReturnTo` validates local redirect destinations.
- `createAuthFetch` sends Bearer tokens to the configured origin and attempts
  refresh after a 401. GET and HEAD can be replayed once; mutations are not
  automatically replayed.
- ESM JavaScript, declarations, and source maps are exported through the package
  root, `/react`, and `/http`. The README includes a file-based Router example.

### Validation

- 45 automated auth behavior tests, five React hook tests, and four package smoke
  tests.
- Consumer declarations and eight README examples checked under TypeScript
  NodeNext and Bundler resolution.
- Local tarball installation, type inference, production build, and manual
  browser checks in a consuming app using mock refresh callbacks and dummy tokens.

### Limits

- Early development; not ready for production. Declared peer ranges are React and
  React DOM `^19.3.0`, and TanStack React Router `^1.170.38`. Node.js `>=24` is
  required; TypeScript 6.0.3 is the verified compiler version.
- Credentials are readable by same-origin JavaScript. Applications supply their
  authentication backend, server authorization, and token revocation.
- No cross-tab synchronization, automatic Query cache management, SSR adapter,
  or TanStack Start integration.
- Automated browser tests and validation against a real authentication backend
  are still pending.
