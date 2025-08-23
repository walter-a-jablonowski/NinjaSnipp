using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Windows.Forms;
using NinjaSnipp.Models;
using NinjaSnipp.Services;

namespace NinjaSnipp.Forms
{
  public partial class SnippetManagerForm : Form
  {
    private readonly SnippetService _snippetService;
    private Snippet? _currentSnippet;
    
    public SnippetManagerForm(SnippetService snippetService)
    {
      InitializeComponent();
      _snippetService = snippetService;
    }
    
    private async void SnippetManagerForm_Load(object sender, EventArgs e)
    {
      await _snippetService.LoadSnippetsAsync();
      RefreshSnippetList();
    }
    
    private void RefreshSnippetList()
    {
      lstSnippets.Items.Clear();
      var snippets = _snippetService.GetAllSnippets();
      
      foreach (var snippet in snippets)
      {
        var item = new ListViewItem(snippet.Name);
        item.SubItems.Add(snippet.Shortcut);
        item.SubItems.Add(string.Join(", ", snippet.Tags));
        item.Tag = snippet;
        lstSnippets.Items.Add(item);
      }
    }
    
    private void lstSnippets_SelectedIndexChanged(object sender, EventArgs e)
    {
      if (lstSnippets.SelectedItems.Count > 0)
      {
        var selectedItem = lstSnippets.SelectedItems[0];
        _currentSnippet = selectedItem.Tag as Snippet;
        
        if (_currentSnippet != null)
        {
          txtName.Text = _currentSnippet.Name;
          txtShortcut.Text = _currentSnippet.Shortcut;
          txtContent.Text = _currentSnippet.Content;
          txtComments.Text = _currentSnippet.Comments;
          txtTags.Text = string.Join(", ", _currentSnippet.Tags);
          
          btnSave.Text = "Update";
          btnDelete.Enabled = true;
        }
      }
      else
      {
        ClearForm();
      }
    }
    
    private void ClearForm()
    {
      _currentSnippet = null;
      txtName.Text = string.Empty;
      txtShortcut.Text = string.Empty;
      txtContent.Text = string.Empty;
      txtComments.Text = string.Empty;
      txtTags.Text = string.Empty;
      
      btnSave.Text = "Create";
      btnDelete.Enabled = false;
    }
    
    private async void btnSave_Click(object sender, EventArgs e)
    {
      if (string.IsNullOrWhiteSpace(txtName.Text) || 
          string.IsNullOrWhiteSpace(txtShortcut.Text) || 
          string.IsNullOrWhiteSpace(txtContent.Text))
      {
        MessageBox.Show("Name, shortcut, and content are required fields.", "Validation Error", 
          MessageBoxButtons.OK, MessageBoxIcon.Warning);
        return;
      }
      
      // Check if shortcut is already used by another snippet
      var existingSnippet = _snippetService.GetSnippetByShortcut(txtShortcut.Text);
      if (existingSnippet != null && (_currentSnippet == null || existingSnippet.Identifier != _currentSnippet.Identifier))
      {
        MessageBox.Show($"The shortcut '{txtShortcut.Text}' is already used by another snippet.", 
          "Duplicate Shortcut", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        return;
      }
      
      // Create or update snippet
      if (_currentSnippet == null)
      {
        _currentSnippet = new Snippet
        {
          Identifier = Guid.NewGuid().ToString(),
          CreatedAt = DateTime.Now
        };
      }
      
      // Update snippet properties
      _currentSnippet.Name = txtName.Text;
      _currentSnippet.Shortcut = txtShortcut.Text;
      _currentSnippet.Content = txtContent.Text;
      _currentSnippet.Comments = txtComments.Text;
      _currentSnippet.Tags = txtTags.Text
        .Split(new[] { ',', ';' }, StringSplitOptions.RemoveEmptyEntries)
        .Select(t => t.Trim())
        .Where(t => !string.IsNullOrWhiteSpace(t))
        .ToList();
      _currentSnippet.ModifiedAt = DateTime.Now;
      
      // Save to file
      await _snippetService.SaveSnippetAsync(_currentSnippet);
      
      // Refresh list and clear form
      RefreshSnippetList();
      ClearForm();
    }
    
    private async void btnDelete_Click(object sender, EventArgs e)
    {
      if (_currentSnippet == null)
        return;
        
      var result = MessageBox.Show($"Are you sure you want to delete the snippet '{_currentSnippet.Name}'?", 
        "Confirm Delete", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
        
      if (result == DialogResult.Yes)
      {
        await _snippetService.DeleteSnippetAsync(_currentSnippet.Identifier);
        RefreshSnippetList();
        ClearForm();
      }
    }
    
    private void btnNew_Click(object sender, EventArgs e)
    {
      ClearForm();
      lstSnippets.SelectedItems.Clear();
    }
  }
}