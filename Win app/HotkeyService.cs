namespace NinjaSnipp;

// One system wide hotkey (RegisterHotKey), raised on the UI thread
public class HotkeyService : NativeWindow, IDisposable
{
  private const int Id = 1;

  private bool registered;

  public event Action? Pressed;

  public HotkeyService()
  {
    CreateHandle( new CreateParams());
  }

  // False when the hotkey can't be read or another app has it already
  public bool Register( string hotkey )
  {
    var parsed = Config.ParseHotkey(hotkey);
    if( parsed == null )
      return false;

    registered = Native.RegisterHotKey(Handle, Id, parsed.Value.Modifiers | Native.MOD_NOREPEAT, (uint)parsed.Value.Key);
    return registered;
  }

  protected override void WndProc( ref Message m )
  {
    if( m.Msg == Native.WM_HOTKEY && m.WParam == Id )
      Pressed?.Invoke();
    else
      base.WndProc(ref m);
  }

  public void Dispose()
  {
    if( registered )
      Native.UnregisterHotKey(Handle, Id);
    DestroyHandle();
  }
}
