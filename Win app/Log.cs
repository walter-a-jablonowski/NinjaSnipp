namespace NinjaSnipp;

// %LOCALAPPDATA%\NinjaSnipp\log.txt: what the app did when something went wrong (server down,
// a window that didn't come back, ...), a tray app has no other place to say it. Starts over
// when it gets large.
public static class Log
{
  private const long MaxBytes = 512 * 1024;

  private static readonly object Lock = new();

  public static readonly string File = Path.Combine( Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NinjaSnipp", "log.txt");

  public static void Write( string message )
  {
    try {

      lock( Lock )
      {
        Directory.CreateDirectory( Path.GetDirectoryName(File)!);
        if( System.IO.File.Exists(File) && new FileInfo(File).Length > MaxBytes )
          System.IO.File.Delete(File);

        System.IO.File.AppendAllText(File, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}  {message}{Environment.NewLine}");
      }
    }
    catch( IOException ) {
      // no log is no reason to fail
    }
  }
}
