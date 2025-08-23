# Snippet Manager App

Snippets are managed in a data folder(s) (currently /data) one yml file per snippet. Snippets may be organized in sub folders. We can have multiple data folders.

Data format:

```yml
# File name is used as the name of the snippet

sh:      arrf--  # short code
usage: |

  comments, usage and sample ...

content: |

  Some {var} snippet ...
```

### Features

- Placeholder System
  - placeholders (`{placholder}`)
  - default values (`{placholder=default}`)
  - choice (`{placholder=one|two|three}`)
  - same placholder may appear multiple times (with different default values)

- Snippet Composition
  - snippet inclusion system (`{include: "Snippet name"}`)
  - because the file name is used to identify the snippet we must update the snippets each time we change the name

### User interface

- Header
  - App logo (icon) and app title
  - search field: full-text search including search history, fuzzy search
- Main content
  - Left side: Navigation bar (slides in on smartphones), contains:
    - The user can choose which data folder to use (dropdown)
    - Tab control
      - List of files and folders of the current level of the data folder
        - Create, edit, delete, duplicate snippets
        - Bulk operations (delete, move, tag multiple)
      - Recent snippets list (last one first)
  - Right side: snippet content
    - Tab control
      - Edit tab
        - if we load a yml file: form view
          - name
          - sh
          - usage
          - content
        - or if we load a md file: edit view
          - file name
          - content
      - Rendered view (unavailable for md files)
        - shows the rendered snippet with included content (if there are include placeholders)
        - use tab to fill in placholders
        - use default if user tabs over a placeholder
        - copy button

Use bootstrap 5.3 and improve the look using own styles to make it look nice. Make it look good on all devices.
