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
> split, or merge nodes — it only adjusts `subRole`/`apiHint`/`needsReview` on the tree
> that already exists. A missed list/component boundary is out of scope here; that can
> only be fixed by re-running Analyze in Photoshop with a `[list]`/`[cmp]` marker.

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
`layerId`/`bounds`/`name`/`text`/`style`/`bind`/`count`/`instanceTemplate` in `root`) plus
your additions.

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

## Phase 3 — Write & report

1. Write the complete JSON to `planPath` with the Write tool. Do not print the JSON in
   your response — just write the file.
2. **Report:**
   - how many `needsReview` nodes were resolved, with their `reviewReason`;
   - which `apiHint`s were added;
   - any node **left** `needsReview: true` because the preview didn't settle it either.
   - Tell the user to reopen the Photoshop panel and click **🔄 Tải lại** to pick up the
     refined plan before cutting.

---

## Portability

Nothing above is project-specific — it only reads `raw-tree.json` and the preview image
path it points to. Copy this file into another repo's `.claude/commands/` and it works
there unchanged.
