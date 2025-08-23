using System;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace NinjaSnipp.Services
{
  public class ClipboardService
  {
    // Win32 API for simulating keyboard input
    [DllImport("user32.dll")]
    private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    
    private const int KEYEVENTF_KEYUP = 0x0002;
    private const byte VK_CONTROL = 0x11;
    private const byte VK_V = 0x56;
    
    public void SetClipboardText(string text)
    {
      if (string.IsNullOrEmpty(text))
        return;
        
      try
      {
        Clipboard.SetText(text);
      }
      catch (Exception ex)
      {
        Console.WriteLine($"Error setting clipboard text: {ex.Message}");
      }
    }
    
    public async Task PasteClipboardContentAsync()
    {
      // Small delay to ensure clipboard content is ready
      await Task.Delay(100);
      
      try
      {
        // Simulate Ctrl+V to paste
        keybd_event(VK_CONTROL, 0, 0, UIntPtr.Zero);
        keybd_event(VK_V, 0, 0, UIntPtr.Zero);
        keybd_event(VK_V, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
      }
      catch (Exception ex)
      {
        Console.WriteLine($"Error pasting clipboard content: {ex.Message}");
      }
    }
    
    public async Task InsertTextAsync(string text)
    {
      SetClipboardText(text);
      await PasteClipboardContentAsync();
    }
  }
}