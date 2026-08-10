---
description: Generate a React section from a Photoshop design-spec (cut by the PTS plugin) — reads the spec + preview image + the project's styleExemplar and CLAUDE.md, then scaffolds index.tsx + Style.module.scss with swap-ready demo data and runs generate-css.
argument-hint: <slug or path to design-spec.json, e.g. frame2suutapthe or .pts-cache/frame2suutapthe/design-spec.json>
allowed-tools: Read, Grep, Glob, Edit, Write, Bash(bun run generate-css), Bash(bun run lint), Bash(bun run build-f)
---

# /gen-section

Scaffold a **new** page/section from a **Photoshop design-spec** — the `design-spec.json`
the PTS plugin writes after it slices a frame's layers into `public/images/`. This command
reads the spec + its preview image, imitates the project's own conventions, and writes
`src/pages/<Section>/index.tsx` + `Style.module.scss` with **swap-ready demo data**.

**Input:** `$ARGUMENTS`

This is the codegen half of the PSD pipeline: the **PTS plugin** cuts images + emits the
spec; **this command** builds the UI from it; **`/implement-api`** later swaps the demo
data for the real API. It supersedes the non-interactive `bun run gen-section` (which now
just delegates here) so you can watch and steer each step.

> **Guiding principle — the spec + preview are the contract, the exemplar is the style.**
> The `design-spec.json` tree defines *what* exists and *where* (bounds, roles, cut
> filenames); the preview image shows *how it looks*; the project's **styleExemplar** and
> **CLAUDE.md** define *how this project writes code*. Reproduce the design faithfully in
> the project's own idioms — do not invent structure the spec doesn't have, and do not
> introduce conventions the exemplar/CLAUDE.md don't use.

> **Standing rule — ask, don't assume.** If the spec, preview, or a role/subRole is
> ambiguous or conflicts with what the preview shows (a node that looks dynamic but is
> marked static, an unreadable region, an unclear title block), **stop and ask** rather
> than guessing.

Work through the phases **in order**.

---

## Phase 0 — Resolve the spec

1. `$ARGUMENTS` may be a **path** to a `design-spec.json` or a bare **slug**.
   - If it resolves to an existing file, that's the spec.
   - Otherwise treat it as a slug: spec = `.pts-cache/<slug>/design-spec.json`.
   - If neither exists, list `.pts-cache/*/` and **stop** — the plugin's Analyze → Cut
     step probably hasn't run for this slug.
2. Read the spec. Note: `sectionName` (PascalCase → the folder + block name),
   `viewport` (`{width,height}` = the PSD frame size, in px), `previewImage` (repo-relative
   path), and `root` (the layer tree). `<TargetDir>` = `src/pages/<sectionName>/`. If it
   already exists, **stop** and ask whether to overwrite.

## Phase 1 — Gather project context (MANDATORY before writing code)

1. **Read the preview image** (`Read` on `spec.previewImage`) — this is your ground truth
   for layout, so you don't code blind.
2. **Read `.pts-config.json`** at repo root → `styleExemplar` (the path to a representative
   existing section in THIS repo — whatever the config names).
   - If that directory has `index.tsx` + `Style.module.scss`, **read both and imitate them
     1:1** — file structure, import set, className conventions, positioning approach,
     state/loading idioms, image/text helpers, **and literal whitespace style** (tabs vs
     2-space, quote style) — not just structural conventions. The exemplar is how a section
     is written *here*; match it — **except** where CLAUDE.md states an explicit, lint-enforced
     rule (e.g. `indent: tab`) that the exemplar itself predates/violates: a lint rule is the
     law even when the exemplar doesn't follow it, so match a lint-enforced sibling
     (another generated section, or any file that passes `bun run lint` clean) instead for
     that one dimension, and the exemplar for everything lint doesn't govern (e.g. SCSS
     indentation, quote/semicolon style, where nothing enforces either way).
   - If there is **no exemplar** (new project), skip this and rely on Phase 3 + CLAUDE.md
     — the output will still be structurally correct, just less idiomatic.
3. **Read the project's `CLAUDE.md`** — the rulebook for framework, styling system, path
   aliases, data-access, handler pattern, empty-state. The exemplar shows the shape;
   CLAUDE.md is the law. Follow both; don't restate them below.

## Phase 2 — Validate the spec against the preview (before writing code)

The classification in the spec is a deterministic + human-reviewed **draft**; the preview
image is the ground truth. Compare the two node-by-node and act on mismatches. Do **not**
edit the spec file or re-cut — resolve everything in the code you're about to write, or flag it.

**Fix in the generated code (the cut assets already support it — no re-cut needed):**
- A node marked `static-asset` / `text` that the preview clearly shows is per-user/per-item
  **data** (avatar, name, score, points, price, a counter like `0/8`) → render it as a
  **dynamic slot**: bind it to the demo array + an `apiHint`, using the cut asset/text as the
  fallback. (A `static-asset` cut works as a demo fallback exactly like a `--demo` cut, so you
  can promote static→dynamic in code without re-cutting.)
- A node marked `dynamic-image` that is clearly a fixed frame/decoration → render it static.
- `background:url()` vs `<img>` — decide from the preview (full-bleed frame/decor → background;
  content in the flow → img), not from the node name.

**Flag to the user (cannot fix without re-cutting in Photoshop):**
- The preview shows **several distinct elements** but the spec baked them into **one** cut PNG
  (a missed list or missed component split) → you can't un-bake it. Generate with what you have,
  but report: *"re-cut in PSD with a `[list]`/`[cmp]` marker on <group> to split X."*
- A list whose instances visibly differ (different art per card) but were cut as one
  representative → note only a demo image exists until re-cut / API wiring.

**Confirm the confident calls:** the frame is centered (not left-anchored); every repeated
cluster the preview shows as a grid/row IS a list; bg-vs-img matches the preview.

Apply fixable items directly (don't block); for a genuine ambiguity the preview can't settle,
**stop and ask** (Standing rule). Carry every adjustment + flag into the Phase 4 report.

## Phase 3 — Build from the validated spec (framework-neutral — apply in every project)

Walk `spec.root` honoring each node's `role` / `subRole` **as adjusted in Phase 2**, and produce
code shaped like the exemplar. These rules are portable; the *specific* API for each (the
px→viewport helper, the image component, the dynamic-copy helper, the handler pattern) comes
from the exemplar + CLAUDE.md.

- **Output ONLY** `<TargetDir>/index.tsx` + `Style.module.scss`. Create a separate
  `components/<Name>` file **only** when a node's `role` is `component` (marker `[cmp]`) or
  it is genuinely reused — otherwise render everything inline. Do not over-split.
- **CENTER THE FRAME — never left-anchor it.** The section renders full-width but spec
  bounds are frame-relative (frame = `spec.viewport`). Do **not** put `position:absolute`
  children directly on a `width:100%` root — that pins the design to the left edge. Instead:
  if the root's direct children stack vertically (Y ranges don't overlap) make the root a
  **flex column, centered**, spacing children by margins from their Y gaps; if they
  genuinely overlap/scatter, wrap them in **one centered fixed-width box** (frame width,
  `margin: 0 auto`, `position: relative`). Reserve `position:absolute` for the **inner**
  scattered arrangement of a list's instances, inside a relative fixed-size box.
  **Mixed case** (some root children — a title, a counter — don't overlap anything and become
  separate flex-flow blocks, while the rest genuinely overlap/scatter into one shared box):
  the shared box's own height and every child's `top` **must be re-based to that box's own
  origin** (subtract the Y of whichever of its children starts first), never left as the
  original frame-relative Y — otherwise the box still reserves the vertical space the
  flow blocks above it already consume a second time, opening a dead gap between them
  exactly as tall as the flow blocks' own Y-range in the spec.
- **Every `position:absolute` container needs an explicit size.** If a box is
  `position:absolute` and every one of its own direct children is *also*
  `position:absolute` (the norm for a list's per-instance `--N` wrapper, or any inner
  scattered box), it has nothing in-flow to shrink-to-fit around and silently collapses
  to `0×0` — no error, no warning. A `<div>` child with its own explicit `width`/`height`
  still looks fine, but any `<img>`/image component inside gets clamped to `width: 0` by
  this project's global `img { max-width: 100% }` reset (100% of a 0px containing block
  is 0), while its `height` renders correctly (no matching global `max-height`) — so the
  bug shows up as a missing/invisible image, not an obvious layout break. Always give
  such a container an explicit `width`/`height` (from `bounds.w/h`, or per-instance from
  `boundsOverride`/the dominant child) — never leave it position-only.
- **role `container` / `component`:** a layout box. `layout.direction` `row`/`column` →
  flexbox; `absolute` → position children by `bounds`, but obey CENTER-THE-FRAME. `layout`
  is only a hint — trust the preview.
- **role `list`:** render **inline** with `data.map((item, i) => …)`. Declare a **typed demo
  array** inline (seeded from the template's `text`/`apiHint`) and mark the API seam with a
  comment (`// TODO(api): replace with real data source`). Always add an **empty-state**
  fallback. Position each instance from `node.instanceOffsets[i]` as a **BEM modifier class**
  `&__<el>--1..N` in SCSS (not inline style), applied by index — never rebuild positions with
  flex `gap`. Each `instanceTemplate` child follows the asset/text rules below, placed inside
  one instance by its `bounds` — **except** an instance index present in that child's
  `boundsOverride` map (`{ "<instanceIndex>": {x,y,w,h} }`, 0-based, only set when needed):
  use the override's `x/y/w/h` for that instance only, nested under its own `--N` selector
  (e.g. `&__<el>--N .<child>` or `&-N .<child>`). Some lists have genuine per-instance
  geometry (a perspective/size difference drawn in the PSD itself, not just position) that
  one shared `bounds` can't represent — `boundsOverride` is only present when it does; most
  lists won't have it at all. `boundsOverride` never carries rotation/skew (Photoshop
  doesn't retain an angle once a raster transform is committed, so the pipeline can't
  extract one) — for any instance that has an override, also glance at the preview for
  that specific instance: if it looks visibly tilted compared to the others (not just a
  different size), add a `transform: rotate(<deg>deg)` on that instance's `--N` override by
  eye, the same way you already read every other visual detail off the preview.
- **Nested lists/containers:** an `instanceTemplate` child can itself be a `list`
  (a reward grid inside a card, a star rating, progress pips) or a `container`/`component`.
  Apply these same rules recursively — a nested list becomes a `.map()` inside the outer
  `.map()`, with its own demo array and its own empty-state. Its `bounds`, `instanceOffsets`
  and children's `bounds` are re-based to **its own** origin, not the outer instance's, so
  position the nested box absolutely from its `bounds` and its children from theirs — do not
  add the outer offsets again.
- **role `asset`, subRole `static-asset`:** fixed shared visual. A frame / background /
  decoration → CSS `background: url('/images/<node.image>')`; content sitting in the flow →
  an image tag. `node.image` is the **real cut filename** — read it, never guess. Use the
  preview to decide background vs inline image.
- **role `asset`, subRole `dynamic-image`:** an API-fed slot → image whose `src` is the API
  value (named by `node.apiHint`) with the cut asset (`node.image`) as the **demo fallback**.
- **role `asset`, subRole `static-per-instance`:** N distinct fixed images (`node.images[]`,
  one per instance) → render by data index. Not an API slot.
- **`node.variants[]` (any asset node, orthogonal to `subRole`):** the same element cut a
  second time in a different **state** — `[{ key: "claimed", image: "slug__buc--claimed.png" }]`
  alongside the base `node.image`. Render the base normally, then override it under an
  `is-<key>` state class driven by the item's own flag:
  ```scss
  &__buc { background: url('/images/slug__buc.png'); }
  .is-claimed & { background-image: url('/images/slug__buc--claimed.png'); }
  ```
  Use the real variant image — **never** approximate a state with `filter: sepia()/hue-rotate()`
  when a variant image exists. Add the matching boolean to the demo array (`claimed?: boolean`)
  and mark the item the preview shows in that state. Remember the state class itself is a CSS
  Module: `item.claimed && style['is-claimed']`, never a bare `'is-claimed'` string.
  If `variants[i].image` is `null` the cut failed (the panel reports it under `SKIPPED`) —
  fall back to the base image and **flag it in the Phase 4 report**, don't silently ignore it.
- **role `text`, subRole `text`:** hardcode `node.text` — **except** a section title/subtitle
  block, which uses the project's dynamic-copy idiom if it has one (see exemplar/CLAUDE.md).
- **role `text`, subRole `dynamic-text`:** bind to `node.apiHint`/`node.bind`; `node.text` is
  the fallback default only.
- **Interactive buttons:** follow the exemplar/CLAUDE.md handler pattern (auth guard, lock,
  mutate, unlock) — don't invent your own.

Every image path is flat under `/images/`; every `bounds` is frame-relative px → convert
with the project's viewport helper.

## Phase 4 — Finalize & verify

1. **Title/subtitle self-check** — this is the single rule most often missed. If this
   section has a title/subtitle, re-read what you just wrote and confirm it's bound through
   the project's dynamic-copy idiom (e.g. `getParam(...)` + `sanitizeHTML`), **not** left as
   text baked into a static `background:url()` cut — even when the spec/preview shows it as
   one flattened asset. A baked title can never be edited without a PSD re-cut; if the spec's
   title node is `static-asset`, that is exactly the "static→dynamic promotion" Phase 2 calls
   for, not an exception to it.
2. **Asset-existence check** — grep the code you just wrote for every `/images/<file>`
   reference (`background:url()` and `<img>`/component `src`, including per-instance,
   `--demo` fallbacks and `--<key>` state variants) and confirm each file actually exists
   under `public/images/`. If any is missing, **stop and flag it** — do not report success
   with a dead image reference.
3. Run `bun run generate-css` (regenerates image-derived SCSS from the new filenames).
4. Run `bun run lint` (and `bun run build-f` if you want a fast build check); fix until clean.
5. **Report:**
   - files created;
   - which nodes became demo data / dynamic slots (the `/implement-api` seam);
   - **Phase 2 validation results** — every spec↔preview mismatch you fixed in code
     (static→dynamic promotions, bg↔img, layout), and every **re-cut flag** (things that need
     a `[list]`/`[cmp]` marker + re-cut in PSD because they were baked into one PNG);
   - any spot where the preview was ambiguous and you made a call.

---

## Portability

Nothing above is project-specific: it reads `styleExemplar`, `CLAUDE.md`, `.pts-config.json`,
and the spec **from whatever repo it runs in**. Copy this file into another repo's
`.claude/commands/` and it works there — that repo's exemplar + CLAUDE.md supply the
framework and idioms; Phase 3's rules stay the same.
