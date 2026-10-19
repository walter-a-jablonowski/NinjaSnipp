using System.Runtime.InteropServices;
using System.Text;

namespace NinjaSnipp;

// Watches what the user types anywhere (low level keyboard hook) and keeps the last characters
// for the shortcuts. Runs on a thread of its own: Windows drops a low level hook that answers
// too slowly, and the UI thread can be busy (WebView2, HTTP).
//
// The typed text starts over on keys that move the caret (Enter, Tab, arrows, ...), on a mouse
// click and when another window comes to the front: what was typed before isn't in front of the
// caret any more. Injected input (our own Backspaces and pastes, other tools) is not counted.
public class KeyboardHook : IDisposable
{
  private readonly TypedText typed = new();
  private readonly Thread thread;
  private readonly ManualResetEventSlim started = new();
  private uint threadId;

  // The delegates are kept: Windows calls them after the GC would have collected them
  private Native.HookProc? keyboardProc;
  private Native.HookProc? mouseProc;
  private Native.WinEventProc? foregroundProc;

  // After every typed character, with the typed text. Called on the hook's thread: a handler
  // must be fast and hand its work to the UI thread.
  public event Action<string>? Typed;

  public KeyboardHook()
  {
    thread = new Thread(Run) { IsBackground = true, Name = "KeyboardHook" };
    thread.SetApartmentState(ApartmentState.STA);
  }

  public int MaxLength
  {
    set => typed.MaxLength = Math.Max(value, 1);
  }

  public void Start()
  {
    thread.Start();
    started.Wait();
  }

  // Only from a Typed handler (the hook's thread)
  public void Clear() => typed.Clear();

  private void Run()
  {
    threadId       = Native.GetCurrentThreadId();
    keyboardProc   = OnKey;
    mouseProc      = OnMouse;
    foregroundProc = ( hook, eventType, hwnd, idObject, idChild, thread, time ) => typed.Clear();

    var module     = Native.GetModuleHandle(null);
    var keyboard   = Native.SetWindowsHookEx(Native.WH_KEYBOARD_LL, keyboardProc, module, 0);
    var mouse      = Native.SetWindowsHookEx(Native.WH_MOUSE_LL, mouseProc, module, 0);
    var foreground = Native.SetWinEventHook(Native.EVENT_SYSTEM_FOREGROUND, Native.EVENT_SYSTEM_FOREGROUND, IntPtr.Zero, foregroundProc, 0, 0, Native.WINEVENT_OUTOFCONTEXT);
    started.Set();

    // The hooks are called through this thread's message loop
    while( Native.GetMessage(out var msg, IntPtr.Zero, 0, 0) > 0 )
    {
      Native.TranslateMessage(ref msg);
      Native.DispatchMessage(ref msg);
    }

    Native.UnhookWindowsHookEx(keyboard);
    Native.UnhookWindowsHookEx(mouse);
    Native.UnhookWinEvent(foreground);
  }

  private IntPtr OnKey( int nCode, IntPtr wParam, IntPtr lParam )
  {
    if( nCode >= 0 && (wParam == Native.WM_KEYDOWN || wParam == Native.WM_SYSKEYDOWN) )
    {
      var key = Marshal.PtrToStructure<Native.KBDLLHOOKSTRUCT>(lParam);
      if( (key.flags & Native.LLKHF_INJECTED) == 0 )
        OnKeyDown(key);
    }

    return Native.CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
  }

  private void OnKeyDown( Native.KBDLLHOOKSTRUCT key )
  {
    var vk = (Keys)key.vkCode;

    switch( vk )
    {
      case Keys.Back:
        typed.Back();
        return;

      // Modifiers alone change nothing, the key they come with counts
      case Keys.ShiftKey or Keys.LShiftKey or Keys.RShiftKey or Keys.ControlKey or Keys.LControlKey or Keys.RControlKey
        or Keys.Menu or Keys.LMenu or Keys.RMenu or Keys.Capital or Keys.LWin or Keys.RWin:
        return;
    }

    char? c = ToChar(key);
    if( c == null )
    {
      typed.Clear();    // Enter, Tab, arrows, F keys, Ctrl+C, ...
      return;
    }

    typed.Add(c.Value);
    Typed?.Invoke( typed.ToString());
  }

  // The character the key types in the foreground window's keyboard layout, null for keys
  // that type none (or a control character, like Ctrl+C), and for dead keys
  private static char? ToChar( Native.KBDLLHOOKSTRUCT key )
  {
    // The hook thread's own key state isn't the user's, so it's built from the async state
    var state = new byte[256];
    foreach( int vk in new[] { Native.VK_SHIFT, Native.VK_CONTROL, Native.VK_MENU, Native.VK_RMENU } )
      if( (Native.GetAsyncKeyState(vk) & 0x8000) != 0 )
        state[vk] = 0x80;
    if( (Native.GetKeyState(Native.VK_CAPITAL) & 1) != 0 )
      state[Native.VK_CAPITAL] = 1;

    var layout = Native.GetKeyboardLayout( Native.GetWindowThreadProcessId( Native.GetForegroundWindow(), out _));
    var buffer = new StringBuilder(8);
    int count  = Native.ToUnicodeEx(key.vkCode, key.scanCode, state, buffer, buffer.Capacity, Native.TOUNICODE_NO_STATE_CHANGE, layout);

    if( count != 1 || char.IsControl(buffer[0]) )
      return null;

    return buffer[0];
  }

  private IntPtr OnMouse( int nCode, IntPtr wParam, IntPtr lParam )
  {
    if( nCode >= 0 && (wParam == Native.WM_LBUTTONDOWN || wParam == Native.WM_RBUTTONDOWN || wParam == Native.WM_MBUTTONDOWN) )
      typed.Clear();

    return Native.CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
  }

  public void Dispose()
  {
    if( threadId != 0 )
      Native.PostThreadMessage(threadId, Native.WM_QUIT, IntPtr.Zero, IntPtr.Zero);
  }
}
