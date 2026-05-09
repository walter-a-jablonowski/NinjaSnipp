# NinjaSnipp

A snippet manager app that has some special features

- File system based, multiple source folders
- Nested includes
- "Soft links": Files and folders can be used multiple times

### File system include feature

Combined base folders: cmn plus detail (see settings)

- File: `11 INCLUDE error-handling`
- Folder: `11 INCLUDE common`
- current data folder only

### File format

version 2

```yml
id:                     # Snipp and and version
version:                # Snipp file version
sc:
short:                  # short desc
usage:                  # Full text or yml keys
  head: |               # Common information to show above the vars
  maybe:                # Optional include prompt portions (MAYBE-syntax)
    myVar: explanation
  vars:                 # Placeholders use in snippet
    myVar: explanation
  text: |               # Explaination with default headlines
    ### TASKS

    ### Usage

    - Token usage: ?

    ### Features

    <secondary>         # Text below this rendered grey

    ### Explaination

    ### Made with

    > You are a highly skilled developer and prompt engineer.

    LLM:

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

### Misc

- initially load data folder `index.php?data=Demo%202` (key from config)

### Sample

![alt text](misc/img.png)


LICENSE
----------------------------------------------------------

Copyright (C) Walter A. Jablonowski 2025, free under the [MIT license](LICENSE)

This app is build upon PHP and free software (see [credits](credits.md)).

[Privacy](https://walter-a-jablonowski.github.io/privacy.html) | [Legal](https://walter-a-jablonowski.github.io/imprint.html)
