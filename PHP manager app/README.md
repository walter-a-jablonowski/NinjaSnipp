# NinjaSnipp Manager

A snippet manager app that has some special features

- File system based, multiple source folders
- Nested includes
- "Soft links": Files and folders can be used multiple times

### URL args

- initially load data folder `index.php?data=Demo%202` (key from config)

### File viewer

The sidebar file tree shows snippets and folders from all source folders of the current data set.

- **Files / Recent tabs** plus search
- **Ordinal prefixes**: a leading two-digit prefix on a name (e.g. `11 Common`, `20 router.yml`) is hidden in the UI but kept on disk. Sorting is by the real (prefixed) name, so the prefixes define the order.
- **Drag & drop reorder**: drag an item above/below a sibling to reorder it *within the same level*. The ordinal prefixes are rewritten on disk to match (across all merged source folders at once); file colors are preserved. Reordering only — items can't be dragged into another folder. Included items (links) can't be dragged.
- **Item menu** (⋮ right of each name):
  - Folder: New Snippet, New Folder, New Link, color swatches, Rename, Open in Explorer, Delete
  - File: color swatches, Rename, Open in Explorer, Delete
  - Link (included item): New Snippet/Folder/Link (for included folders) and **Remove link** (deletes only the empty `INCLUDE` marker, never the target)
- **Top "New…" dropdown** (right of the Files/Recent tabs): New Snippet, New Folder, New Link at the root level
- **Color tagging**: pick a swatch in the menu to tag a file/folder; stored in `.sys/ninja.json` (palette per theme in settings)
- When a name exists in several merged sources, create/color/rename actions ask for / apply to the relevant source(s) — see `foldersMerged` below

### `foldersMerged` modes (`nav.foldersMerged` in settings)

| Aspect | `false` (default) | `true` |
|---|---|---|
| **Same-name folders** | Last source wins, one entry shown | Merged into one tree entry |
| **Same-name files** | Last source wins, one entry shown | All shown as separate entries |
| **Folder icon** | Normal folder icon | `bi-folder-symlink` icon |
| **Source label in menu** | Shows one source label | Shows all source labels joined with `&` |
| **Create file/folder** | In current base or root select | Same; select shows all bases at root |
| **Rename folder** | Renames in one base | Renames in all bases in parallel |
| **Delete folder** | Deletes in one base | Deletes in all bases in parallel |
| **Set color** | Written to one base `.sys/ninja.json` | Written to all bases `.sys/ninja.json` |
| **Open in Explorer** | Single menu item | Sub-menu entry per base |

### File system include feature

Combined base folders: cmn plus detail (see settings)

- File: `11 INCLUDE error-handling`
- Folder: `11 INCLUDE common`
- current data folder only
- the target is resolved by name at a source root (any ordinal prefix on the marker is ignored)
- create/remove via the file viewer menus (**New Link** / **Remove link**), or by adding/deleting the marker file directly

### File format

version 3

```yml
id:                     # Snipp and and version
version: 3              # Snipp file version
sc:                     # Shortcut for use in a Win app
short:                  # Short desc
usage:                  # Full text or yml keys
  head: |               # Common information to show above the vars
    Why/when use this prompt? (Token usage: ?)

    - Main Feature
  maybe:                # Optional include prompt portions (MAYBE-syntax)
    myVar: explanation
  vars:                 # Placeholders use in snippet
    myVar: explanation
  text: |               # Explaination with default headlines


                        # v prompt usage information
    ### Usage           # How to use the prompt

    -

    ### Limitations

    - Known issues

    <secondary>         # Text below this rendered grey ("promot deveopment information")

    ### Features details

    - Features details

    ### Prompt output handling

    - Example output
    - How to use...

    -- Tasks (color: red) --------   # Things that need to be worked on in this prompt

    -- Dev --------

    ### How it works

    - How it works and why the prompt was made this way
    - Misc detail explaination

    ### Made with       # How the prompt was made

    LLM:

    > You are a highly skilled developer and prompt engineer...

    ### Changelog

    - 1.0:

content: |    # Snippet
```

#### Required vs. optional fields

Only `content` is enforced. The editor blocks saving when `content` is empty (`Content is required`). All other fields are optional: the loader (`SnippetManager::loadSnippet`) and saver (`SnippetManager::saveSnippet`) do no field validation, and the preview renders every field conditionally (missing fields are simply skipped or default to empty).

| Field | Required | Coemmnts |
|---|---|---|
| `content` | **Yes** | Save is rejected if empty (`md` and `yml`) |
| `id` | No | Rendered only if present |
| `version` | No | Not validated or enforced |
| `sc` | No | Saved as empty string when blank |
| `short` | No | Rendered only if present |
| `usage` | No | Whole block optional; saved as empty string when blank |
| `usage.head` | No | Rendered only if present |
| `usage.maybe` | No | Rendered only if present |
| `usage.vars` | No | Rendered only if present |
| `usage.text` | No | Rendered only if present |

### Placeholders

- `{{placholder}}`
- `{{placholder=default}}`
- `{{placholder=one|two|three}}`
  - first currently is default
- `{{include: "Snippet name"}}`
- Optional text:
  ```
  {{ MAYBE: SomeName }}
  Some optional text
  {{ END-MAYBE }}
  ```
- Optional text (inline): is merged in one line
  ```
  Before
  {{ MAYBE: SomeName }}
    Some optional text
  {{ END-MAYBE }}
  behind
  ```
- Trick for optional text: `{{optional=My optional text}}`

### Sample

![alt text](misc/img.png)


LICENSE
----------------------------------------------------------

Copyright (C) Walter A. Jablonowski 2025, free under the [MIT license](LICENSE)

This app is build upon PHP and free software (see [credits](credits.md)).

[Privacy](https://walter-a-jablonowski.github.io/privacy.html) | [Legal](https://walter-a-jablonowski.github.io/imprint.html)
