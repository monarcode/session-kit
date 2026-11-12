# Contributing

Use Node.js 24 or newer and pnpm. The repository is a pnpm workspace: the
package at the root, the example apps in `examples/`, and the documentation
site in `site/`.

```sh
pnpm install
pnpm run check
```

`check` runs Oxlint and Oxfmt, builds the package, runs the tests, and
type-checks the tests, the consumer declarations, and every documentation
example:

- **The JSDoc.** Every public export needs a description, an `@example` and
  `@since`, and every `@example` compiles.
- **The site's pages.** In `site/content/docs/(latest)/`, a `ts` or `tsx`
  block with a `title="path"` is an example, and each page's examples compile
  together as one small app. Most pages compile under NodeNext and Bundler
  resolution, the server-rendering guides under Bundler resolution, and the
  Expo guide under Bundler resolution without DOM types, as Metro resolves.
  `scripts/check-docs.mjs` lists each page.
- **The reference.** The API reference pages are generated from the JSDoc
  by `pnpm run docs:reference`, and the check fails when they're out of
  date. Run it after changing a public export or its JSDoc.
- **The README.** A block marked with a `from:` comment is an excerpt of a
  page's examples, and must match it.

`pnpm test` runs the runtime tests twice: with synchronous storage, and with
storage that settles every operation late, removals last, to catch ordering
bugs. `pnpm run build:examples` builds the package and every example app.

Tests are TypeScript files that Node runs directly. Behavior tests are split
by area and share the browser mocks in `tests/helpers.ts`. React tests mount
real React DOM, TanStack Router, and React Router in jsdom, and server tests
run TanStack Start's and React Router's real request handling and use
Next.js's own request, response and cookie classes. Expo tests replace
`expo-secure-store`, `expo-file-system`, `expo-router`, and `react-native` with
the mocks in `tests/mocks/`. CI also runs the tests and type tests against the
oldest supported peers, and builds the examples and the site. Before each
commit, Husky runs the lint and format checks.

## The documentation site

The site is Fumadocs on TanStack Start, prerendered to static files.

```sh
pnpm run build:site
pnpm --dir site run dev
```

`build:site` builds the package, then the site, into `site/dist/client`. It
also catches MDX syntax errors and type errors in Twoslash blocks, which
`check` doesn't build.

The live site shows the newest release. Older release lines are kept as
snapshots in `site/content/docs/<line>/`, made by `scripts/snapshot-docs.mjs`.
[RELEASING.md](./RELEASING.md) covers both.

## Try a local build

Run `pnpm pack`, then install the tarball in your app, replacing `<version>`
with the version in `package.json`:

```sh
pnpm add /absolute/path/to/monarcode-session-kit-<version>.tgz
```
