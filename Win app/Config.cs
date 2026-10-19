using YamlDotNet.Serialization;
using YamlDotNet.Serialization.NamingConventions;

namespace NinjaSnipp;

// config.yml beside the exe, see there for the meaning of the keys
public class Config
{
  public string AppUrl { get; set; } = "http://localhost/NinjaSnipp/PHP%20manager%20app/";
  public string Hotkey { get; set; } = "Ctrl+Alt+Space";
  public string InsertMode { get; set; } = "paste";
  public List<string> ExcludedApps { get; set; } = new();
  public int RefreshSeconds { get; set; } = 60;
  public PopupSize Popup { get; set; } = new();

  public class PopupSize
  {
    public int Width { get; set; } = 760;
    public int Height { get; set; } = 560;
  }

  public static Config Load( string path )
  {
    if( ! File.Exists(path) )
      return new Config();

    var deserializer = new DeserializerBuilder()
      .WithNamingConvention(CamelCaseNamingConvention.Instance)
      .IgnoreUnmatchedProperties()
      .Build();

    var config = deserializer.Deserialize<Config?>( File.ReadAllText(path)) ?? new Config();
    config.AppUrl = config.AppUrl.TrimEnd('/') + "/";
    return config;
  }

  // "Ctrl+Alt+Space" => (MOD_CONTROL | MOD_ALT, Keys.Space), null for anything it can't read
  public static (uint Modifiers, Keys Key)? ParseHotkey( string hotkey )
  {
    uint modifiers = 0;
    Keys? key = null;

    foreach( var part in hotkey.Split('+', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries) )
    {
      switch( part.ToLowerInvariant() )
      {
        case "alt":     modifiers |= Native.MOD_ALT;     break;
        case "ctrl":
        case "control": modifiers |= Native.MOD_CONTROL; break;
        case "shift":   modifiers |= Native.MOD_SHIFT;   break;
        case "win":     modifiers |= Native.MOD_WIN;     break;
        default:
          if( key != null || ! Enum.TryParse(part, true, out Keys parsed) || parsed == Keys.None )
            return null;
          key = parsed;
          break;
      }
    }

    return key == null ? null : (modifiers, key.Value);
  }
}
