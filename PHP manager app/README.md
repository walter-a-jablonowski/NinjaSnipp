# NinjaSnipp Manager

A snippet manager app that has some special features

- File system based, multiple source folders
- Nested includes
- "Soft links": Files and folders can be used multiple times

### URL args

- initially load data folder `index.php?data=Demo%202` (key from config)

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

    -- Tasks (color: red) --------   # Things that eed to be worked on in this prompt

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
