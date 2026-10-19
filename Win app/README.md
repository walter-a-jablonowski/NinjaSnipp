# NinjaSnipp Win app

Inserts snippets of the NinjaSnipp manager anywhere in Windows:

- **Typed shortcut:** type a snippet's `sc` (e.g. `err--`) in any app. It is replaced by the snippet at once.
- **Hotkey** (Ctrl+Alt+Space): a list of all snippets at the caret, type to filter, Enter inserts.
- A snippet with vars or MAYBE blocks opens a **fill view** first: placeholders, MAYBE checkboxes and the
  resulting text, which can be edited by hand. Ctrl+Enter inserts.

Snippets come from all data sets of the manager at once (the one selected in the manager doesn't matter). If a
shortcut is used by several snippets, the list opens with just those.

Plan and design decisions: [dev/win_app_plan.md](dev/win_app_plan.md)


## Requirements

- The PHP manager app, served by a local web server (XAMPP); the Win app reads the snippets from it
- .NET 9 SDK for building, the WebView2 runtime (part of Windows 11)


## Build and run

```
dotnet build NinjaSnipp.sln
bin\Debug\net9.0-windows\NinjaSnipp.exe
dotnet test tests/NinjaSnipp.Tests.csproj
```

It runs in the tray: left click opens the snippet list, the menu has Open manager, Refresh snippets, Pause typed
shortcuts, Start with Windows and Exit.


## Config

`config.yml` beside the exe (copied from the project on build):

| Key | |
|---|---|
| `appUrl` | where the manager is, e.g. `http://localhost/NinjaSnipp/PHP%20manager%20app/` |
| `hotkey` | opens the snippet list, e.g. `Ctrl+Alt+Space`, `Win+Shift+J` |
| `insertMode` | `paste`: through the clipboard, which is restored after (default) <br> `type`: as keystrokes, the clipboard isn't touched |
| `excludedApps` | apps without typed shortcuts, process names without `.exe`, e.g. `[KeePass]` |
| `refreshSeconds` | how often the snippets are checked for changes (cheap: the server answers "unchanged") |
| `popup` | `width`, `height` of the popup |


## How it works

```
NinjaSnipp.exe                                PHP manager app (XAMPP)
  tray, hotkey, keyboard hook
  popup: WebView2  ──────────────────────>    win.php           picker + fill view
  index cache  <────── winSnippets ───────    ajax/win.php      all snippets, final text if no form
```

The Win app only knows "this shortcut inserts this text" or "this one needs the fill view": everything about
snippets (data sets, links, includes, placeholders, MAYBE blocks) stays in the manager's code.

| File | |
|---|---|
| `TrayApp.cs` | the app: tray, hotkey and typed shortcuts wired to the popup and the inserter |
| `KeyboardHook.cs` | low level keyboard hook on a thread of its own, the last typed characters (`TypedText.cs`) |
| `SnippetIndex.cs` | the snippets from `winSnippets`, cached in `%LOCALAPPDATA%\NinjaSnipp\index.json`, shortcut matching |
| `PopupWindow.cs` | `win.php` in a WebView2 at the caret; a waiting page while the server is down |
| `Inserter.cs` | target window back to the front, shortcut deleted, text pasted or typed |
| `HotkeyService.cs`, `Native.cs`, `Config.cs`, `Log.cs` | hotkey, Win32 API, config.yml, log |

- **XAMPP starts later than the app:** snippets without a form are in the cache with their final text and work
  before the server is up. The list and the fill view show a waiting page and continue when it's there.
- **Typed text** starts over on Enter, Tab, arrows, a mouse click and when another window comes to the front.
  Input sent by programs (including this one) isn't counted.
- **Pasting** keeps the snippet out of the clipboard history (Win+V) and the cloud clipboard.
- **Safety:** keys are only sent when the window the user typed in is in front again. Otherwise the snippet goes
  to the clipboard and a notification says so.

Problems (server not reachable, a window that didn't come back, the hotkey taken by another app) are written to
`%LOCALAPPDATA%\NinjaSnipp\log.txt`.


## Limitations

- Windows doesn't allow input into apps that run as administrator, unless the Win app runs as administrator too
- Apps without a system caret (browsers, Electron apps like VS Code) get the popup at the mouse position
