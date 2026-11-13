---
name: Session kit docs
description: The Session kit site, set as a live code buffer on ink and lime.
colors:
  lime: "#D5F70D"
  ink: "#16171D"
  foreground: "#e8e9ee"
  muted-foreground: "#9a9ca8"
  comment-dim: "#7f828e"
  hairline: "#262833"
  border-veil: "hsla(230, 12%, 60%, 0.16)"
  accent-veil: "hsla(230, 12%, 50%, 0.22)"
  surface-muted: "#1d1e25"
  surface-popover: "#1b1c23"
  surface-card: "#1c1d24"
  surface-secondary: "#22232b"
  lane-empty: "#1f2129"
  lane-unplayed: "#2b2d37"
  lane-mark: "#4d5160"
  lane-played: "#9a9ca8"
  scrollbar-thumb: "#3a3c48"
  code-string: "#83a598"
typography:
  display-quiet:
    fontFamily: "Geist Mono Variable, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "clamp(1.5rem, 3.6vw, 2.75rem)"
    fontWeight: 300
    lineHeight: 1.12
    letterSpacing: "-0.04em"
  display:
    fontFamily: "Geist Mono Variable, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "clamp(1.5rem, 3.6vw, 2.75rem)"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Geist Mono Variable, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  code:
    fontFamily: "Geist Mono Variable, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.7
  title:
    fontFamily: "Geist Mono Variable, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "Geist Mono Variable, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.625
  lead:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.625
  label:
    fontFamily: "Geist Mono Variable, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.333
rounded:
  none: "0px"
  cell: "1px"
spacing:
  hairline-gap: "1px"
  gap: "12px"
  column-pad: "16px"
  row: "16px"
  stack: "20px"
  gutter-phone: "28px"
  gutter: "48px"
  section-phone: "80px"
  section: "112px"
  column: "72rem"
components:
  button-primary:
    backgroundColor: "{colors.lime}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "0 24px"
    height: "48px"
  button-secondary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "0 20px"
    height: "48px"
  button-secondary-hover:
    backgroundColor: "{colors.accent-veil}"
  install-field:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "6px 6px 6px 16px"
    height: "48px"
  switch-tab:
    textColor: "{colors.comment-dim}"
    typography: "{typography.label}"
    padding: "4px 0"
  switch-tab-active:
    textColor: "{colors.foreground}"
  chip-queued:
    backgroundColor: "{colors.lime}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0 8px"
  gutter-number:
    textColor: "{colors.comment-dim}"
    typography: "{typography.label}"
    width: "48px"
  lane-cell:
    backgroundColor: "{colors.lane-mark}"
    rounded: "{rounded.cell}"
    height: "20px"
  lane-cell-played:
    backgroundColor: "{colors.lime}"
  lane-tooltip:
    backgroundColor: "{colors.surface-popover}"
    textColor: "{colors.muted-foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "8px 12px"
    width: "27rem"
---

# Design System: Session kit docs

## Overview

**Creative North Star: "Live Source"**

The page is a code buffer at stage scale. The buffer is set in Geist Mono,
numbered down a line-number gutter, and divided by hairline rules; only the
plain-prose leads under section heads switch to Geist, the family's sans. Headings are comments, with a dim `//` in front. Copy is
comments. The hero opens with the pitch, a lead comment and the install
prompt at the column's edge, unnumbered; the line numbers start with the
code: the real `createAuth` call from Getting started, lines 01 to 06,
whose `refresh` line (05) is live. Under it, one illustrative hour plays as
five lanes (signed in, refresh, storage, other tabs, route guard).

The surface is ink, flat, dark only. Lime is the one colour with a voice,
and it speaks only for what is live or playing, plus the single primary
action. Nothing is carded, lifted or blurred. Controls are set in the
buffer's type; tabs are file names; lists are rows between hairlines. The
density is a code editor's: tight lines, generous section breaks.

Scope. The dark retint of Fumadocs, the brand colours, the fonts, the
selection and caret colours, and the search dialog and popovers apply
site-wide (`app.css`, under `@theme`, `.dark`, `html` and the overlay
rules). The landing is scoped by `.live-source` on its layout: the mono as
the base face, the lanes, the live config and the install prompt. The docs
pages are scoped by `.docs-source` on the docs layout: the same world owns
their frame (sidebar, TOC, title, headings, code, tables), and the reading
column stays Geist on ink. See Docs Frame under Components.

**Key Characteristics:**

- One family: Geist Mono for the buffer, Geist (sans) for prose leads and the docs.
- Line numbers only on code; prose, numbers and lane names share one left edge.
- Comments as copy: `//` lead-ins and a `/* … */` block for asides.
- Hairline rules instead of boxes; square corners throughout.
- Lime only for live state and the one primary action; foreground for selection.
- Motion that plays an hour, pauses off screen, and stands still under reduced motion.

## Colors

Two brand colours carry the identity: ink as the buffer, lime as the live
signal. Everything else is a cool blue-grey ramp drawn from the ink.

### Primary

- **Signal Lime** (`lime`): the element colour, used at exactly this value
  and never as a tint, fade or overlay. It marks played lane cells, the
  playhead, the `>` marker hanging left of a live line's number, the queued
  line's 2px inset bar, the edit cursor, the "applies next cycle" chip, the
  selection highlight, the caret, Fumadocs' focus
  rings, the one primary action, Get started, and on docs pages the TOC's
  active segment, the reading position's playhead.

### Neutral

- **Buffer Ink** (`ink`): the page background and the text colour on lime.
  The landing's navbar is solid ink, never blurred.
- **Paper White** (`foreground`): body text, active tabs and switches, the
  clock and cycle count.
- **Quiet Grey** (`muted-foreground`): lead text, descriptions, captions,
  lane names and footer links.
- **Comment Grey** (`comment-dim`): `//` markers, line numbers, idle
  controls, the `$` prompt and footnote comments (4.6:1 on ink).
- **Hairline** (`hairline`): every rule and outline on the landing: section
  lists, the install field, the GitHub button, the tab rail, the footer.
- **Veils** (`border-veil`, `accent-veil`): Fumadocs' border and hover fill,
  retinted to ink's hue. The accent veil is the hover fill for buttons and,
  at reduced strength, for rows and the live line.
- **Surfaces** (`surface-muted`, `surface-popover`, `surface-card`,
  `surface-secondary`): Fumadocs' retinted panels for search, the sidebar and
  popovers. On the landing, only the lane tooltip uses one (`surface-popover`).
- **Lane greys** (`lane-unplayed`, `lane-mark`, `lane-played`): a lane's
  hairline track and a bar not yet reached, a moment still ahead, and a
  moment already passed (the quiet grey, so passed moments recede behind
  the lime). `lane-empty` is the inline-code fill in the docs.
- **Scrollbar** (`scrollbar-thumb`): the page scrollbar on an ink track.

### Tertiary

- **Keyword Red** (`--color-buffer-red`, `#fb4934`): Charbox's keyword
  colour, and in the lanes the colour of what ends the session: the
  refresh your backend rejects, the cleared storage, the route guard's
  redirect, and the "signed out" notes when `refresh` is off.
- **Your Code Blue** (`code-string`, the `--color-buffer-blue` token,
  `#83a598`): Charbox's identifier colour, and the colour of your own code.
  It marks the entry-point specifiers in the setups list, and your app's
  sign-in call to its backend in the lanes, before Session kit takes over
  at 09:00. The lanes' blue and red are the code's own, so the page reads
  in one palette.
- **Code (Charbox):** every code block takes Charbox, the maintainer's
  Gruvbox-inspired Zed theme, as a Shiki theme (`src/lib/charbox.ts`): cream
  text `#ebdbb2`, red keywords `#fb4934`, green strings and functions
  `#b8bb26`, yellow types and constants `#fabd2f`, blue identifiers
  `#83a598`, purple numbers and literals `#d3869b`, aqua operators and JSX
  tags `#8ec07c`, orange italic parameters `#fe8019`, and comments in
  `#a89984` (6.4:1 on ink). Only its syntax colours come over: code sits on
  the ink, not Charbox's own `#111111`.

### Named Rules

**The Live Lime Rule.** Lime marks only what is live or playing, and the one
primary action. In the lanes, lime is Session kit's own work; what your app
does before handing over (the sign-in call) is blue, and what ends the
session is red. Selected tabs, pressed switches and hovered links never turn
lime: they turn foreground.

**The Exact Lime Rule.** Lime is used at its full value or not at all. No
opacity, no tint, no lime behind a blur. That is why the landing navbar is
solid ink.

**The Readable Pairing Rule.** Every text pairing on ink keeps at least 4.5:1.
Comment grey is the floor for text; the lane greys are for cells, not words.

## Typography

**Display Font:** Geist Mono Variable (with ui-monospace, SFMono-Regular, Menlo, monospace)
**Body Font:** Geist Mono Variable on the landing; Geist Variable (with ui-sans-serif, system-ui, sans-serif) for leads and the docs
**Label/Mono Font:** Geist Mono Variable

**Character:** One family in two voices. Geist Mono does the editor's jobs:
the pitch, the gutter, code, comments, controls and labels. Geist, its sans,
carries running prose, where a proportional face reads faster. Both are
self-hosted from `@fontsource-variable/geist` and
`@fontsource-variable/geist-mono` (weights 100–900, no width axis) and set
as Tailwind's `--font-sans` and `--font-mono` site-wide. The landing's base
face is the mono.

### Hierarchy

- **Display** (300 then 700, `clamp(1.5rem, 3.6vw, 2.75rem)`, 1.12, -0.04em):
  the H1 only, as two comment lines. Quiet over loud: the
  first line light in quiet grey, the second bold in foreground, each behind
  a light comment-grey `//`.
- **Headline** (600, 1.5rem on phones, 1.875rem from 640px, -0.025em):
  section heads, written as a comment with a dim `//`, balanced.
- **Code** (400, 15px / 1.7; 13px / 1.8 on phones): the hero's config lines.
  Wrapped lines hang under the line they continue (a 4ch hanging indent).
- **Title** (600, 1rem): the name column of list rows (setups, features) and
  the aside's heading.
- **Body** (400, 0.875rem / 1.625; 1rem for the hero's lead from 640px):
  descriptions behind a dim `//`, in the mono. Feature text stops at 72ch.
- **Lead** (Geist, 400, 1rem / 1.625; 1.125rem from 640px): the plain prose
  under a section head, in quiet grey, stopping at 62ch.
- **Docs** (Geist Mono 600 for the frame, Geist 400 for the column): the
  page title at 1.75rem (2.25rem from 640px, -0.04em) behind a light
  comment-grey `//`; H2 at 1.375rem behind the same `//`; H3, mostly export
  names, at 1.0625rem without it. Body text is Geist 16px / 1.75, and
  paragraphs and lists stop at 36rem (about 75 characters). Sidebar and TOC
  entries are Geist Mono at 13px.
- **Label** (400, 0.75rem): line numbers, lane names, the time axis, the
  status line, switches, chips and footer links. Numbers are tabular. No
  text is set below 11px.

### Named Rules

**The One Family Rule.** The site uses Geist and Geist Mono and nothing else.
On the landing the mono is the voice; the sans is for running prose only.
Hierarchy comes from weight, size and the quiet/loud colour pair.

**The Comment Voice Rule.** Headings and copy are written as comments: a
comment-grey `//` (hidden from screen readers) in front of a sentence-case
line. Asides use a `/* … */` block. No uppercase labels.

## Layout

One column, 72rem wide with 16px side padding, matched to the navbar so the
text starts under the logo. The prose (the H1, the lead, the install row),
the line numbers and the lane names share that left edge. Only code is
numbered: its gutter is a fixed column for two-digit numbers (28px on
phones, 48px from 640px), comment grey, tabular and unselectable, and the
code starts to the right of it, so it reads as a block set into the page. A live line's `>` marker hangs into the margin to the
left of its number, so the numbers stay in one column.

The hero runs as three groups set apart by space, with tight spacing
inside each: the pitch (the H1, then the lead 12–16px under it, at most
72ch), the actions 20–24px below (the package-manager switch, the install
row, Get started, GitHub), and the demo 28–32px below that (the config,
then a hairline with 20px either side, then the lanes). The hero opens
32px (40px from 640px) under the navbar. Sections
below it open with 80px (112px from 640px) of space and a comment headline,
then 32px to their content. Lists are full-width rows between hairlines with
16px vertical padding; from 640px they become aligned columns (setups: name,
entry point, description, "guide"; features: name, description).

The hour's lanes are a two-column grid: lane names (5.5rem, 8rem from
640px), then 68 equal cells with a 1px gap (3px from 640px): two for the
sign-in call (08:58, 08:59), 62 for the hour, a blank column for the time
skipped, then three for "later". Rows are 26px (30px from 640px). The
status line heads the figure, 12px above the lanes, next to the config it
reports on; the footnote sits 16px under the axis. The playhead spans the
lanes, not the axis. Axis times sit at the start of their minute's column,
so 09:00 marks the handover.

Short screens (640px and wider, at most 800px tall, such as a 1280×720
laptop; the `short:` variant): the hero tightens so the config, the lanes
and the axis fit in one view. It opens 24px under the navbar, the lead sits
12px under the H1 at a 1.625 line height, the actions 20px below, the config
20px below that at a 1.55 line height, the hairline takes 12px either side,
and lane rows are 26px.

Phones (below 640px): the gutter narrows, the config's "click to comment
out" tag drops to its own row under the code, the tour's file tabs become
three equal columns that may wrap, code wraps with a hanging indent instead
of scrolling sideways, the 09:45 tick and the lane-row "signed out" note
are replaced by a shorter status-line note, and lane tooltips open under the
lanes, across the figure, instead of above them.

## Elevation & Depth

Flat. There are no drop shadows, gradients or blurs on the landing. Depth
comes from three things only: hairline rules, the veil fill on hover, and
the lime of what is playing against ink. The lane tooltip sits on the
popover surface with a hairline border, not a shadow. The two inset shadows in the build
are drawn rules, not elevation: a 2px foreground underline on the active
package manager, and a 2px lime bar on the left of a queued line.

### Named Rules

**The Flat Buffer Rule.** Nothing on the page lifts off the ink. A surface
that needs separating gets a hairline; a state that needs showing gets a
veil, a foreground underline or, if it is live, lime.

## Shapes

Square. Buttons, the install field, the queued chip, code blocks and the
tour's tabs all have zero radius, overriding Fumadocs' rounded defaults on
the landing. The only rounding is 1px on moment cells, to keep small
rectangles from shimmering. Each lane is a 1px track (lane-unplayed) through
its row's centre, broken at the skipped column; an empty minute draws
nothing on it. Bars are solid strips (6px, 8px from 640px) that run through
the gaps between minutes, so a held state never reads as dashes. Moment
cells fill the row's height (16px, 20px from 640px). Borders are always 1px
hairlines.

## Components

### Buttons

Set in the buffer's type, square, 48px tall.

- **Shape:** square corners (0px).
- **Primary:** Get started. Lime with ink text, bold body size, 24px side
  padding. The only lime action on the page.
- **Hover / Focus:** the primary gains a 2px ink underline (4px offset); its
  colours never change. The landing's own buttons set no focus style and
  show the browser's default outline; Fumadocs' controls use the lime ring.
- **Secondary:** GitHub. Ink with a hairline outline and foreground text,
  20px side padding; the accent veil fills it on hover.
- **Quiet:** the version link and the copy button: comment-grey or quiet-grey
  label text that turns foreground on hover (copy also takes the veil).

### Chips

- **Style:** "applies next cycle": lime with ink label text, 8px side
  padding, square. It appears only while an edit is queued.
- **State:** idle, the same slot reads "click to comment out" or "click to
  restore" in comment grey, with no fill.

### Inputs / Fields

- **Style:** the install prompt is a read-only command line. Hairline
  outline, square, at least 48px tall, a comment-grey `$`, the command in
  foreground, and a copy button inside the right edge whose label reads
  "copied" for 1.6s.
- **Focus:** carried by the copy button inside it (the browser's default
  outline).

### Navigation

- **Package-manager switch:** a row of label-size names in comment grey.
  Hover and the pressed one turn foreground; the pressed one carries a 2px
  foreground underline drawn as an inset rule.
- **File tabs (the tour):** tabs are file names on a hairline rail. The
  active tab turns foreground with a foreground underline. Code sits flat
  under them with no title bar and no card.
- **Links:** inline text links are foreground with a comment-grey underline
  (4px offset); hover changes only the underline colour, to foreground.
  Quiet links (footer, version, a row's "guide") are grey and brighten to
  foreground on hover.
- **Navbar:** Fumadocs' home navbar, with the Session kit wordmark (lime
  brace and dot, the name in foreground, 20px tall), Docs and Reference.
  The docs sidebar shows the same wordmark. Solid ink on the landing, no backdrop blur.

### Docs Frame

Fumadocs' docs shell, kept as readers know it (sidebar tree, "On this
page", the phone drawer and TOC bar, prev/next, search), rebuilt in this
world's vocabulary. Scoped by `.docs-source`.

- **Ground:** one ink plane. The sidebar is not a panel: no fill, a
  hairline on its edge. The phone header and TOC bar are solid ink.
- **Sidebar:** Geist Mono at 13px. The current page is selection: foreground
  text with a 2px foreground rule on its left, no fill. Search, the version
  switch and the GitHub link are square, hairline, ink.
- **TOC:** Geist Mono at 13px under a comment-grey "On this page". The
  headings in view turn foreground, and a 2px lime rule runs beside them as
  you scroll: the docs' one lime element.
- **Title and headings:** comments, as on the landing (see Typography).
  The folder above a title is where the file lives: Geist Mono 12px in
  comment grey, never lime. Copy Markdown and Open are quiet square controls
  on a hairline.
- **Code blocks:** set as the tour's open files. A titled block's path is a
  tab on a hairline rail (foreground, 2px foreground underline), the copy
  button at the rail's end, the code flat on ink and closed by a hairline.
  Titled blocks are files, so they take the line gutter; untitled snippets
  don't. Shell blocks take the install prompt's comment-grey `$`. Numbers
  and prompts are left out of copies and screen readers. On phones a block
  shows whole and scrolls only sideways.
- **Type hovers:** every titled block's names show their types on hover.
  While the pointer is in a block, each name takes a dim dotted rule; the
  name under it, a foreground one. The popup is one square ink panel on a
  hairline, at most 36rem wide (never wider than the screen less 2rem) and
  30rem tall: the type flush at the top in the code's 13px, then the first
  paragraph of its docs in quiet grey below a hairline. No copy button, no
  box around the type, no shadow, and no `@example` or `@since`. Names stay
  out of the tab order: there are hundreds a page.
- **Package-manager tabs:** the landing's switch on a hairline rail.
- **Tables and type tables:** rows between hairlines, a label-type header,
  no fill and no outer box. Prop names are foreground, not lime.
- **Link cards:** rows between hairlines, like the landing's setups list:
  the name in Geist Mono 600, the description in quiet grey.
- **Links and inline code:** links as on the landing. Inline code is Geist
  Mono on the lane-empty fill, square, no border.
- **Prev/next:** two square rows between hairlines, titles in the mono.
- **Not found:** the home layout with one comment-voice line, "// 404:
  nothing at this path.", at the hero's scale, a quiet line pointing to
  search, and the hero's pair of buttons: Read the docs (lime) and Home.

### Line Gutter (signature)

Two-digit numbers in comment grey and label size, tabular, `aria-hidden` and
unselectable. A live line, one a visitor can edit, gets a lime `>` hanging in
the margin left of its number. Only code is numbered; the prose above it
starts at the column's edge, level with the numbers.

### Live Config Line (signature)

The `refresh` line is a full-width button. Hover gives it a light veil.
Clicking it comments the line out (the whole line turns comment grey behind
`// `) or restores it. While playing, the edit is queued, not applied: the
line keeps a veil and a 2px lime inset bar, a lime block cursor blinks at
its end (1s, stepped), and the tag becomes the lime "applies next cycle"
chip. The edit lands at the next cycle boundary, never mid-hour. Paused,
it applies at once. Once a visitor has queued an edit, the playhead hurries
to the boundary (about 25ms a minute, no holds), so the effect shows within
about two seconds; cancelling the edit returns it to its pace.

### Session Lanes (signature)

Five labelled lanes (signed in, refresh, storage, other tabs, route guard),
one cell per minute from 08:58 to 10:01, then "later". The first two columns
are the sign-in call: blue strips on the signed-in lane only, with the other
lanes blank until Session kit starts at 09:00. After a blank column for the
time skipped, "later" shows the session ending once the refresh token has
expired too: a red refresh your backend rejects, a red storage cell as the
session is cleared in every tab, then the route guard's red redirect to
`/login`. The route guard also marks the 09:20 reload, where it checks the
restored session and lets the page render. Without `refresh`, storage clears
in red at 09:15 and the guard redirects at 09:16. Bar
lanes (signed in, other tabs) hold a state; hit lanes (refresh, storage)
mark moments. Cells that have played are lime; a moment's cell is lime only
in the minute it fires, then settles to lane-played grey. A 2px lime
playhead sweeps the lanes. Above them: a status line (caption; running or
paused; refresh on or off; cycle; the clock in foreground; a pause or play
text control). Under them: a time axis in comment grey and a footnote
comment saying the hour is illustrative. Without refresh, the signed-in bar
ends at 09:15 with a red "signed out" note, which appears once the playhead
reaches 09:15. The footnote carries a key: a blue
swatch for your app signing in with your backend, a lime one for Session
kit from 09:00, and a red one for the session ending.

**Motion.** About 140ms per minute of the hour, with an 8-minute rest
between cycles. Each cycle starts at 08:58. The playhead holds for 1.7s on
each moment (the 08:58 sign-in call, the 09:00 handover, every refresh, the
09:20 reload, the 09:31 second tab, and the three moments later) while its
tooltip shows. After the hour's last moment the playhead hurries to the
end. The clock reads "later" past the hour. The page demos the edit itself,
until a visitor touches it: it queues the edit in the rest after cycle 1 and
after every third cycle, and restores the line in the rest after the cycle
without it, so the config and the hour under it always agree. Cells ease colour over 200ms. The
hour stops when off screen. Reduced motion shows the complete hour, still,
with the playhead hidden and the cursor steady.

### Lane Tooltip

Says what a lit moment was, in the reader's words: "Your app's login()
call", "auth.signIn hands Session kit the tokens", "New tokens, a minute
before access expired". It appears
during the playhead's hold on that moment, and on hover over any moment cell
(a help cursor marks them), so a paused or still hour can be read too.

- **Style:** the popover surface, a hairline border, square, 12px side and
  8px vertical padding, label type. The time in foreground, then one row per
  lane: the lane name (or "your backend") in comment grey, what happened in
  quiet grey. No lime:
  the lit cell under it is the live part.
- **Position:** below the lowest lane the moment lit, centred on its column
  and kept inside the lanes' width (27rem at most), with a 1px comment-grey
  tick up to the cell. The lanes under a moment are empty or still ahead, so
  it never hides the lit cells, the 09:00 handover or the code above. It
  sits above the axis times. On phones it runs across the figure.
- **Motion:** fades up 2px over 160ms. Reduced motion shows it without the
  fade, on hover only.

## Do's and Don'ts

### Do:

- **Do** set the landing in Geist Mono, and only running prose (section leads, docs text) in Geist.
- **Do** write headings and copy as comments, with a comment-grey `//` hidden from screen readers.
- **Do** number only code; set prose at the column edge, level with the line numbers.
- **Do** separate content with 1px hairlines and full-width rows, not boxes.
- **Do** use lime at its exact value, only for live or playing state and the one primary action.
- **Do** show selection (active tab, pressed switch) in foreground with a 2px foreground underline.
- **Do** keep every text pairing at 4.5:1 or better and every label at 11px or larger.
- **Do** give every animation a still, complete state for reduced motion, and stop it off screen.

### Don't:

- **Don't** tint, fade or blur lime, or place translucent chrome over it.
- **Don't** use lime for selected tabs, toggles or link hovers.
- **Don't** add cards, drop shadows, gradients or rounded corners, on the landing or in the docs' frame.
- **Don't** introduce a typeface outside the Geist family.
- **Don't** add a light mode or a theme switch; the site is dark only.
- **Don't** apply a queued edit mid-hour while the hour is playing.
