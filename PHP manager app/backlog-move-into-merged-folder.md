Debug files:

- PHP manager app\data\cmn\sub
- PHP manager app\data\demo_data_1\sub

What happends if links are moved, will that work?


# Backlog: Move a file/folder into a (merged) sub-folder via drag & drop

**Status:** Deferred / backlog
**Related:** Same-level drag-and-drop reordering (already implemented in `controllers/file-tree.js` + `SnippetManager::batchRename`).

## Goal

Extend drag-and-drop so a file/folder can be **moved into another folder** (a different
level), not just reordered within its current level. Because folders can be **merged**
across multiple source folders (`dataPaths`), the physical destination is ambiguous, so an
**overlay popup** (context-menu style) appears on drop to let the user pick the destination
source.

## The core problem

A merged folder node carries `mergedBases: [pathA, pathB, …]` — it exists physically in
several source folders. Reordering only rewrites ordinal prefixes *in place*, so it never
had to choose a source. Moving an item *into* a merged folder must choose one physical
destination, which is not derivable — hence the popup.

## 1. Drop gesture: "into" vs "reorder"

Today `handleDragOver` only accepts a target with the **same parent** and uses the
top/bottom half of the row → `before` / `after`. To add "move into", split a **folder**
row into three zones:

- top ~25% → reorder `before`
- bottom ~25% → reorder `after`
- middle ~50% → **into** (highlight the whole row, e.g. a `drag-over-into` ring class)

File rows keep just before/after. Standard tree-DnD convention; coexists with the existing
reorder feature. The same-level restriction is lifted **only** for the "into" gesture.

## 2. The popup

On drop-into:

- **Single-source target** (`mergedBases` absent or length 1) → no ambiguity, move directly,
  **no popup**.
- **Merged target** (length > 1) → show a small floating menu at the cursor (an
  absolutely-positioned `.dropdown-menu show` appended to `body`), listing each base as a
  choice, labeled via the existing `baseFolderLabels` / `getBaseFolderLabels()`
  (e.g. "Common", "Demo1"). Click a row → perform the move; click-outside / Esc → cancel.

Pre-highlight the base that matches the dragged item's own source (`node.basePath`) as the
least-surprising default ("keep it in the same source unless you say otherwise").

No existing floating-menu helper to reuse (the `search.js` context menu is a stub), but it's
~30 lines. The global `document.click` handler in `controller.js` already ignores
`.dropdown-menu`, so it won't fight an open popup.

## 3. Backend needs (the harder half)

The current `renameItem` assumes **one base** for both old and new. A move needs **separate
old/new bases**, so add a `moveItem` action taking `{ oldBase, oldPath, newBase, newPath,
type }`. Key complications:

- **Cross-volume moves are real here.** Live data sets put sources on `G:` (Google Drive)
  while the demo is on `C:`. PHP `rename()` fails across volumes on Windows. So `moveItem`
  needs a **recursive copy + delete fallback** (we already have `deleteFolderRecursive`; add
  a `copyRecursive`). This is the single biggest correctness item — a plain `rename()` would
  silently fail for the real folders.
- **Color metadata migration.** A file's color lives in the *parent* `.sys/ninja.json` keyed
  by filename, so a move must delete it from the old parent and write it to the new parent's
  `.sys` (reuse the `migrateFileColorKey` logic). A folder's `.sys` travels inside it
  automatically.
- **Collision handling.** The chosen base, *or another base of the merged target*, may
  already hold a same-named item. Even if the chosen base is free, dropping next to another
  base's copy turns it into a "duplicate file" in the merged view (the `#idx` path case).
  Decide: reject, or auto-suffix.

## 4. Edge cases to nail down

- **Moving a *merged* folder into another folder** is doubly ambiguous (which source copies
  move?). Restrict v1 to moving plain files and single-source folders; block dragging a
  merged folder *into* something (still reorderable in place).
- **Cycle prevention** — can't move a folder into its own descendant (`newPath` must not be
  under `oldPath`).
- **No-op** — dropping into the folder it already lives in.
- **Included items** (`isIncluded`) — already non-draggable; keep them so.
- **Prefix on landing** — does the moved item keep its prefix, get a fresh "next" prefix at
  the destination's tail, or lose it? (Decision below.)
- **State restore** — path changes; after move, expand the destination and re-highlight by
  the new path. The existing `_remapPaths` only handles same-level renumber; a move needs its
  own remap.

## 5. Recommended scope for a first cut

Files and single-source folders; popup only when the target is merged; copy+delete fallback
for cross-volume; color migration; cycle/no-op/collision guards; merged-folder *sources*
deferred.

## Open decisions

1. **Landing position/prefix:** keep existing name, or append at destination tail with the
   next ordinal (consistent with the reorder feature)? Leaning toward appending with a fresh
   prefix.
2. **Collision policy:** reject with a message, or auto-suffix (` 2`)?
3. **Popup scope:** only on ambiguity (merged target), or always show it as a confirmation
   step even for single-source targets?
4. **Default base:** pre-select the dragged item's own source (suggested) vs. always force an
   explicit pick.
