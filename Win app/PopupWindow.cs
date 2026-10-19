using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace NinjaSnipp;

// The snippet picker and fill view: the manager's win.php in a WebView2, shown at the caret of
// the window the user is typing in. Created hidden at start, so it is there at once.
//
// While the manager can't be reached (XAMPP starts a few minutes after boot) it shows a waiting
// page and tries again every few seconds. Messages: see controllers/win.js in the PHP app.
public class PopupWindow : Form
{
  private const int RetryMs = 5000;
  private const int CaretGap = 4;

  private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

  private const string WaitPage = """
    <!DOCTYPE html>
    <html><body style="font: 14px system-ui; background: #212529; color: #adb5bd; padding: 1.5rem">
      <p>Waiting for the snippet server (XAMPP) ...</p>
      <p style="font-size: 12px">Tried {url}, trying again every few seconds. Esc closes.</p>
      <script>
        document.addEventListener('keydown', e => { if( e.key === 'Escape' ) chrome.webview.postMessage({ action: 'cancel' }); });
      </script>
    </body></html>
    """;

  private readonly string appUrl;
  private readonly string pageUrl;
  private readonly Size logicalSize;
  private readonly WebView2 web = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(33, 37, 41) };
  private readonly System.Windows.Forms.Timer retry = new() { Interval = RetryMs };

  private bool ready;          // win.php is loaded
  private bool waiting;        // the waiting page is shown
  private string? pending;     // message for win.php, sent as soon as it is loaded

  public event Action<string>? Insert;
  public event Action? Cancel;

  public PopupWindow( Config config )
  {
    appUrl      = config.AppUrl;
    pageUrl     = $"{config.AppUrl}win.php";
    logicalSize = new Size(config.Popup.Width, config.Popup.Height);

    Text            = "NinjaSnipp";
    FormBorderStyle = FormBorderStyle.None;
    ShowInTaskbar   = false;
    TopMost         = true;
    StartPosition   = FormStartPosition.Manual;
    Padding         = new Padding(1);                 // the back color shows as a border
    BackColor       = Color.FromArgb(73, 80, 87);
    Controls.Add(web);

    retry.Tick += ( s, e ) => {
      retry.Stop();
      waiting = false;
      web.CoreWebView2?.Navigate(pageUrl);
    };

    // Like a menu: clicking elsewhere closes it
    Deactivate += ( s, e ) => {
      if( ! Visible )
        return;
      Log.Write($"Popup: lost the focus to {Native.GetForegroundWindow()}, closed");
      Cancel?.Invoke();
    };
  }

  public async Task InitAsync()
  {
    var dataDir = Path.Combine( Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NinjaSnipp", "WebView2");
    var env     = await CoreWebView2Environment.CreateAsync(null, dataDir);

    _ = web.Handle;    // the WebView2 starts with its control's window, the form is still hidden
    await web.EnsureCoreWebView2Async(env);

    var core = web.CoreWebView2;
    core.Settings.IsStatusBarEnabled   = false;
    core.Settings.IsZoomControlEnabled = false;
    core.NavigationCompleted += OnNavigationCompleted;
    core.WebMessageReceived  += OnWebMessage;
    core.Navigate(pageUrl);
  }

  // Loads win.php again, e.g. after the PHP app was updated
  public void Reload()
  {
    ready   = false;
    waiting = false;
    web.CoreWebView2?.Navigate(pageUrl);
  }

  public void ShowPick( IntPtr target, string? sc = null ) => Open(target, new { action = "pick", sc });

  public void ShowFill( IntPtr target, Snippet snippet ) => Open(target, new { action = "fill", snippet });

  public void HidePopup()
  {
    pending = null;
    Hide();
  }

  private void Open( IntPtr target, object message )
  {
    pending = JsonSerializer.Serialize(message, Json);
    var caret = CaretOf(target);
    PlaceAt(caret);

    Show();
    Native.ForceForeground(Handle);
    web.Focus();
    Log.Write($"Popup: shown at {Bounds} for caret {caret} of window {target}, page {(ready ? "loaded" : "not loaded")}, in front: {Native.GetForegroundWindow() == Handle}");
    SendPending();
  }

  private void SendPending()
  {
    if( ready && pending != null )
    {
      web.CoreWebView2.PostWebMessageAsJson(pending);
      pending = null;
    }
  }

  private void OnNavigationCompleted( object? sender, CoreWebView2NavigationCompletedEventArgs e )
  {
    if( waiting )            // the waiting page itself
      return;

    ready = e.IsSuccess;
    if( ready )
      SendPending();
    else
    {
      Log.Write($"Popup: {pageUrl} not loaded ({e.WebErrorStatus}), trying again");
      waiting = true;
      web.NavigateToString( WaitPage.Replace("{url}", System.Net.WebUtility.HtmlEncode(pageUrl)));
      retry.Start();
    }
  }

  private void OnWebMessage( object? sender, CoreWebView2WebMessageReceivedEventArgs e )
  {
    using var doc = JsonDocument.Parse(e.WebMessageAsJson);
    var message = doc.RootElement;
    var action  = message.TryGetProperty("action", out var a) ? a.GetString() : null;

    // Text to insert only from the manager's page
    if( action == "insert" && e.Source.StartsWith(appUrl, StringComparison.OrdinalIgnoreCase) )
      Insert?.Invoke( message.GetProperty("text").GetString() ?? "");
    else if( action == "cancel" )
      Cancel?.Invoke();
  }

  // Below the caret, above it when there is no room below; inside the screen
  private void PlaceAt( Rectangle caret )
  {
    var area = Screen.FromPoint(caret.Location).WorkingArea;
    var size = new Size( LogicalToDeviceUnits(logicalSize.Width), LogicalToDeviceUnits(logicalSize.Height));
    size     = new Size( Math.Min(size.Width, area.Width), Math.Min(size.Height, area.Height));

    int x = Math.Clamp(caret.Left, area.Left, area.Right - size.Width);
    int y = caret.Bottom + CaretGap + size.Height <= area.Bottom
      ? caret.Bottom + CaretGap
      : Math.Max(area.Top, caret.Top - CaretGap - size.Height);

    Bounds = new Rectangle(x, y, size.Width, size.Height);
  }

  // The caret of the target window on the screen; the mouse position for apps that have no
  // system caret (browsers, Electron apps, ...)
  private static Rectangle CaretOf( IntPtr target )
  {
    var info = new Native.GUITHREADINFO { cbSize = Marshal.SizeOf<Native.GUITHREADINFO>() };
    uint thread = Native.GetWindowThreadProcessId(target, out _);

    if( Native.GetGUIThreadInfo(thread, ref info) && info.hwndCaret != IntPtr.Zero )
    {
      var point = new Native.POINT { X = info.rcCaret.Left, Y = info.rcCaret.Top };
      Native.ClientToScreen(info.hwndCaret, ref point);
      return new Rectangle(point.X, point.Y, 1, Math.Max(info.rcCaret.Bottom - info.rcCaret.Top, 1));
    }

    return new Rectangle(Cursor.Position, new Size(1, 1));
  }

  // Alt+F4 only hides it, the app ends from the tray
  protected override void OnFormClosing( FormClosingEventArgs e )
  {
    if( e.CloseReason == CloseReason.UserClosing )
    {
      e.Cancel = true;
      Cancel?.Invoke();
    }

    base.OnFormClosing(e);
  }
}
