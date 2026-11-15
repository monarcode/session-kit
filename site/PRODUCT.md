# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Developers wiring it up.** React developers whose own backend issues
  access and refresh tokens. They are setting Session kit up with their
  router or framework (TanStack Router or Start, React Router, Next.js, Expo
  Router, or plain React), reading a setup guide and the reference with their
  editor open.
- **Developers evaluating it.** Developers deciding between Session kit,
  writing the session code themselves, or an auth service such as Auth.js,
  Better Auth or Clerk. They need to see quickly what it does, what it
  doesn't, and whether their setup is supported.
- **AI coding assistants.** Agents that read `llms.txt`, `llms-full.txt` and
  each page's Markdown route to wire Session kit into an app.

## Product Purpose

The site is the documentation and landing page for `@monarcode/session-kit`,
a library that keeps a React app signed in with the tokens its backend issues.
It saves the session, restores it on reload, refreshes tokens before they
expire, keeps every tab in step, and guards routes, in the browser, on React
Native and with server rendering.

The site owns the guides: the README keeps only an introduction, installation
and a short quick start, and links here. Success: a developer goes from
install to a signed-in app with guarded routes by following one setup guide,
and an evaluator can tell within the first screen or two whether
Session kit fits their app.

## Positioning

Session kit is the session layer for apps that already have a backend. It
never signs users in: no sign-in form, no OAuth flow, no user database. It
starts where the backend's sign-in response ends. Auth services manage their
own sessions; Session kit manages the session around tokens someone else
issued.

Every code example on the site is type-checked against the published package
by `scripts/check-docs.mjs`, and the landing page's code tour is read from
those same checked examples, so the code shown is code that compiles.

## Operating Context

- Developers arrive from the npm page and the GitHub README, both of which
  link to the site, or from search.
- The other documentation surface is the editor: the package's JSDoc, shown
  in hovers and on "Go to Definition". The site's reference pages are
  generated from that JSDoc.
- One docs version per release line (`0.1`, `0.2`, …). The current line is at
  `/docs/…`; older lines are snapshots at `/docs/<line>/…`, switched with a
  version dropdown. The live site shows the newest release (Cloudflare's
  production branch `site`); `main` deploys as a preview.
- The site ships with `0.1.0-rc.0`. The package is pre-1.0: alpha releases
  until now, release candidates next.

## Capabilities and Constraints

- Fumadocs on TanStack Start, fully prerendered to static files
  (`site/dist/client`), hosted on Cloudflare Pages. Light and dark mode, full
  text search, per-version search, `llms.txt`.
- Guides live in `site/content/docs/(latest)/` as MDX. A `ts` or `tsx` block
  with `title="path"` is a checked example; each page's examples compile as
  one small app.
- The reference pages (one per entry point, plus error codes) are generated
  from the JSDoc by `pnpm run docs:reference` and must not be edited by hand.
- Type tables (`fumadocs-typescript`) and Twoslash hovers read the package's
  published `.d.ts`.
- Supported setups: TanStack Router, TanStack Start (SPA and server
  rendering), React Router (declarative, data, framework with and without
  SSR), Next.js App Router, Expo Router (iOS and Android), plain React,
  Effect and effetch. Expo web is not planned.
- Terminology: the product is written **Session kit** in prose; the package is
  `@monarcode/session-kit`, and `session-kit` stays wherever it is an
  identifier (the npm name, URLs, paths). Use the reader's words ("signed in", "the saved
  session", "another tab", "the access token expired"), never engine names
  such as epoch, revision or flight.
- Undecided: the site's final URL. `https://session-kit.pages.dev` is assumed
  until the Cloudflare Pages project or a custom domain is set.

## Brand Commitments

- **Pitch:** "Every sign-in ends in a session. Make yours type-safe and
  predictable." Under it, the hero says what Session kit is ("Define,
  validate, and manage application sessions with a schema-driven toolkit
  built for React and meta frameworks") and which setups it supports.
- **Wordmark:** "Session Kit" with the brace-and-dot mark,
  `assets/Session-kit-logo.svg`. The site's top bar and the docs sidebar
  show it, with the name in the text colour.
- **Maker's mark:** the lime brace and dot alone, `assets/monarcode_logo.svg`,
  is monarcode's mark, shared across monarcode projects such as effetch. The
  site doesn't show it on its own.
- **Brand colours:** the element colour is lime `#D5F70D` and must stay
  exactly that value; the background is `#16171D`. The site's identity is
  built around these two. Variations and combinations are open, the lime
  itself is not.
- **Dark only.** The site has no light mode and no theme switch.
- `assets/sk-banner.png` is the README's banner. `assets/logo.png` (a palm
  and keyhole) is no longer used on the site.
- **Voice:** plain and direct, written for app developers. Short sentences,
  one idea each. Says what the library doesn't do as clearly as what it does.

## Evidence on Hand

- The test suite: 415 tests, run with both synchronous and asynchronous
  storage (`tests/`), plus type tests against the built package.
- Type-checked examples in the site's pages, the README and the JSDoc
  (`scripts/check-docs.mjs`).
- Runnable example apps for each router and framework setup (`examples/`).
- npm provenance on published releases, and the bundle size on bundlejs.
- `CHANGELOG.md` for every release.

Absent, and not to be invented: users, adopters or company logos,
testimonials, download or adoption numbers, benchmarks, and claims of
production readiness before `0.1.0`.

## Product Principles

1. **Honest scope.** Say up front that Session kit never signs users in, and
   point to auth services for those who need that.
2. **Shown code compiles.** Never put code on the site that `check-docs`
   doesn't check.
3. **One home per fact.** A behaviour is explained in one place, and other
   pages link to it rather than repeat it.
4. **The reader's words.** Explain behaviour in terms of what the app and the
   user see, not the engine's internals.
5. **Readable by people and agents.** Every page also exists as Markdown, and
   the structure works for both.
