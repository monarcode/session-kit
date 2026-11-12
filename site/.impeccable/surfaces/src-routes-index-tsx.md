---
version: 1
slug: "src-routes-index-tsx"
primary_target: "src/routes/index.tsx"
related_targets: ["src/components/landing"]
---

# Landing page (`/`)

Scope: the docs site's landing page, a Persuade surface. The rest of the site
takes the same world in a later step.

- Audience: React developers deciding in a minute whether session-kit fits
  their app; developers wiring it up who return for the install line and the
  guides; AI coding assistants reading the page as text.
- Job: make the offer plain (your backend signs users in, session-kit runs
  the session after), prove it, and hand over the install line.
- Action: install with the visitor's package manager, or open Get started.
- Proof: the real `createAuth` config from Getting started, the hour it
  produces, and the type-checked three-file tour. Every behaviour shown is
  one the docs state; the hour is labelled illustrative.
- Constraints: dark only; ink `#16171D` and lime `#D5F70D` exactly; the H1
  pitch word for word; keep the tour and the setup cards; reduced motion
  shows a still hour; motion pauses off screen; no text below 11px.
- Memorable moment: the `refresh` line is commented out, and on the next
  cycle the session ends at 09:15.
- Unresolved: the docs pages' styling and their prose face (a proportional
  companion to the mono) come in the next step. Two alternate directions
  are kept in the maintainer's notes in case this one is swapped.

## Direction contract

THESIS: The source is the stage. The page is a code buffer at stage scale
whose real `createAuth` config drives an hour of session lanes below it, and
a visitor can toggle its `refresh` line. It refuses the category default: a
centred headline over a code window and a grid of cards.

OWN-WORLD: Ink `#16171D` is the buffer. Lime marks only what is live: the
playhead, lit cells, a queued edit, the primary action. One face, Martian
Mono: narrow widths for display, normal for text. A line-number gutter,
headings as comments with a dim `//`, hairline rules, the docs' code
colours. No cards, shadows or gradients; controls are set in the buffer's
type, and tabs are file names.

STORY: A developer recognises their own config, watches session-kit run an
hour (refresh, storage, another tab) without being told, sees by subtraction
what `refresh` buys, then copies the install line or opens Get started.
Below: the checked tour, setups as entry points, what you get, and what it
doesn't do.

FIRST VIEWPORT: The H1 as lines 01–02, quiet over loud, at stage scale and
full width. The sub as a comment. The install prompt with a package-manager
switch, copy and a lime Get started, above the fold at 1280×720. The config
excerpt with its toggleable `refresh` line. Four lanes of 62 cells with a
lime playhead, a clock, the cycle count and a pause control. Signature
interaction: the toggled line is marked at once and applies at the next
cycle boundary, never mid-hour.

FORM: Live source, a dealt challenger (the algorave live-coding floor), not
on the grounded list; chosen over the roll (route topo, 5th) and the pick
(token working, 1st). seed:352e19a10045b060

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
