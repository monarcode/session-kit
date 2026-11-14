# Agent instructions

`@monarcode/session-kit`: schema-driven auth state and sessions for React,
with TanStack Router, React Router and Expo Router adapters, and sessions
kept on the server for TanStack Start, Next.js and React Router. It stores the tokens an
app's backend issues and manages the session around them (restoring,
refreshing, expiring, locking, syncing tabs); it never signs users in.
Consumers import from the root and from subpaths:
`import { createAuth, webStorage } from "@monarcode/session-kit"`, plus
`./react`, `./tanstack-router`, `./react-router`, `./react-router/server`,
`./http`, `./expo`, `./effect`, `./effetch`, `./server`, `./tanstack-start`,
`./tanstack-start/server` and `./next`.

## Start here

- `.stash/roadmap.md` is the design, the roadmap and the record of settled
  decisions ("Decisions made", "Open decisions"). Read it before any work,
  and add each new decision there.
- `.stash/` also holds API drafts for work in progress (for example
  `alpha6-lock-api.md`).
- `.stash/` is gitignored and lives on the maintainer's machine. Never commit
  it, and never link to it from the README, the docs or the code. If it's
  missing, ask for it.

## Rules

1. **Don't trust memory for dependency APIs.** Before using an API from
   `nanostores`, `@standard-schema/spec`, `expo-secure-store`,
   `expo-router`, `@tanstack/react-router`, `react-router` or Fumadocs
   (`fumadocs-*`, in the site), open its source or `.d.ts` in
   `node_modules` and read the signature and docs.
   Platform behaviour differs too: `expo-secure-store` keys iOS items by
   `requireAuthentication`, for example.
2. **Verify tool flags against current docs** (tsc, node's test runner,
   oxlint, oxfmt, pnpm, GitHub Actions, npm). If a flag doesn't exist, find
   its current equivalent rather than guessing.
3. **The `.d.ts` files are the documentation.** Consumers' "Go to Definition"
   lands on `.d.ts` files (no declaration maps are shipped). Every public
   export needs JSDoc with a description, an `@example` and `@since 0.1.0`.
   Public types are named, exported interfaces or aliases, not large inline
   conditional types.
4. **Runtime targets: browsers, React Native (Expo SDK 53+, Hermes/Metro)
   and Node ≥ 20** (server rendering imports the entry points). No `node:`
   imports in `src`, no `#private` fields, no DOM globals without a guard:
   entry points import without touching browser globals. The core entry
   point never imports `react` or `react-native`; only `./expo` imports
   Expo or React Native modules, only `./tanstack-start/server` imports
   `@tanstack/react-start`, and no entry point imports `next`. These targets
   are the package's: the docs site in `site/` isn't shipped.
5. **Behaviour belongs in the core engine** (`src/core/client.ts` and its
   modules). Adapters (`./react`, the routers, `./expo`, `./http`) only
   subscribe, guard and wire up lifecycle. State lives in a client, never at
   module level, except caches keyed by a client (`WeakMap`). Internal
   modules are not public building blocks.
6. **Never run `git commit`, `git push`, `git tag`**, or anything else that
   writes git history, unless the maintainer explicitly asks. Never commit
   `dist/` or `.stash/`, and never touch the staged index.
7. Never run `npm publish` (except `--dry-run`), `npm login`, `gh secret`,
   `gh workflow run` or `gh release`, never trigger CI or Actions, and never
   change repo settings.
8. **Ask before changing a settled decision** (`.stash/roadmap.md`,
   "Decisions made"). If the code shows a decision can't work, stop and
   explain why rather than working around it.
9. **No compatibility shims during alpha.** Make clean breaking changes and
   note each one in `CHANGELOG.md`. From `0.1.0-rc.0` the public API is
   frozen: no renames, removals or changed signatures of anything a subpath
   exports (functions, types, options, `AuthErrorCode`s). Additive changes
   only, and only with the maintainer's agreement.
10. **CI never calls dummyjson.com.** Examples may use it; tests mock it.

## Code style

- Write clean, maintainable code that reads like the code around it.
- Pass `useEffect` (and `useLayoutEffect`) a named function, not an arrow,
  and name its cleanup too:
  `useEffect(function watchForeground() { … return function unwatch() { … } }, [deps])`.
  The names show in stack traces and React DevTools, and say what the effect
  is for.
- Errors that leave the library are `AuthError`s with an `AuthErrorCode`,
  never a plain `new Error()`, so callers can match on `code` as well as
  read a message and a stack. That includes misuse, such as a bad option
  (`INVALID_OPTIONS`). Wrap a failure at the operation's boundary with
  `toAuthError(code, message, cause)`, where the operation knows its code;
  a `cause` is whatever failed, and doesn't need to be an `AuthError`.
  `fetch`'s and `Request`'s own failures pass through `authFetch`, and the
  app's own sign-in errors pass through a `createMirrorAuth` client's
  `signIn`.
- Source imports use explicit `.js` extensions. Because
  `exactOptionalPropertyTypes` is on, write optional props as
  `foo?: T | undefined`. `readonly` is a separate, per-type choice: outputs
  such as `Session`, `Credentials` and `AuthState` are `Readonly<…>`;
  inputs such as options stay mutable.
- Example apps stand alone, so some files are copies: `tests/examples.test.ts`
  lists them and fails when they drift. Edit one, then copy it.
- The build is plain `tsc`, not a bundler.

## Comments and JSDoc

Consumers read the hovers in their editor, so the JSDoc is written for app
developers, not for us. Every comment ships: keep it short, plain and true.

- **Public API.** Every export has a description, an `@example` that
  compiles (`check-docs` compiles every one) and `@since`. Members of options
  and props types get a description; other members only when there's
  something to say beyond the name.
- **First sentence: what it is or does, in plain words.** "Reads the current
  auth state and re-renders when it changes." Not how it works, and no
  internal names. A reader who sees only this line should know what it's for.
- **Then short paragraphs, one idea each**, in this order when they apply:
  more on what it does; errors, with their `AuthErrorCode`; server, React
  Native or framework differences; setup. Behaviour a caller will hit, such
  as which methods reject while locked or when a guard redirects, belongs
  here. Keep each paragraph to about four lines.
- **Short sentences.** One idea per sentence. Use a colon for a list or an
  example, not to join two sentences. Avoid chains of semicolons.
- **The reader's words, not the engine's:** "signed in", "the saved
  session", "another tab", "the access token expired". Never internal
  names such as `epoch`, `revision` or `flight`.
- **Options and props members** say what the option is for. A default that's
  a value goes in a last `@default` tag (`@default false`,
  `@default "/login"`): editors show it, and the site's type tables fill
  their Default column from it. A default that takes words, such as "the
  nearest `AuthProvider`'s", ends the description as `Default: …`. Say
  nothing when there's no default.
- **Link the next API a reader needs** with `@see {@link X} to …`, or
  `{@link}` in the text.
- A `{@link X}` must resolve in the published `.d.ts`: `X` is declared in
  that file, or imported there for its declarations. `tsc` drops imports
  used only in comments, so write any other name, such as another subpath's
  export, as a code span. `check-docs` fails on a link that doesn't resolve.
- **Examples are short** (about a dozen lines, one concept) and show real
  use; a trailing comment can show the result (`// "/dashboard"`).
  Walkthroughs belong in the site's pages. Examples import from
  `@monarcode/session-kit` and its subpaths as an app would, and
  `declare const` what they don't build. They compile under NodeNext and
  Bundler resolution with `exactOptionalPropertyTypes`, and `./expo`
  examples without DOM types. `./next` examples and the Next.js page compile
  under Bundler only, as Next apps do: `next` has no `exports` map. An
  example that augments a module (`declare module`) compiles on its own; the
  rest share one program. `tsx` blocks compile as TSX.
- **Give each fact one home.** A behaviour is described on the export that
  owns it, and other exports link to it rather than repeat it. The site's
  pages explain how to use the API and name it rather than repeat its
  details.
- **Internal code.** Document only what's non-obvious. A JSDoc on an
  internal function says why it exists or what's surprising about it, in one
  to three sentences, when its name and types don't say enough. A line
  comment is for a race guard, an ordering constraint, a workaround or a
  trap for the next maintainer, and says why, not what. Never restate the
  next line.
- Wrap comments at 80 columns, like the code.

## Testing

- Tests use node's test runner (`node --test`) and import the package as
  consumers do, so they run against `dist`: build before running them.
  `pnpm test` runs every file twice, with synchronous and with asynchronous
  storage (`tests/async-storage.env`).
- Control time with `t.mock.timers.enable({ apis: ["Date", "setTimeout"] })`
  and `t.mock.timers.tick(ms)`. Tests that mount a client push its unmount
  into `cleanups` (`tests/helpers.ts`), or a live timer keeps the run open.
- Type tests live in `tests/consumer.ts` and compile against `dist` with
  NodeNext and Bundler resolution. Use `// @ts-expect-error` with a reason.
- Type tests also run with `exactOptionalPropertyTypes` off, as most apps
  have it.
- The site's pages live in `site/content/docs/(latest)/`. A `ts` or `tsx`
  block with `title="path"` is an example, and each page's examples are
  type-checked as one small app by `scripts/check-docs.mjs`, together with
  the JSDoc examples, in memory. Each page is listed in `documents` in
  `scripts/docs-pages.mjs`, which the site also reads for type hovers, and
  a page that builds on Getting started lists the files it uses as `shared`.
  A new page with titled examples fails the check until it's listed.
- A README example marked `<!-- from: site/content/docs/(latest)/page.mdx -->`
  is an excerpt of that page's examples, and the check fails when the two
  differ: edit the page, then copy.
- The reference pages in `site/content/docs/(latest)/reference/` (one per
  entry point, and the error codes) are generated from the JSDoc by
  `pnpm run docs:reference`, except the entry points index and
  Compatibility. Don't edit them by hand: the check fails when they differ
  from what the JSDoc renders.
- `pnpm run check` doesn't build the site. Run `pnpm run build:site` after
  changing `site/`, a page's MDX or Twoslash blocks.
- Older release lines in `site/content/docs/<line>/` are snapshots. Don't
  edit them for a change in the current line.

## Working with the maintainer

The maintainer handles commits, pull requests, CI and npm.

- Work one step at a time; the maintainer approves each step before the next
  starts. At each stop, leave the working tree ready, with a summary and a
  suggested Conventional Commit message.
- When a step needs the maintainer (a push, a CI run, a publish, npm
  settings, the Release workflow), stop and say exactly what to do, with the
  commands.
- Prepare version bumps and `CHANGELOG.md` entries as uncommitted edits.
- Between releases, keep `CHANGELOG.md`'s `## Unreleased` section current:
  add each change as it lands, so the release only renames the heading to
  the version.
- Changes meant for an app's local `file:` link need a fresh `pnpm run
  build`.

## Before declaring any work done

Run `pnpm run check` and make sure it passes. It runs lint, the format check,
the build, the tests in both storage modes, the type tests, and the docs
check (every public export has a description, `@example` and `@since`,
every example in the JSDoc, the README and the site's pages compiles, every
export is on the reference, and every
`{@link}` resolves in the published types).
