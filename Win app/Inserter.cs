using System.Runtime.InteropServices;

namespace NinjaSnipp;

// Inserts text into the window the user was typing in: brings it back to the front, deletes the
// typed shortcut and pastes the text (the clipboard is restored after) or types it.
//
// Keys are only sent when the target really is the foreground window: Backspaces or a paste in
// another window could do harm there. Returns false then, the caller tells the user.
public class Inserter
{
  // How long the target app gets to paste before the clipboard is restored: it reads the
  // clipboard when it handles Ctrl+V, not when the keys were sent
  private const int PasteDelayMs = 400;

  private readonly bool typeIt;

  public Inserter( string insertMode )
  {
    typeIt = insertMode == "type";
  }

  public async Task<bool> InsertAsync( IntPtr target, string text, int deleteCount = 0 )
  {
    if( ! await DeleteAsync(target, deleteCount) )
      return false;

    text = text.ReplaceLineEndings("\n");
    if( typeIt )
      Type(text);
    else
      await PasteAsync(text);

    return true;
  }

  // Deletes the typed shortcut, like the user's own Backspaces
  public async Task<bool> DeleteAsync( IntPtr target, int count )
  {
    if( ! await FrontAsync(target) )
    {
      Log.Write($"Inserter: window {target} didn't come to the front, {Native.GetForegroundWindow()} is there");
      return false;
    }

    if( count > 0 )
      Send( Enumerable.Repeat( Keys.Back, count).SelectMany(Press));

    return true;
  }

  // Brings the target to the front if it isn't there, it needs a moment to take the focus
  private static async Task<bool> FrontAsync( IntPtr target )
  {
    for( int attempt = 0; attempt < 5 && Native.GetForegroundWindow() != target; attempt++ )
    {
      Native.ForceForeground(target);
      await Task.Delay(30);
    }

    return Native.GetForegroundWindow() == target;
  }

  // For when the text couldn't be inserted: the user pastes it
  public static void ToClipboard( string text )
  {
    try {

      Clipboard.SetText( text.ReplaceLineEndings("\r\n"));
    }
    catch( ExternalException ) {
      // the clipboard is held by another app
    }
  }

  private static async Task PasteAsync( string text )
  {
    var saved = SaveClipboard();

    // Kept out of the clipboard history (Win+V) and the cloud clipboard: it's not something the user copied
    var data = new DataObject();
    data.SetText( text.ReplaceLineEndings("\r\n"), TextDataFormat.UnicodeText);
    data.SetData("ExcludeClipboardContentFromMonitorProcessing", new MemoryStream(new byte[4]));
    data.SetData("CanIncludeInClipboardHistory", new MemoryStream(new byte[4]));
    data.SetData("CanUploadToCloudClipboard", new MemoryStream(new byte[4]));
    Clipboard.SetDataObject(data, true, 5, 50);

    Send( new[] { Down(Keys.ControlKey), Down(Keys.V), Up(Keys.V), Up(Keys.ControlKey) });
    Log.Write($"Inserter: pasted {text.Length} characters");

    await Task.Delay(PasteDelayMs);

    try {

      if( saved != null )
        Clipboard.SetDataObject(saved, true, 5, 50);
      else
        Clipboard.Clear();
    }
    catch( ExternalException ) {
      // another app holds the clipboard: the snippet stays on it, nothing worse
    }
  }

  // A copy of what is on the clipboard: Clipboard.GetDataObject() is only a view of it. Formats
  // that can't be read (some apps put delayed or private data there) are left out.
  private static DataObject? SaveClipboard()
  {
    var current = Clipboard.GetDataObject();
    if( current == null )
      return null;

    var copy = new DataObject();
    foreach( var format in current.GetFormats(false) )
    {
      try {

        var value = current.GetData(format, false);
        if( value != null )
          copy.SetData(format, false, value);
      }
      catch( Exception ) {
        // skip this format (COM errors, formats .NET won't read)
      }
    }

    return copy.GetFormats().Length > 0 ? copy : null;
  }

  // As keystrokes: line breaks as Enter (many apps ignore a typed line feed character)
  private static void Type( string text )
  {
    var inputs = new List<Native.INPUT>();
    foreach( char c in text )
    {
      if( c == '\n' )
        inputs.AddRange( Press(Keys.Enter));
      else
      {
        inputs.Add( Unicode(c, 0));
        inputs.Add( Unicode(c, Native.KEYEVENTF_KEYUP));
      }
    }

    Send(inputs);
  }

  private static IEnumerable<Native.INPUT> Press( Keys key ) => new[] { Down(key), Up(key) };

  private static Native.INPUT Down( Keys key ) => Key(key, 0);

  private static Native.INPUT Up( Keys key ) => Key(key, Native.KEYEVENTF_KEYUP);

  private static Native.INPUT Key( Keys key, uint flags ) => new()
  {
    type = Native.INPUT_KEYBOARD,
    u = new Native.InputUnion { ki = new Native.KEYBDINPUT { wVk = (ushort)key, dwFlags = flags } }
  };

  private static Native.INPUT Unicode( char c, uint flags ) => new()
  {
    type = Native.INPUT_KEYBOARD,
    u = new Native.InputUnion { ki = new Native.KEYBDINPUT { wScan = c, dwFlags = Native.KEYEVENTF_UNICODE | flags } }
  };

  private static void Send( IEnumerable<Native.INPUT> inputs )
  {
    var array = inputs.ToArray();
    if( array.Length > 0 )
      Native.SendInput( (uint)array.Length, array, Marshal.SizeOf<Native.INPUT>());
  }
}
