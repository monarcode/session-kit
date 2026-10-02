# Changelog

## Unreleased

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

### Added

- `auth.retry()` tries a failed refresh again. The README's protected layout
  example uses it in a Retry button.
- The README shows how to treat every refresh failure as a sign-out by returning
  `null` from the refresh callback.

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
