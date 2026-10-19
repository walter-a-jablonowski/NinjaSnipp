using System.Diagnostics;
using System.Drawing.Drawing2D;
using Microsoft.Win32;

namespace NinjaSnipp;

// The app: a tray icon, the hotkey for the picker and the typed shortcuts, wired to the popup
// and the inserter. Everything but the keyboard hook runs on the UI thread.
//
//   hotkey                          picker, the chosen snippet is inserted (or filled in first)
//   typed sc, one snippet           deleted and replaced by the snippet's text, or its fill view
//   typed sc, several snippets      deleted, the picker shows the snippets that have it
public class TrayApp : ApplicationContext
{
  private const string RunKey  = @"Software\Microsoft\Windows\CurrentVersion\Run";
  private const string RunName = "NinjaSnipp";

  private readonly Config config;
  private readonly SnippetIndex index;
  private readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(10) };
  private readonly KeyboardHook hook = new();
  private readonly HotkeyService hotkey = new();
  private readonly PopupWindow popup;
  private readonly Inserter inserter;
  private readonly NotifyIcon tray;
  private readonly System.Windows.Forms.Timer refreshTimer = new();
  private readonly SynchronizationContext ui;
  private readonly HashSet<string> excludedApps;

  private volatile bool paused;
  private IntPtr target;            // the window the popup inserts into
  private bool serverReachable;

  public TrayApp( Config config )
  {
    this.config  = config;
    index        = new SnippetIndex( Path.Combine( Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NinjaSnipp", "index.json"));
    popup        = new PopupWindow(config);
    ui           = SynchronizationContext.Current!;    // WinForms installs it with the first control (the popup)
    inserter     = new Inserter(config.InsertMode);
    excludedApps = new HashSet<string>(config.ExcludedApps, StringComparer.OrdinalIgnoreCase);

    var pauseItem = new ToolStripMenuItem("Pause typed shortcuts") { CheckOnClick = true };
    pauseItem.CheckedChanged += ( s, e ) => paused = pauseItem.Checked;

    var autostartItem = new ToolStripMenuItem("Start with Windows") { Checked = IsAutostart() };
    autostartItem.Click += ( s, e ) => autostartItem.Checked = SetAutostart( ! autostartItem.Checked);

    var menu = new ContextMenuStrip();
    menu.Items.Add($"Snippets ...  ({config.Hotkey})", null, ( s, e ) => ShowPicker());
    menu.Items.Add("Open manager", null, ( s, e ) => Process.Start( new ProcessStartInfo(config.AppUrl) { UseShellExecute = true }));
    menu.Items.Add("Refresh snippets", null, async ( s, e ) => {
      popup.Reload();
      await RefreshAsync();
    });
    menu.Items.Add(pauseItem);
    menu.Items.Add(autostartItem);
    menu.Items.Add( new ToolStripSeparator());
    menu.Items.Add("Exit", null, ( s, e ) => ExitThread());

    tray = new NotifyIcon { Icon = CreateIcon(), Text = "NinjaSnipp", ContextMenuStrip = menu, Visible = true };
    tray.MouseClick += ( s, e ) => {
      if( e.Button == MouseButtons.Left )
        ShowPicker();
    };

    popup.Insert += text => _ = InsertFromPopupAsync(text);
    popup.Cancel += () => popup.HideTo(target);

    hotkey.Pressed += ShowPicker;
    if( ! hotkey.Register(config.Hotkey) )
    {
      Log.Write($"Hotkey {config.Hotkey} can't be registered");
      tray.ShowBalloonTip(5000, "NinjaSnipp", $"The hotkey {config.Hotkey} can't be used (unknown or taken by another app), see config.yml", ToolTipIcon.Warning);
    }

    hook.Typed += OnTyped;

    refreshTimer.Interval = Math.Max(config.RefreshSeconds, 10) * 1000;
    refreshTimer.Tick += async ( s, e ) => await RefreshAsync();

    index.LoadCache();
    hook.MaxLength = index.LongestSc;
    hook.Start();
    refreshTimer.Start();
    UpdateTrayText();

    _ = StartAsync();
  }

  private async Task StartAsync()
  {
    await popup.InitAsync();
    await RefreshAsync();
  }

  private async Task RefreshAsync()
  {
    bool reachable = await index.RefreshAsync(http, config.AppUrl);
    if( reachable != serverReachable )
      Log.Write($"Server {config.AppUrl} {(reachable ? "reachable" : "not reachable")}, {index.Snippets.Count} snippets");

    serverReachable = reachable;
    hook.MaxLength  = index.LongestSc;
    UpdateTrayText();
  }

  private void UpdateTrayText()
  {
    int count  = index.Snippets.Count( s => s.Sc != "");
    var status = serverReachable ? $"{count} shortcuts" : $"server not reachable, {count} cached shortcuts";
    var text   = $"NinjaSnipp: {status}";
    tray.Text  = text.Length > 127 ? text[..127] : text;    // the tray's limit
  }

  // --- Picker ---

  private void ShowPicker()
  {
    var foreground = Native.GetForegroundWindow();
    if( foreground != popup.Handle )
      target = foreground;

    popup.ShowPick(target);
  }

  private async Task InsertFromPopupAsync( string text )
  {
    popup.HideTo(target);

    if( ! await inserter.InsertAsync(target, text) )
      NotInserted(text);
  }

  private void NotInserted( string text )
  {
    Inserter.ToClipboard(text);
    tray.ShowBalloonTip(5000, "NinjaSnipp", "Couldn't get back to the window you typed in: the snippet is on the clipboard, paste it with Ctrl+V", ToolTipIcon.Info);
  }

  // --- Typed shortcuts ---

  // On the hook's thread: find the snippets, then leave the rest to the UI thread. That runs
  // after this key went on to the app, so the Backspaces come after the shortcut's last character.
  private void OnTyped( string typed )
  {
    if( paused )
      return;

    var matches = index.Match(typed);
    if( matches.Count == 0 )
      return;

    var window = Native.GetForegroundWindow();
    if( IsExcluded(window) )
      return;

    hook.Clear();
    ui.Post( _ => _ = ExpandAsync(window, matches), null);
  }

  private async Task ExpandAsync( IntPtr window, List<Snippet> matches )
  {
    target = window;
    int typedLength = matches[0].Sc.Length;
    Log.Write($"Typed {matches[0].Sc} in window {window}: {matches.Count} snippet(s), form: {matches[0].Form}");

    if( matches.Count == 1 && matches[0] is { Form: false, Text: string text } )
    {
      if( ! await inserter.InsertAsync(window, text, typedLength) )
        NotInserted(text);
      return;
    }

    // The fill view and the picker need the server: until it is up the popup shows the waiting page.
    // Without the window in front the shortcut stays, nothing is shown.
    if( ! await inserter.DeleteAsync(window, typedLength) )
      return;
    if( matches.Count == 1 )
      popup.ShowFill(window, matches[0]);
    else
      popup.ShowPick(window, matches[0].Sc);
  }

  // Our own windows (the popup) and the apps in excludedApps
  private bool IsExcluded( IntPtr window )
  {
    Native.GetWindowThreadProcessId(window, out uint pid);
    if( pid == Environment.ProcessId )
      return true;
    if( excludedApps.Count == 0 )
      return false;

    try {

      using var process = Process.GetProcessById( (int)pid);
      return excludedApps.Contains(process.ProcessName);
    }
    catch( ArgumentException ) {
      return false;    // the process ended
    }
  }

  // --- Autostart ---

  private static bool IsAutostart()
  {
    using var key = Registry.CurrentUser.OpenSubKey(RunKey);
    return key?.GetValue(RunName) != null;
  }

  // Returns the new state
  private static bool SetAutostart( bool on )
  {
    using var key = Registry.CurrentUser.OpenSubKey(RunKey, true) ?? Registry.CurrentUser.CreateSubKey(RunKey);
    if( on )
      key.SetValue(RunName, $"\"{Application.ExecutablePath}\"");
    else
      key.DeleteValue(RunName, false);

    return on;
  }

  // A rounded square with the app's brand color and an N
  private static Icon CreateIcon()
  {
    using var bitmap   = new Bitmap(32, 32);
    using var graphics = Graphics.FromImage(bitmap);
    using var path     = new GraphicsPath();
    using var brush    = new SolidBrush( Color.FromArgb(253, 126, 20));
    using var font     = new Font("Segoe UI", 17, FontStyle.Bold, GraphicsUnit.Pixel);

    graphics.SmoothingMode     = SmoothingMode.AntiAlias;
    graphics.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
    path.AddArc(0, 0, 12, 12, 180, 90);
    path.AddArc(19, 0, 12, 12, 270, 90);
    path.AddArc(19, 19, 12, 12, 0, 90);
    path.AddArc(0, 19, 12, 12, 90, 90);
    path.CloseFigure();
    graphics.FillPath(brush, path);
    TextRenderer.DrawText(graphics, "N", font, new Rectangle(0, 0, 32, 32), Color.White, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);

    return Icon.FromHandle( bitmap.GetHicon());
  }

  protected override void ExitThreadCore()
  {
    refreshTimer.Stop();
    tray.Visible = false;
    tray.Dispose();
    hook.Dispose();
    hotkey.Dispose();
    popup.Dispose();
    http.Dispose();
    base.ExitThreadCore();
  }
}
