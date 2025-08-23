using System;
using System.Drawing;
using System.Windows.Forms;
using System.Windows.Input;
using NinjaSnipp.Forms;
using NinjaSnipp.Services;

namespace NinjaSnipp
{
  public class TrayApplication : ApplicationContext
  {
    private NotifyIcon _trayIcon;
    private ContextMenuStrip _trayMenu;
    
    private readonly SnippetService _snippetService;
    private readonly HotkeyService _hotkeyService;
    private readonly ClipboardService _clipboardService;
    
    private SnippetContextMenu _snippetContextMenu;
    private SnippetManagerForm _snippetManagerForm;
    
    public TrayApplication()
    {
      // Initialize services
      _snippetService = new SnippetService();
      _hotkeyService = new HotkeyService();
      _clipboardService = new ClipboardService();
      
      // Initialize forms
      _snippetContextMenu = new SnippetContextMenu(_snippetService, _clipboardService);
      _snippetManagerForm = new SnippetManagerForm(_snippetService);
      
      // Load snippets
      _snippetService.LoadSnippetsAsync().Wait();
      
      // Setup tray icon and menu
      InitializeTrayIcon();
      
      // Register global hotkey (Ctrl+Alt+Space)
      RegisterHotkeys();
    }
    
    private void InitializeTrayIcon()
    {
      // Create context menu for tray icon
      _trayMenu = new ContextMenuStrip();
      _trayMenu.Items.Add("Manage Snippets", null, OnManageSnippets);
      _trayMenu.Items.Add("-");
      _trayMenu.Items.Add("Exit", null, OnExit);
      
      // Create tray icon
      _trayIcon = new NotifyIcon()
      {
        Icon = Utilities.IconUtility.GetApplicationIcon(),
        ContextMenuStrip = _trayMenu,
        Text = "NinjaSnipp",
        Visible = true
      };
      
      _trayIcon.DoubleClick += OnManageSnippets;
    }
    
    private void RegisterHotkeys()
    {
      // Register Ctrl+Alt+Space for showing snippet menu
      bool registered = _hotkeyService.RegisterHotKey(Key.Space, ModifierKeys.Control | ModifierKeys.Alt);
      
      if (!registered)
      {
        MessageBox.Show("Failed to register global hotkey (Ctrl+Alt+Space). The application may not work as expected.",
          "Hotkey Registration Failed", MessageBoxButtons.OK, MessageBoxIcon.Warning);
      }
      
      _hotkeyService.HotkeyPressed += OnHotkeyPressed;
    }
    
    private void OnHotkeyPressed(object? sender, HotKeyEventArgs e)
    {
      // Show snippet context menu at cursor position
      _snippetContextMenu.ShowAtCursor();
    }
    
    private void OnManageSnippets(object? sender, EventArgs e)
    {
      if (_snippetManagerForm.IsDisposed)
      {
        _snippetManagerForm = new SnippetManagerForm(_snippetService);
      }
      
      if (!_snippetManagerForm.Visible)
      {
        _snippetManagerForm.Show();
      }
      
      if (_snippetManagerForm.WindowState == FormWindowState.Minimized)
      {
        _snippetManagerForm.WindowState = FormWindowState.Normal;
      }
      
      _snippetManagerForm.BringToFront();
      _snippetManagerForm.Activate();
    }
    
    private void OnExit(object? sender, EventArgs e)
    {
      // Hide tray icon before exiting
      _trayIcon.Visible = false;
      
      // Dispose all resources properly
      Dispose(true);
      
      // Exit application
      Application.Exit();
    }
    
    protected override void Dispose(bool disposing)
    {
      if (disposing)
      {
        // Make sure tray icon is hidden before disposing
        if (_trayIcon != null)
        {
          _trayIcon.Visible = false;
          _trayIcon.Dispose();
          _trayIcon = null;
        }
        
        // Unregister hotkeys and dispose service
        if (_hotkeyService != null)
        {
          _hotkeyService.HotkeyPressed -= OnHotkeyPressed;
          _hotkeyService.UnregisterAllHotKeys();
          _hotkeyService.Dispose();
          _hotkeyService = null;
        }
        
        // Dispose forms
        if (_snippetContextMenu != null)
        {
          _snippetContextMenu.Dispose();
          _snippetContextMenu = null;
        }
        
        if (_snippetManagerForm != null && !_snippetManagerForm.IsDisposed)
        {
          _snippetManagerForm.Dispose();
          _snippetManagerForm = null;
        }
      }
      
      base.Dispose(disposing);
    }
  }
}