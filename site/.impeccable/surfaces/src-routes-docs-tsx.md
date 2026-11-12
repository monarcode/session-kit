---
version: 1
slug: "src-routes-docs-tsx"
primary_target: "src/routes/docs/$.tsx"
related_targets: ["src/components/mdx.tsx", "src/styles/app.css"]
---

# Docs pages (`/docs/…`)

Scope: every page under `/docs`, the current line and the older snapshots,
rendered by Fumadocs' `DocsLayout` and `DocsPage`. A Read surface inside
the established Live source world (DESIGN.md). No concept round: the
world is settled, and the docs keep the shell readers already know.

- Reader: a React developer with their editor open, wiring Session kit into
  one setup, or looking up one option, hook or error code. Agents read the
  same pages as Markdown; nothing here changes the Markdown routes.
- Reader's question: "how do I do this in my setup?" (guides) and "what
  exactly does this take and return?" (reference).
- Source material: the MDX in `site/content/docs/(latest)/`, its
  type-checked code, generated reference pages with type tables, two index
  pages with link cards, prev/next links, the version switch.
- Wayfinding: Fumadocs' standard shell stays. Sidebar tree on the left,
  "On this page" on the right, the TOC popover and sidebar drawer on
  phones, prev/next at the foot, search. Nothing new to learn.
- Constraints: dark only; lime exact and only for what is live; Geist and
  Geist Mono only; every pairing 4.5:1; no text below 11px; the content,
  headings and anchors are untouched (`check-docs`, the reference generator
  and the Markdown routes depend on them).

## Direction contract

THESIS: The docs are the same buffer, opened at a file. The world owns the
frame (sidebar, header, title, section openers, code, tables) and the
reading column stays calm: Geist at a real measure on ink.

FRAME:

- Ground: one ink plane. The sidebar is not a panel: no fill, a hairline
  on its edge. Header and TOC bar are solid ink, never blurred.
- Sidebar and TOC set in Geist Mono at label size, like the landing's
  controls. The current page is selection, not live: foreground text with a
  2px foreground rule on its left, no fill, no lime.
- The TOC's active segment is the page's playhead: a 2px lime rule beside
  the headings in view, moving as you read. It is the one lime element of
  a docs page (with the focus ring, selection and caret).
- Title and section openers as comments: H1 and H2 in Geist Mono 600 with a
  comment-grey `//` hidden from screen readers. H3, mostly export names on
  the reference pages, in Geist Mono without the marker.
- Controls (search, version, Copy Markdown, Open, the GitHub link) square,
  hairline, ink, label type. Popovers and the search dialog square on the
  popover surface with a hairline.

CODE (the signature, matching the landing's tour):

- A titled block is an open file: its path is a tab on a hairline rail
  (foreground, 2px foreground underline), the copy button at the rail's
  end, code flat on ink below, square, no card.
- Only files are numbered: titled blocks get the comment-grey two-digit
  gutter, unselectable. Untitled snippets have no numbers. Shell blocks get
  the install field's comment-grey `$` prompt instead.
- The package-manager tabs are the landing's switch: names in label type,
  the pressed one foreground with a 2px foreground underline.

COLUMN:

- Geist 16px, line height 1.75, foreground on ink. Paragraphs and lists
  stop at about 70 characters; code and tables may run the article's full
  width. More space above a heading than below it.
- Links: foreground with a comment-grey underline; hover turns the
  underline foreground. Inline code: Geist Mono on the lane-empty cell
  fill, square, no border.
- Tables: rows between hairlines, header in label type and quiet grey, no
  outer box. Type tables square on hairlines.
- Link cards (two index pages) become rows between hairlines, like the
  landing's setups list: name in Geist Mono 600, description in quiet grey.
- Prev/next: two hairline-ruled rows, square, the direction as a dim
  comment label.
- The older-line warning: a square hairline note, no card fill.

PHONES: the same shell Fumadocs ships (drawer, TOC popover); code scrolls
sideways inside its block; the measure is the screen.

RISK: Mono headings run wider than sans and wrap sooner on phones; the H2
size is held down to keep long guide headings to two lines.
