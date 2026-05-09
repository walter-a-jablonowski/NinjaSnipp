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

version 3

```yml
id:                     # Snipp and and version
version: 3              # Snipp file version
sc:                     # Shortcut for use in a Win app
short:                  # Short desc
usage:                  # Full text or yml keys
  head: |               # Common information to show above the vars
    Why/when use this prompt?

    - Main Feature

    Token usage: ?
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

### Misc

- initially load data folder `index.php?data=Demo%202` (key from config)

### Sample

![alt text](misc/img.png)


LICENSE
----------------------------------------------------------

Copyright (C) Walter A. Jablonowski 2025, free under the [MIT license](LICENSE)

This app is build upon PHP and free software (see [credits](credits.md)).

[Privacy](https://walter-a-jablonowski.github.io/privacy.html) | [Legal](https://walter-a-jablonowski.github.io/imprint.html)
