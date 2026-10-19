namespace NinjaSnipp;

internal static class Program
{
  [STAThread]
  private static void Main()
  {
    // One instance: a second one would hook the keyboard twice
    using var mutex = new Mutex(true, "NinjaSnipp.WinApp", out bool first);
    if( ! first )
      return;

    ApplicationConfiguration.Initialize();
    var config = Config.Load( Path.Combine(AppContext.BaseDirectory, "config.yml"));
    Application.Run( new TrayApp(config));
  }
}
