using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Windows.Forms;
using Timer = System.Windows.Forms.Timer;
using NinjaSnipp.Models;
using NinjaSnipp.Services;

namespace NinjaSnipp.Forms
{
  public partial class SnippetContextMenu : Form
  {
    private readonly SnippetService _snippetService;
    private readonly ClipboardService _clipboardService;
    private List<Snippet> _filteredSnippets;
    private Timer _searchTimer;
    
    public SnippetContextMenu(SnippetService snippetService, ClipboardService clipboardService)
    {
      InitializeComponent();
      
      _snippetService = snippetService;
      _clipboardService = clipboardService;
      _filteredSnippets = new List<Snippet>();
      
      // Set form properties
      this.FormBorderStyle = FormBorderStyle.None;
      this.ShowInTaskbar = false;
      this.TopMost = true;
      
      // Initialize search timer
      _searchTimer = new Timer();
      _searchTimer.Interval = 300; // 300ms debounce
      _searchTimer.Tick += SearchTimer_Tick;
    }
    
    private void SearchTimer_Tick(object? sender, EventArgs e)
    {
      _searchTimer.Stop();
      FilterSnippets(txtSearch.Text);
    }
    
    private void FilterSnippets(string searchText)
    {
      _filteredSnippets = _snippetService.SearchSnippets(searchText);
      UpdateSnippetList();
    }
    
    private void UpdateSnippetList()
    {
      lstSnippets.Items.Clear();
      
      foreach (var snippet in _filteredSnippets)
      {
        var item = new ListViewItem(snippet.Name);
        item.SubItems.Add(snippet.Shortcut);
        item.Tag = snippet;
        lstSnippets.Items.Add(item);
      }
      
      // Adjust form height based on number of items
      int itemsToShow = Math.Min(_filteredSnippets.Count, 10);
      int newHeight = txtSearch.Height + (itemsToShow * lstSnippets.Items[0].Bounds.Height) + 50;
      this.Height = newHeight;
    }
    
    public void ShowAtCursor()
    {
      // Position the form at the cursor
      Point cursorPos = Cursor.Position;
      this.Location = new Point(cursorPos.X, cursorPos.Y);
      
      // Load all snippets
      _filteredSnippets = _snippetService.GetAllSnippets();
      UpdateSnippetList();
      
      // Clear search and focus
      txtSearch.Text = string.Empty;
      this.Show();
      txtSearch.Focus();
    }
    
    private async void lstSnippets_SelectedIndexChanged(object sender, EventArgs e)
    {
      if (lstSnippets.SelectedItems.Count > 0)
      {
        var selectedItem = lstSnippets.SelectedItems[0];
        var snippet = selectedItem.Tag as Snippet;
        
        if (snippet != null)
        {
          this.Hide();
          await _clipboardService.InsertTextAsync(snippet.Content);
        }
      }
    }
    
    private void txtSearch_TextChanged(object sender, EventArgs e)
    {
      _searchTimer.Stop();
      _searchTimer.Start();
    }
    
    protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
    {
      // Handle Escape key to close the form
      if (keyData == Keys.Escape)
      {
        this.Hide();
        return true;
      }
      
      // Handle Enter key to select the first item
      if (keyData == Keys.Enter && lstSnippets.Items.Count > 0)
      {
        lstSnippets.Items[0].Selected = true;
        return true;
      }
      
      return base.ProcessCmdKey(ref msg, keyData);
    }
  }
}