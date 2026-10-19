namespace NinjaSnipp.Tests;

public class ConfigTest
{
  [Fact]
  public void ParseHotkey()
  {
    Assert.Equal( (Native.MOD_CONTROL | Native.MOD_ALT, Keys.Space), Config.ParseHotkey("Ctrl+Alt+Space"));
    Assert.Equal( (Native.MOD_WIN | Native.MOD_SHIFT, Keys.J), Config.ParseHotkey("win + shift + j"));
    Assert.Equal( (0u, Keys.F12), Config.ParseHotkey("F12"));

    Assert.Null( Config.ParseHotkey("Ctrl+Alt"));        // no key
    Assert.Null( Config.ParseHotkey("Ctrl+A+B"));        // two keys
    Assert.Null( Config.ParseHotkey("Ctrl+Nope"));
  }

  [Fact]
  public void LoadsTheConfigFileOfTheApp()
  {
    var path = Path.Combine(AppContext.BaseDirectory, "config.yml");
    var config = Config.Load(path);

    Assert.EndsWith("/", config.AppUrl);
    Assert.NotNull( Config.ParseHotkey(config.Hotkey));
    Assert.Contains(config.InsertMode, new[] { "paste", "type" });
  }

  [Fact]
  public void DefaultsWithoutAFile()
  {
    var config = Config.Load( Path.Combine(Path.GetTempPath(), "no_such_config.yml"));
    Assert.Equal("paste", config.InsertMode);
  }
}
