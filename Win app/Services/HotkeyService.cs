using System;
using System.Windows.Forms;
using System.Windows.Input;
using GlobalHotKey;
using ModifierKeys = System.Windows.Input.ModifierKeys;
using Key = System.Windows.Input.Key;

namespace NinjaSnipp.Services
{
  public class HotkeyService : IDisposable
  {
    private HotKeyManager _hotKeyManager;
    private int _registeredHotKeyId = 0;
    
    public event EventHandler<HotKeyEventArgs>? HotkeyPressed;
    
    public HotkeyService()
    {
      _hotKeyManager = new HotKeyManager();
      _hotKeyManager.KeyPressed += HotKeyManager_KeyPressed;
    }
    
    private void HotKeyManager_KeyPressed(object? sender, KeyPressedEventArgs e)
    {
      HotkeyPressed?.Invoke(this, new HotKeyEventArgs { HotKey = e.HotKey });
    }
    
    public bool RegisterHotKey(Key key, ModifierKeys modifiers)
    {
      try
      {
        var hotKey = new GlobalHotKey.HotKey(key, modifiers);
        _registeredHotKeyId++;
        _hotKeyManager.Register(hotKey);
        return true;
      }
      catch (Exception ex)
      {
        Console.WriteLine($"Error registering hotkey: {ex.Message}");
        return false;
      }
    }
    
    public void UnregisterAllHotKeys()
    {
      // Unregister all hotkeys manually since UnregisterAll method doesn't exist
      // Recreate the manager to effectively unregister all hotkeys
      _hotKeyManager.Dispose();
      _hotKeyManager = new HotKeyManager();
      _hotKeyManager.KeyPressed += HotKeyManager_KeyPressed;
    }
    
    public void Dispose()
    {
      UnregisterAllHotKeys();
      _hotKeyManager.Dispose();
    }
  }
  
  public class HotKeyEventArgs : EventArgs
  {
    public GlobalHotKey.HotKey HotKey { get; set; } = new GlobalHotKey.HotKey(Key.None, ModifierKeys.None);
  }
}