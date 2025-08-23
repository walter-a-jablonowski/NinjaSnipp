using System;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

namespace NinjaSnipp.Utilities
{
  public static class IconUtility
  {
    public static Icon GetApplicationIcon()
    {
      try
      {
        // Try to load the custom icon if it exists
        string iconPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Resources", "app_icon.svg");
        
        if (File.Exists(iconPath))
        {
          // Since we can't directly load SVG as an icon in .NET Framework/Windows Forms,
          // we'll use the embedded resource icon or default to system icon
          // In a real application, you would convert SVG to ICO or use a library to render SVG
          return SystemIcons.Application;
        }
        
        // Fall back to system icon
        return SystemIcons.Application;
      }
      catch (Exception ex)
      {
        Console.WriteLine($"Error loading application icon: {ex.Message}");
        return SystemIcons.Application;
      }
    }
  }
}