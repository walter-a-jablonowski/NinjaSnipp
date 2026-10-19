using System.Runtime.InteropServices;

namespace NinjaSnipp;

// The Win32 API the app uses: hooks, hotkey, input, windows
internal static class Native
{
  // Hooks

  public const int WH_KEYBOARD_LL = 13;
  public const int WH_MOUSE_LL    = 14;

  public const int WM_KEYDOWN     = 0x0100;
  public const int WM_SYSKEYDOWN  = 0x0104;
  public const int WM_LBUTTONDOWN = 0x0201;
  public const int WM_RBUTTONDOWN = 0x0204;
  public const int WM_MBUTTONDOWN = 0x0207;
  public const int WM_HOTKEY      = 0x0312;
  public const int WM_QUIT        = 0x0012;

  public const uint LLKHF_INJECTED = 0x10;

  public const uint EVENT_SYSTEM_FOREGROUND = 0x0003;
  public const uint WINEVENT_OUTOFCONTEXT   = 0x0000;

  public delegate IntPtr HookProc( int nCode, IntPtr wParam, IntPtr lParam );
  public delegate void WinEventProc( IntPtr hook, uint eventType, IntPtr hwnd, int idObject, int idChild, uint thread, uint time );

  [StructLayout(LayoutKind.Sequential)]
  public struct KBDLLHOOKSTRUCT
  {
    public uint vkCode;
    public uint scanCode;
    public uint flags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct MSG
  {
    public IntPtr hwnd;
    public uint message;
    public IntPtr wParam;
    public IntPtr lParam;
    public uint time;
    public int ptX;
    public int ptY;
  }

  [DllImport("user32.dll", SetLastError = true)]
  public static extern IntPtr SetWindowsHookEx( int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId );

  [DllImport("user32.dll")]
  public static extern bool UnhookWindowsHookEx( IntPtr hhk );

  [DllImport("user32.dll")]
  public static extern IntPtr CallNextHookEx( IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam );

  [DllImport("user32.dll")]
  public static extern IntPtr SetWinEventHook( uint eventMin, uint eventMax, IntPtr hmodWinEventProc, WinEventProc lpfnWinEventProc, uint idProcess, uint idThread, uint dwFlags );

  [DllImport("user32.dll")]
  public static extern bool UnhookWinEvent( IntPtr hWinEventHook );

  [DllImport("kernel32.dll")]
  public static extern IntPtr GetModuleHandle( string? lpModuleName );

  [DllImport("kernel32.dll")]
  public static extern uint GetCurrentThreadId();

  [DllImport("user32.dll")]
  public static extern int GetMessage( out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax );

  [DllImport("user32.dll")]
  public static extern bool TranslateMessage( ref MSG lpMsg );

  [DllImport("user32.dll")]
  public static extern IntPtr DispatchMessage( ref MSG lpMsg );

  [DllImport("user32.dll")]
  public static extern bool PostThreadMessage( uint idThread, uint msg, IntPtr wParam, IntPtr lParam );

  // Keyboard

  public const int VK_SHIFT   = 0x10;
  public const int VK_CONTROL = 0x11;
  public const int VK_MENU    = 0x12;
  public const int VK_CAPITAL = 0x14;
  public const int VK_RMENU   = 0xA5;

  public const uint TOUNICODE_NO_STATE_CHANGE = 0x4;   // Windows 10 1607+: dead keys keep working in the target

  [DllImport("user32.dll")]
  public static extern short GetKeyState( int nVirtKey );

  [DllImport("user32.dll")]
  public static extern short GetAsyncKeyState( int vKey );

  [DllImport("user32.dll")]
  public static extern IntPtr GetKeyboardLayout( uint idThread );

  [DllImport("user32.dll")]
  public static extern int ToUnicodeEx( uint wVirtKey, uint wScanCode, byte[] lpKeyState, [Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder pwszBuff, int cchBuff, uint wFlags, IntPtr dwhkl );

  // Hotkey

  public const uint MOD_ALT      = 0x1;
  public const uint MOD_CONTROL  = 0x2;
  public const uint MOD_SHIFT    = 0x4;
  public const uint MOD_WIN      = 0x8;
  public const uint MOD_NOREPEAT = 0x4000;

  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool RegisterHotKey( IntPtr hWnd, int id, uint fsModifiers, uint vk );

  [DllImport("user32.dll")]
  public static extern bool UnregisterHotKey( IntPtr hWnd, int id );

  // Input

  public const uint INPUT_KEYBOARD    = 1;
  public const uint KEYEVENTF_KEYUP   = 0x2;
  public const uint KEYEVENTF_UNICODE = 0x4;

  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT
  {
    public uint type;
    public InputUnion u;
  }

  // The mouse member is never used, it makes the union as large as Windows expects
  [StructLayout(LayoutKind.Explicit)]
  public struct InputUnion
  {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT
  {
    public int dx;
    public int dy;
    public uint mouseData;
    public uint dwFlags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT
  {
    public ushort wVk;
    public ushort wScan;
    public uint dwFlags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  [DllImport("user32.dll", SetLastError = true)]
  public static extern uint SendInput( uint nInputs, INPUT[] pInputs, int cbSize );

  // Windows

  public const int WS_EX_TOPMOST = 0x8;

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT
  {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct POINT
  {
    public int X;
    public int Y;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct GUITHREADINFO
  {
    public int cbSize;
    public uint flags;
    public IntPtr hwndActive;
    public IntPtr hwndFocus;
    public IntPtr hwndCapture;
    public IntPtr hwndMenuOwner;
    public IntPtr hwndMoveSize;
    public IntPtr hwndCaret;
    public RECT rcCaret;
  }

  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow( IntPtr hWnd );

  [DllImport("user32.dll")]
  public static extern bool BringWindowToTop( IntPtr hWnd );

  [DllImport("user32.dll")]
  public static extern bool IsWindow( IntPtr hWnd );

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId( IntPtr hWnd, out uint lpdwProcessId );

  [DllImport("user32.dll")]
  public static extern bool AttachThreadInput( uint idAttach, uint idAttachTo, bool fAttach );

  [DllImport("user32.dll")]
  public static extern bool GetGUIThreadInfo( uint idThread, ref GUITHREADINFO lpgui );

  [DllImport("user32.dll")]
  public static extern bool ClientToScreen( IntPtr hWnd, ref POINT lpPoint );

  // Makes hWnd the foreground window. Windows only lets the process the user worked in last
  // do that, so this one joins the input of the current foreground thread first.
  public static void ForceForeground( IntPtr hWnd )
  {
    var foreground = GetForegroundWindow();
    if( foreground == hWnd || ! IsWindow(hWnd) )
      return;

    uint current = GetCurrentThreadId();
    uint other   = GetWindowThreadProcessId(foreground, out _);
    bool attached = other != current && AttachThreadInput(current, other, true);

    SetForegroundWindow(hWnd);
    BringWindowToTop(hWnd);

    if( attached )
      AttachThreadInput(current, other, false);
  }
}
