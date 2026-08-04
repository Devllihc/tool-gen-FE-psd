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
     state/loading idioms, image/text helpers. The exemplar is how a section is written
     *here*; match it.
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
- **role `container` / `component`:** a layout box. `layout.direction` `row`/`column` →
  flexbox; `absolute` → position children by `bounds`, but obey CENTER-THE-FRAME. `layout`
  is only a hint — trust the preview.
- **role `list`:** render **inline** with `data.map((item, i) => …)`. Declare a **typed demo
  array** inline (seeded from the template's `text`/`apiHint`) and mark the API seam with a
  comment (`// TODO(api): replace with real data source`). Always add an **empty-state**
  fallback. Position each instance from `node.instanceOffsets[i]` as a **BEM modifier class**
  `&__<el>--1..N` in SCSS (not inline style), applied by index — never rebuild positions with
  flex `gap`. Each `instanceTemplate` child follows the asset/text rules below, placed inside
  one instance by its `bounds`.
- **role `asset`, subRole `static-asset`:** fixed shared visual. A frame / background /
  decoration → CSS `background: url('/images/<node.image>')`; content sitting in the flow →
  an image tag. `node.image` is the **real cut filename** — read it, never guess. Use the
  preview to decide background vs inline image.
- **role `asset`, subRole `dynamic-image`:** an API-fed slot → image whose `src` is the API
  value (named by `node.apiHint`) with the cut asset (`node.image`) as the **demo fallback**.
- **role `asset`, subRole `static-per-instance`:** N distinct fixed images (`node.images[]`,
  one per instance) → render by data index. Not an API slot.
- **role `text`, subRole `text`:** hardcode `node.text` — **except** a section title/subtitle
  block, which uses the project's dynamic-copy idiom if it has one (see exemplar/CLAUDE.md).
- **role `text`, subRole `dynamic-text`:** bind to `node.apiHint`/`node.bind`; `node.text` is
  the fallback default only.
- **Interactive buttons:** follow the exemplar/CLAUDE.md handler pattern (auth guard, lock,
  mutate, unlock) — don't invent your own.

Every image path is flat under `/images/`; every `bounds` is frame-relative px → convert
with the project's viewport helper.

## Phase 4 — Finalize & verify

1. Run `bun run generate-css` (regenerates image-derived SCSS from the new filenames).
2. Run `bun run lint` (and `bun run build-f` if you want a fast build check); fix until clean.
3. **Report:**
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
