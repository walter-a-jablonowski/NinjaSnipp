# AI sidebar: implementation plan

Status: phases 1-4 done (backend, sidebar, Claude Code, undo + "Just do it" + web search); next: 5 (quick prompts).

Deviations from the plan made while building it:

- Tool loop with native function calling (as overview), not HalfDoneHero's `[TOOL:...]` text lines
- Proposals are guarded per change, not by an md5 of the whole file: `snippet_update` by the
  fields it sets, `snippet_delete` by the file, `snippet_edit` by its own "old text occurs once"
  check. Two proposals of one answer touching the same snippet both apply.
- Found and fixed on the way: includes right below a MAYBE block or as its first line were not
  resolved in the inline view (`Renderer::process()`); the search did not look at `short`

The plumbing (providers, Claude Code, sessions, approval, undo) is taken from the AI sidebars of
grid-view, HalfDoneHero and overview. NinjaSnipp follows the **overview / HalfDoneHero design**:
every write tool becomes a *proposal* that the user accepts or rejects, for every provider,
Claude Code included. grid-view's way (the CLI writes itself, plan overlay `#gridPlanModal`) is
not adopted. The **use cases and tools are NinjaSnipp's own**: those apps are boards, this is a
prompt and snippet library.

Out of scope: plan overlay and dependency cascade, routines, `remember` (memory), attachments,
report modal.


## Use cases

What a user of a snippet library typically wants, and the tools that serve it. The library is
mostly prompts (see `data/Prompt_demo` and the real data sets), code templates second.

### A. Find and pick

| Use case | Tools |
|---|---|
| "Do I have a prompt for X?" / "which one fits my task best?" (by intent, not by word) | `tree_list` (with `short`), `snippet_search`, `snippet_get` → `show_items` |
| "Which snippets use placeholder FILE / include *Style Guide* / have open tasks?" | `snippet_search`, `snippet_usages` → `show_items` |
| "The prompt I used yesterday" | `recent_get` |
| "Open the LinkedIn prompt" | `snippet_open` |

### B. Use a snippet

| Use case | Tools |
|---|---|
| "Fill this prompt for my task: ..." (choose values and MAYBE blocks from a task description), then copy in the app as always | `snippet_get`, `form_fill` |
| "Give me the final prompt for ..." (rendered text in the reply, copy button) | `snippet_render` |
| "What does this snippet do, how do I use it, what do the options mean?" | `snippet_get` |
| "Try it": a dry run of the rendered prompt, the sidebar model answers it to show what it produces | `snippet_render` |

### C. Write and improve prompts

| Use case | Tools |
|---|---|
| "Turn this text into a snippet": find the variable parts and make them placeholders (defaults, choice lists), optional parts MAYBE blocks, document `vars` / `maybe` | `snippet_create` |
| "Improve / shorten / restructure / translate this prompt" | `snippet_get`, `snippet_edit` / `snippet_update` |
| "Review this prompt" (critique only, no change) | `snippet_get`, `snippet_render` |
| "Make a variant for ..." | `snippet_duplicate` + `snippet_edit` |
| "Compare *Feature* and *Feature 2*", "merge them into one" | `snippet_get` (several), `snippet_update`, `snippet_delete` / `item_move` |
| "Move the common part into its own snippet and include it everywhere" | `snippet_create`, `snippet_edit` per user, `snippet_usages` |

### D. Keep the documentation in order (format v3)

| Use case | Tools |
|---|---|
| "Document the placeholders", "write the usage text / short / head" | `snippet_check`, `snippet_update` |
| "Add a changelog entry for this revision", "note how it was made", "add a task" (sections of `usage.text`) | `snippet_edit` |
| "Suggest a shortcut (`sc`)" (unique in the data set, for the Win app) | `snippet_check`, `snippet_update` |
| "Which snippets still have an old file format?" (only reported: the migration is done outside the app, the AI doesn't migrate or change `version`) | `snippet_check` |
| "Check my snippets" (folder or whole data set): undocumented / unused placeholders, MAYBE names, unbalanced MAYBE tags, broken includes, missing `short`, duplicate `sc` or `id`, a file format below the current one, files that don't parse | `snippet_check` |

### E. Organize the library

| Use case | Tools |
|---|---|
| "Sort these into folders", "create a folder Reviews for them" | `folder_create`, `item_move` |
| "Rename them consistently" (includes by name are named in the proposal and fixed along) | `item_rename`, `snippet_usages`, `snippet_edit` |
| "Find duplicates / old versions", "archive or delete them" | `snippet_get`, `item_move`, `snippet_delete` |
| "Mark all prompts with open tasks red" | `snippet_search`, `item_color` |
| "Use the Common folder in Dev too" (INCLUDE link) | `link_create` |

### F. Questions about the app

"How do MAYBE blocks work", "what is a link", "what is `foldersMerged`": answered from the
system prompt, which carries a short version of the README (format, placeholders, includes,
links, ordinal prefixes, sources). No tool.


## Tools

Tools work in the **current data set**. They address items by their **tree path** (what
`FileTree::listFiles()` returns as `path`: real names, ordinal prefixes included); the server
resolves it to the file on disk, links and merged folders included, so the model never sees
absolute paths. Where a name exists in several sources the item lists them as `sources`
(labels like `Common`, `Dev`), and a write tool needs `source` then; an ambiguous call is
refused with an error that names them.

Read tools run at once. Write tools are checked first (arguments, target exists / does not
exist, `old` found exactly once ...): a bad call gets an error result so the model corrects it
in the same turn, a good one becomes a proposal. Client tools act in the sidebar or the editor
and change nothing on disk.

### Read

| Tool | Args | Returns |
|---|---|---|
| `sources_get` | | current data set, its sources with the data sets sharing them, `foldersMerged`, the other data sets |
| `tree_list` | `path?`, `depth?` (default 2, max 5) | items: `name` (display, no prefix), `path`, `type`, `sources`, `link` (target), `color`, `short` |
| `snippet_search` | `query` | ranked hits: `path`, `name`, `short`, which fields matched (not the whole snippet) |
| `snippet_get` | `paths[]` (max 20) | per snippet: all fields, type, source, placeholders (name, default, choices), MAYBE names, includes (resolved or broken) |
| `snippet_usages` | `path` | snippets that include it by name, link markers pointing at it |
| `snippet_render` | `path`, `values?`, `maybeOff?[]` | the final text: includes resolved, MAYBE blocks (on unless named), placeholders filled |
| `snippet_check` | `path?` (snippet or folder, recursive; default: data set) | problems per snippet (list in use case D) |
| `recent_get` | | recently opened snippets of this data set, newest first |

### Write (proposals)

| Tool | Args | Applied by |
|---|---|---|
| `snippet_create` | `path`, `type` (yml / md), `fields`, `source?` | `SnippetStore::save(createOnly)` |
| `snippet_update` | `path`, `fields`: dotted keys `content`, `short`, `sc`, `id`, `usage.head`, `usage.text`, `usage.vars.NAME`, `usage.maybe.NAME` ...; only the given ones change, `null` removes | `SnippetStore::save()` |
| `snippet_edit` | `path`, `edits: [{field, old, new}]`, each `old` occurring once | `SnippetStore::save()` |
| `snippet_duplicate` | `path`, `newPath` | `SnippetStore::duplicate()` |
| `snippet_delete` | `path` | `SnippetStore::delete()` |
| `folder_create` | `path`, `source?` | `FileOperations::createFolder()` |
| `link_create` | `folder`, `target` | `FileOperations::createLink()` |
| `item_rename` | `path`, `newName` (same folder) | `FileOperations::rename()` (all sources of a merged folder) |
| `item_move` | `path`, `toFolder` | `FileOperations::rename()` |
| `item_color` | `path`, `color` (palette name, '' clears) | `ColorStore` |

`snippet_edit` sits beside `snippet_update` because prompts are long: a change of a few lines
shouldn't resend the whole content, the replacement gives a precise diff, and several edits of
one snippet stay one row.

Deliberately not offered: deleting folders and removing links (too destructive / too rare for
an assistant), reordering (the renumbering lives in `controllers/file-tree.js` and would need a
PHP twin; can come later by moving `planReorder` server-side).

### Client (no proposal, nothing written)

| Tool | Args | Effect |
|---|---|---|
| `show_items` | `title?`, `items: [{path, note?}]` | clickable list below the reply, a click opens the snippet; an entry that no longer exists is greyed out |
| `snippet_open` | `path` | opens the snippet in the editor |
| `form_fill` | `path`, `values`, `maybeOff?[]` | opens the snippet if needed and fills the preview's placeholder inputs and MAYBE switches; a note line "Filled 5 placeholders" with *Fill again*. The user checks and copies as usual. |

### What every proposal carries

Built **server-side** from the files, never from the model's prose:

- `label`: one line for the row ("Edit content of *LinkedIn post*")
- `preview`: per changed field `{before, after}`; the sidebar draws a line diff from it
- `warnings`, e.g.
  - rename / move / delete of a snippet that others include by name: "*3 snippets include it*:
    ..." (the system prompt tells the model to propose the include edits along)
  - a change in a source that several data sets share: "in *Common*, used by Dev and Biz too"
- `hash`: md5 of the target at proposal time. Apply refuses when the file changed since
  ("changed since proposed, ask again"), so the AI never overwrites an edit made meanwhile.

### Changes to existing code

- `Renderer::render()` keeps every MAYBE block today; it gets the names to leave out (the
  preview switches exist only in JS so far)
- The name matching of includes (`Renderer::findByName()`) becomes usable from outside, so
  `snippet_usages` and the rename warning follow the one rule the renderer uses
- `FileOperations::rename()` carries the color along only inside one folder; a move has to
  carry it too
- **One snippet template** (the current format, `BLANK_SNIPP.yml` of the user's data) moves into
  the app as `snippet_template.yml`. `snippet_create` starts from it, and so does the UI's
  New Snippet, which today writes a bare `content` + `sc` + `usage: ''`
  (`controllers/editor.js > createSnippet()`). The README's file format section points to it
  instead of keeping a second copy
- `SnippetStore::duplicate()` gives the copy a new `id` (today's date, next free number), for
  the UI's Duplicate (⋮ menu of the editor) and `snippet_duplicate` alike; today it copies the
  file unchanged
- `snippet_check` parses placeholders in PHP, the usage form does it in JS
  (`extractContentVars()` / `extractContentMaybes()`): its cases go into
  `tests/fixtures/placeholders.json`, so both stay in sync like the parser already does


## System prompt

`lib/Ai/AiPrompt.php`, in this order:

- what NinjaSnipp is, and the short README version (placeholders, MAYBE, include, INCLUDE
  links, ordinal prefixes, sources)
- the snippet template (`snippet_template.yml`) as the format reference: head, `maybe` /
  `vars`, and the sections of `usage.text` (Usage, Limitations, `<secondary>`, Features
  details, Prompt output handling, `-- Tasks --`, `-- Dev --`, How it works, Made with,
  Changelog)
- conventions the model must keep:
  - `id` identifies the prompt (`YYYY-MM-DD.NN-V1`) and **never changes**. A new snippet gets
    one with today's date and the next free number of that day in the data set; so does a
    variant made with `snippet_duplicate`, since it is a new prompt
  - `version` is the **file format** version; it changes only when a file is migrated to a
    newer format, which happens outside the app. The AI never changes it, it only reports
    an old one
  - a revision of a prompt is recorded as a changelog entry only (`V1`, `V2` ... / `1.0` ...,
    following what the snippet already uses); neither `id` nor `version` changes
  - `sc` is the Win app shortcut and unique; an include is by name
- `ai.systemPrompt` from `config.yml`
- the mode (Ask first / Just do it) and how approval works
- the current data set and the open snippet (path)


## Server

New code, following the existing structure (`ajax/` handlers returning `action => handler`,
classes in `lib/`):

```
config.yml               ai: provider, model, ollamaUrl, claudeCode, mode, webSearch,
                         systemPrompt, maxSteps, timeout
users/<user>/settings.yml   ai.quickPrompts (per user)
.env                     AI_API_KEY_<PROVIDER> (git-ignored), .env.sample committed
ajax/ai.php              aiChat, aiApply, aiUndo, aiSessions, aiSessionLoad,
                         aiSessionSave, aiSessionDelete
lib/Ai/AiClient.php      OpenRouter / Gemini / Ollama, all normalized to the OpenAI shape,
                         provider choices for the select, .env loading, web search per provider
lib/Ai/AiTools.php       tool registry (schema, kind read | write | client, label),
                         check + preview of proposals, execute(), apply()
lib/Ai/AiCheck.php       the snippet_check rules
lib/Ai/AiPrompt.php      system prompt
lib/Ai/AiClaude.php      Claude Code CLI provider
lib/Ai/AiMcpServer.php   the registry as stdio MCP server
lib/Ai/AiSessions.php    users/<user>/ai_sessions/<id>.json
lib/Ai/AiUndo.php        checkpoints + guarded restore
mcp/ai_tools.php         entry point the CLI starts
```

- `aiChat` runs the agent loop: system prompt + history in, read tools executed, write calls
  collected as proposals, client calls passed through, up to `maxSteps` rounds. Returns
  `{reply, pending[], clientCalls[]}`. No request time limit (`set_time_limit(0)`): a turn
  killed half way loses its result (grid-view lesson); catches are `Throwable`.
- `aiApply` applies one proposal through `AiTools::apply()`, which calls the same
  `SnippetManager` services the UI handlers use. Returns what the client must refresh (tree
  folder, open snippet).
- The request names the data set (`dataPath`, as every ajax call) and the open snippet.


## Claude Code

Copied in design from HalfDoneHero `AiClaude` / `AiMcpServer` (overview has the same):

- `claude -p` per request, stateless (`--no-session-persistence`), the conversation goes in as
  text over stdin, the system prompt as a file (`--system-prompt-file`; Windows command lines
  end at 32k characters)
- The MCP server (`mcp/ai_tools.php`) builds `SnippetManager` for the user and data set it
  gets from the turn folder `cache/ai_turns/<id>/context.json`, answers read tools, and only
  **records** write and client calls (`calls.ndjson`). `aiChat` turns them into the same
  `pending` / `clientCalls` as the API loop, so the sidebar has one code path
- Flags: `--output-format stream-json --verbose`, `--setting-sources ""`, `--tools ""` (only
  `WebSearch,WebFetch` with `webSearch`), `--strict-mcp-config`, `--allowedTools` = our tools
- Refuse the turn unless the init event reports our server `connected` (without tools the CLI
  makes up an answer)
- Windows: `stream_select()` fails on pipes, so poll stdout non-blocking, stderr to a file
- The php cli for the MCP server: config `phpBin`, else resolved, **never `PHP_BINARY`** under
  mod_php. Paths in `--mcp-config` json forward-slashed (`\x` breaks the json)
- Large results: `_meta["anthropic/maxResultSizeChars"]` on the read tools (`tree_list` and
  `snippet_check` of a big data set can pass 50k characters)
- Offered in the provider select only when `ai.claudeCode.enabled` and the CLI is found


## Sidebar (client)

`controllers/ai.js` (`AiController`) replaces the mock and `toggleAiSidebar()`. The markup is
rendered by `index.php` (selects from `config.yml`, quick prompts from the user settings).

- Header: **mode** select (Ask first / Just do it) and **provider** select (only when more than
  one), both stored per session; new session, sessions list (switch, delete)
- Messages as markdown (`marked`, already in `lib/ext`), copy button copying the markdown
- Proposal rows per answer: Accept, Reject, Reject with a note; Accept all / Reject all;
  "Propose again" once all rows are decided and one has a note. Row states and notes are stored
  with the session, undecided proposals come back after a reload
- Diff in an expandable row: line diff of `before` / `after` per field (small diff function in
  `lib/functions.js`, covered by the JS tests); warnings shown on the row
- Hover a row: the item is highlighted in the tree; a click opens it
- Client tools: `show_items` lists, `snippet_open`, `form_fill` (through the existing preview
  code in `controllers/render.js`: `setMaybeState()`, the placeholder inputs)
- Stop while a request runs, Retry on a failed or stopped one
- What the model gets (`AiController.modelMessages()`): each answer followed by what became of
  its proposals (accepted, rejected + note, failed, undone) and of its client calls

**The editor:** before a turn and before applying, the open snippet is saved (it has autosave,
so unsaved editor content would otherwise overwrite an AI change, or the AI would read an old
version). After a change to the open snippet the editor reloads it; after any write the
affected tree folder is reloaded.


## Undo and "Just do it"

- Mode "Just do it": all proposals of an answer are applied at once, then Undo is offered
- Each answer gets a checkpoint (`AiUndo`) the first time one of its changes is applied, in
  `users/<user>/ai_undo/<id>/`, newest 20 kept. Per applied change it records what undo needs:
  a copy of an overwritten or deleted file, a created path, a rename / move old to new, the
  `.sys/ninja.json` of a color change, and the md5 each target has *after* the change
- Undo walks the changes backwards and restores only targets that still have that md5; a
  target changed since is skipped and named, never overwritten
- Undo per answer (button on the answer); undone rows are marked, and the model is told


## Web search

`ai.webSearch`: OpenRouter's `openrouter:web_search` server tool, Gemini's `googleSearch`,
Claude Code's `WebSearch` / `WebFetch`. Not with Ollama. Gemini needs the raw parts of a model
turn sent back unchanged inside the loop (overview `ai_to_gemini_contents()`). Useful here for
"improve this prompt with current best practice for model X".


## Quick prompts

`users/<user>/settings.yml > ai.quickPrompts` (read only for now, an editor may come later):

```yml
ai:
  quickPrompts:
    - label:  Check this snippet
      prompt: "Check the open snippet: placeholders documented, usage complete, format v3."
    - label:  Improve prompt
      prompt: "Improve the open prompt: clearer, shorter, nothing lost. Show what you changed and why."
    - label:  Fill for my task
      prompt: "Fill the open prompt for this task: "
    - label:  Clean up folder
      prompt: "Go through the folder of the open snippet: duplicates, old versions, missing docs. Propose a cleanup."
      mode:   ask
```

The ⚡ menu left of the input, and `/` in the empty input. A pick fills the input and may
switch the mode; it never sends.


## Test cases from the real data (done: all fixed with the sidebar, 2026-10-17)

Found by snippet_check on 2026-10-17 in the three data folders. Phase 2 is done only when the
sidebar has fixed these (proposed, reviewed, applied). Snippets without content are left
alone for now.

- [x] `Common: Wohn/11 Phone.yml`: usage.maybe lists `Bes`, `Int`, the content does not use them
- [x] `Common: Wohn/20 Weit weg.yml`: usage.maybe lists `Bes`, not used
- [x] `Common: Wohn/80 Advanced.yml`: usage.maybe lists `Arb`, `Arb2`, not used
- [x] `Dev: 05 Common/Quality check features.yml`: placeholder `FILE` not documented in usage.vars
- [x] `Dev: 11 Impr prompt/ASCII Overview/Make ASCII sys.yml`: `FILE` not documented
- [x] `Dev: 50 Coding/Extract and copy theme.yml`: usage.vars lists `FILE`, not used
- [x] `Dev: 50 Coding/Look for low hanging fruits.yml`: usage.vars lists `FILE`, not used
- [x] `Dev: 51 Features/Search dlg spec.yml`: usage.vars and usage.maybe list the template's `myVar`
- [x] `Dev: Autonomous Dev/02 Workflow rules.yml`: usage.vars lists `APP DESCRIPTION`, the content
      writes `<APP DESCRIPTION>` (no placeholder syntax): make it a placeholder or drop the entry
- [x] `Dev: Autonomous Dev/03 Full lifecycle.yml`: the same
- [x] `Dev: Prompt_demo/DEMO LinkedIn.yml`: `FOCUS`, `PROJECT_CONTEXT`, `FORMAT` not documented

(Dev = `11 Common/Dev/prompts/Dev (AI does all work)`, Common = `11 Common/Dools/AI (#ai-usage)`)


## Phases

1. **Backend core:** config + `.env`, `AiClient`, `AiTools` + `AiCheck` (read, write checks +
   previews, apply), the changes to existing code, `aiChat` loop, sessions. PHPUnit tests for
   the tools on the existing temp data set, fixture cases for the check.
2. **Sidebar:** replace the mock; sessions, provider select, replies, proposal rows with
   diff and warnings, reject note, propose again, client tools, tree highlight, editor sync,
   stop / retry / copy. JS tests for the diff and `modelMessages()`.
3. **Claude Code:** `AiClaude`, `AiMcpServer`, `mcp/ai_tools.php`. Tests for the server over
   stdio and the stream parsing (no CLI run).
4. **Undo + "Just do it"**, web search.
5. **Quick prompts.**


## Decisions

- Quick prompts in the user settings, read only for now
- `form_fill`: yes
- `item_move`: yes. "Sort into folders" and "archive old versions" are typical for a growing
  library, and `FileOperations::rename()` already moves (it creates the target's parent);
  it only needs to carry the color along
