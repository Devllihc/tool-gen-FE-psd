---
description: Refine the structural classification in plan.json (subRole/apiHint on ambiguous nodes) using the PTS plugin's exported preview image, before reviewing/cutting in the Photoshop panel — the interactive counterpart to `bun run gen-section --plan`.
argument-hint: <slug or path to raw-tree.json, e.g. frame8 or .pts-cache/frame8/raw-tree.json>
allowed-tools: Read, Write, Glob
---

# /gen-plan

Refine the **structural classification** the PTS plugin computed at Analyze time —
`raw-tree.json` — into a tinh chỉnh `plan.json`, using the exported preview image as
ground truth. This is the interactive counterpart to `bun run gen-section --plan <slug>`
(which now just delegates here non-interactively); it supersedes duplicating these rules
inside `tools/gen-from-psd/plan.js`.

**Input:** `$ARGUMENTS`

This step is **optional** in the PSD→React pipeline: `classifyList.js` (inside the
Photoshop plugin) already computes a structural `subRole` for every asset/text node
**blind to the rendered image** — it only compares name/size/text across list instances.
This command is the one step in the whole pipeline that looks at the **preview image**
before cutting, so use it when Analyze left many nodes `needsReview: true` and you'd
rather have an informed pass before eyeballing every card by hand in the panel.

> **Standing rule — refine, never restructure.** This command does not add, remove,
> split, or merge nodes — it only adjusts `subRole`/`apiHint`/`needsReview`, and may attach
> a `variants` array to an existing `asset` node (Phase 2b), on the tree that already
> exists. A missed list/component boundary is out of scope here; that can only be fixed by
> re-running Analyze in Photoshop with a `[list]`/`[cmp]` marker.

## Phase 0 — Resolve the raw tree

1. `$ARGUMENTS` may be a **path** to `raw-tree.json` or a bare **slug**.
   - If it resolves to an existing file, that's the raw tree.
   - Otherwise treat it as a slug: raw tree = `.pts-cache/<slug>/raw-tree.json`.
   - If neither exists, list `.pts-cache/*/` and **stop** — run "🔍 Phân tích cấu trúc" in
     the Photoshop panel first.
2. `<cacheDir>` = the raw tree's parent folder. `planPath` = `<cacheDir>/plan.json`.

## Phase 1 — Read the ground truth

1. Read the raw tree JSON at the resolved path.
2. **Read the preview image** at `<repo root>/<rawTree.previewImage>` — this is what lets
   you do better than the plugin's blind structural comparison.

## Phase 2 — Classify (refine, do not replace, the existing tree)

Write the **complete** result — every existing field preserved unchanged
(`projectName`, `sectionName`, `slug`, `viewport`, `source`, `previewImage`, and every
`layerId`/`bounds`/`name`/`text`/`style`/`bind`/`count`/`instanceOffsets`/`instanceLayers`/
`instanceTemplate` in `root`) plus your additions.

- The tree already carries a `subRole` on every `asset`/`text` node and on every
  `instanceTemplate.children` node, computed structurally. **Respect it.** Only change a
  node's `subRole` if its `needsReview` is `true` (the structural signal was ambiguous) or
  it is obviously wrong against the preview image.
- Allowed `subRole` values for an `asset` node: `static-asset`, `dynamic-image`,
  `static-per-instance`. `static-per-instance` = a per-instance-distinct fixed image; keep
  it unless the project treats such images as API data. For a `text` node: `text`,
  `dynamic-text`.
- For any node with `needsReview: true`, decide its `subRole`, set `needsReview: false`,
  and add a one-line `reviewReason` explaining the call.
- For every node whose final `subRole` is `dynamic-image`/`dynamic-text`, suggest a short
  camelCase `apiHint` (e.g. `itemImg`, `milestoneNo`) when none is set. **Never** override
  an existing `bind`/`apiHint` that came from an explicit `[bind:xxx]` marker — that is
  ground truth.
- `list` nodes: walk `instanceTemplate.children` and apply the same rules per child.
  `container`/`component` nodes pass through unchanged — do not alter `layout` or the
  child list itself.
- Heuristics: a field/image that visibly differs across list instances (different photo,
  different number) is very likely dynamic; a field/image identical across all instances
  (frame, icon, static label) is static; text that looks like sample/placeholder data is
  likely dynamic. When genuinely unsure, **keep** `needsReview: true` with a one-sentence
  `reviewReason` — never guess silently.
- Add or refresh a top-level `tasks`: `string[]` — one short line per component/asset
  group (e.g. `"PlayerRow: props { avatarUrl, score } — both dynamic, from list.instances"`).

## Phase 2b — State variants (the one thing structural analysis can never see)

`classifyList.js` compares list instances by **layer name, size, and text only** — never by
pixel colour or style. So a position that is the *same layer, same size, same name* but
**drawn differently per state** (a podium gray while locked and gold once claimed, a card
dimmed vs lit, a button grayed vs active) is permanently invisible to it: every instance
collapses into one shared `static-asset` and only one gray image gets cut. The preview
image is the only place that difference exists, which makes this **your** job, not the
plugin's.

For each `list` node:

1. Look at every instance in the preview, at that list's `bounds` + `instanceOffsets`.
2. Ask whether any instance is **visually a different state** of the same thing — not
   different *data* (a different photo or number → that's `dynamic-image`/`dynamic-text`,
   handled in Phase 2), but the same artwork in a different colour/treatment.
3. If so, find the layer in that instance's roster: the list node carries
   `instanceLayers` — one array per instance, in instance order, each entry
   `{ name, layerId, kind, bounds }` (recursive via `children`), with `bounds` relative to
   that instance's own origin, same as `instanceTemplate.children`.

   **Match by `name` (+ `bounds` to disambiguate), never by array index** — an instance in a
   different state often carries an extra layer (a ribbon, a badge), which shifts every
   later index by one.
4. Attach the variant to the corresponding `instanceTemplate.children` node:

   ```jsonc
   { "role": "asset", "name": "BỤC", "layerId": 30535, "subRole": "static-asset",
     "variants": [ { "key": "claimed", "layerId": 30702 } ] }
   ```

   The cutter emits a second image alongside the base one, sharing its name:
   `frame2suutapthe__buc.png` + `frame2suutapthe__buc--claimed.png`.

Rules:

- `key` names the **state**, lowercase kebab-case (`claimed`, `locked`, `active`,
  `sold-out`) — never an index like `item8`. `/gen-section` turns it into an `is-<key>`
  class, so the name has to read as a state in the generated code.
- `layerId` must be a **different** layer from the node's own `layerId`, and must come from
  `instanceLayers` — do not invent or guess an id.
- Only for genuine **state** differences. If every instance differs (8 different card arts),
  that's `static-per-instance`, not variants — and the two are mutually exclusive; the
  panel's `validatePlan` rejects the combination.
- Add a `reviewReason` on the node saying which instance you took it from and what you saw,
  so the reviewer can check your call against the preview.
- If you can see a state difference but **cannot** confidently identify the layer in
  `instanceLayers`, add no variant — set `needsReview: true` and say so in `reviewReason`.
  A wrong `layerId` cuts the wrong artwork silently.
- No `instanceLayers` on the list node → the plan came from an older Analyze. Say so in the
  report and tell the user to re-run 🔍 Phân tích cấu trúc; do not fabricate ids.

## Phase 3 — Write & report

1. Write the complete JSON to `planPath` with the Write tool. Do not print the JSON in
   your response — just write the file.
2. **Report:**
   - how many `needsReview` nodes were resolved, with their `reviewReason`;
   - which `apiHint`s were added;
   - every `variants` entry you added — node, `key`, which instance you took the `layerId`
     from, and what you saw in the preview that justified it;
   - any node **left** `needsReview: true` because the preview didn't settle it either.
   - Tell the user to reopen the Photoshop panel and click **🔄 Tải lại** to pick up the
     refined plan before cutting.

---

## Portability

Nothing above is project-specific — it only reads `raw-tree.json` and the preview image
path it points to. Copy this file into another repo's `.claude/commands/` and it works
there unchanged.
