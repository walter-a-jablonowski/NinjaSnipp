namespace NinjaSnipp.Forms
{
  partial class SnippetContextMenu
  {
    /// <summary>
    /// Required designer variable.
    /// </summary>
    private System.ComponentModel.IContainer components = null;

    /// <summary>
    /// Clean up any resources being used.
    /// </summary>
    /// <param name="disposing">true if managed resources should be disposed; otherwise, false.</param>
    protected override void Dispose(bool disposing)
    {
      if (disposing && (components != null))
      {
        components.Dispose();
      }
      base.Dispose(disposing);
    }

    #region Windows Form Designer generated code

    /// <summary>
    /// Required method for Designer support - do not modify
    /// the contents of this method with the code editor.
    /// </summary>
    private void InitializeComponent()
    {
      this.components = new System.ComponentModel.Container();
      this.txtSearch = new System.Windows.Forms.TextBox();
      this.lstSnippets = new System.Windows.Forms.ListView();
      this.colName = new System.Windows.Forms.ColumnHeader();
      this.colShortcut = new System.Windows.Forms.ColumnHeader();
      this.SuspendLayout();
      // 
      // txtSearch
      // 
      this.txtSearch.Dock = System.Windows.Forms.DockStyle.Top;
      this.txtSearch.Location = new System.Drawing.Point(0, 0);
      this.txtSearch.Name = "txtSearch";
      this.txtSearch.PlaceholderText = "Type to search snippets...";
      this.txtSearch.Size = new System.Drawing.Size(300, 23);
      this.txtSearch.TabIndex = 0;
      this.txtSearch.TextChanged += new System.EventHandler(this.txtSearch_TextChanged);
      // 
      // lstSnippets
      // 
      this.lstSnippets.Columns.AddRange(new System.Windows.Forms.ColumnHeader[] {
      this.colName,
      this.colShortcut});
      this.lstSnippets.Dock = System.Windows.Forms.DockStyle.Fill;
      this.lstSnippets.FullRowSelect = true;
      this.lstSnippets.HeaderStyle = System.Windows.Forms.ColumnHeaderStyle.Nonclickable;
      this.lstSnippets.HideSelection = false;
      this.lstSnippets.Location = new System.Drawing.Point(0, 23);
      this.lstSnippets.MultiSelect = false;
      this.lstSnippets.Name = "lstSnippets";
      this.lstSnippets.Size = new System.Drawing.Size(300, 277);
      this.lstSnippets.TabIndex = 1;
      this.lstSnippets.UseCompatibleStateImageBehavior = false;
      this.lstSnippets.View = System.Windows.Forms.View.Details;
      this.lstSnippets.SelectedIndexChanged += new System.EventHandler(this.lstSnippets_SelectedIndexChanged);
      // 
      // colName
      // 
      this.colName.Text = "Name";
      this.colName.Width = 180;
      // 
      // colShortcut
      // 
      this.colShortcut.Text = "Shortcut";
      this.colShortcut.Width = 100;
      // 
      // SnippetContextMenu
      // 
      this.AutoScaleDimensions = new System.Drawing.SizeF(7F, 15F);
      this.AutoScaleMode = System.Windows.Forms.AutoScaleMode.Font;
      this.ClientSize = new System.Drawing.Size(300, 300);
      this.Controls.Add(this.lstSnippets);
      this.Controls.Add(this.txtSearch);
      this.Name = "SnippetContextMenu";
      this.StartPosition = System.Windows.Forms.FormStartPosition.Manual;
      this.Text = "Snippets";
      this.ResumeLayout(false);
      this.PerformLayout();
    }

    #endregion

    private System.Windows.Forms.TextBox txtSearch;
    private System.Windows.Forms.ListView lstSnippets;
    private System.Windows.Forms.ColumnHeader colName;
    private System.Windows.Forms.ColumnHeader colShortcut;
  }
}