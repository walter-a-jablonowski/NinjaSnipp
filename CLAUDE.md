# NinjaSnipp

A file based snippet / prompt manager, two apps in one repo:

| Folder | What | Docs |
|---|---|---|
| `PHP manager app/` | the manager: PHP + plain JS single page app, served by XAMPP at `http://localhost/NinjaSnipp/PHP%20manager%20app/` | its README (file format, placeholders, code structure, tests), `dev/ai_sidebar_plan.md` |
| `Win app/` | tray app that inserts snippets system wide (typed shortcuts, hotkey picker, fill view); C# .NET 9, WinForms + WebView2 | its README, `dev/win_app_plan.md` (plan and design decisions) |

The coding conventions are in the user's global CLAUDE.md. In C# the usual PascalCase names are used, with the
user's brace and spacing style.


## How the two apps fit together

All snippet logic (data sets, links, includes, placeholders, MAYBE blocks) lives in the PHP app only. The Win app
is a thin shell and must stay one:

- `ajax/win.php` → `winSnippets` (`lib/SnippetIndex.php`): all snippets of **all data sets**, `form` flag, final
  `text` when there is no form, a `stamp` for cheap polling. The Win app caches it.
- `win.php` + `controllers/win.js`: the picker and fill view, shown by the Win app in a WebView2. Messages between
  them are documented at the top of `controllers/win.js`; `PopupWindow.cs` is the other side.
- The Win app never depends on or changes the data set selected in the manager: every request names its data set
  (`dataPath`), `Sources::select()` only applies it to that request.


## Things that must stay in sync

- PHP and JS have mirrored code with shared test cases in `PHP manager app/tests/fixtures/`, run by both
  PHPUnit and the Node tests: `placeholders.json` (`Renderer::extractPlaceholders` / `extractContentVars`),
  `unwrap.json` (`Renderer::unwrap` / `SnippetForm.unwrap`, the copy output). Change both sides together.
- `lib/snippet-form.js` (`SnippetForm`) is used by the manager's preview (`controllers/render.js`) and by
  `win.php`: placeholders, MAYBE blocks, var table, the resulting text. Test changes in both.
- `AjaxHandlersTest` checks that every `apiCall(..., 'action')` in the JS has a handler in `/ajax`.


## Running and testing

```
cd "PHP manager app"
composer test              # PHPUnit, works on temporary data sets only
composer test:js           # Node 22+ test runner, no npm packages

dotnet build "Win app/NinjaSnipp.sln"
dotnet test "Win app/tests/NinjaSnipp.Tests.csproj"
```

- A running `NinjaSnipp.exe` locks the build output. Don't kill the user's instance without saying so; to only
  check that it compiles, build into a scratch folder (`dotnet build NinjaSnipp.csproj -o <dir>`).
- The Win app loads `win.php` once: after changing it, use "Refresh snippets" in the tray menu or restart.
- Win app problems are logged to `%LOCALAPPDATA%\NinjaSnipp\log.txt`, read it first when something misbehaves.
- **Never send simulated keystrokes or clicks to the user's desktop** (SendInput, keybd_event scripts) to test the
  Win app: the user works on the same machine, keys and pastes can land in their windows. Ask the user to test by
  hand. Testing `win.php` in a browser tab is fine.


## Data

- The user's real snippets are on `G:` (Google Drive), configured in `users/default/settings.yml` (`dataPaths`).
  Don't write to them while testing; the manager's demo data is in `PHP manager app/data/`. Shortcuts (`sc`)
  of the demo data (e.g. `log--`) don't exist in the real data.
- All shortcuts end in `--`, the Win app expands them as soon as they are typed.
