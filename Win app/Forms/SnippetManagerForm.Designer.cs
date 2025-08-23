namespace NinjaSnipp.Forms
{
  partial class SnippetManagerForm
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
      this.splitContainer1 = new System.Windows.Forms.SplitContainer();
      this.lstSnippets = new System.Windows.Forms.ListView();
      this.colName = new System.Windows.Forms.ColumnHeader();
      this.colShortcut = new System.Windows.Forms.ColumnHeader();
      this.colTags = new System.Windows.Forms.ColumnHeader();
      this.panel1 = new System.Windows.Forms.Panel();
      this.btnNew = new System.Windows.Forms.Button();
      this.panel2 = new System.Windows.Forms.Panel();
      this.btnDelete = new System.Windows.Forms.Button();
      this.btnSave = new System.Windows.Forms.Button();
      this.label5 = new System.Windows.Forms.Label();
      this.txtTags = new System.Windows.Forms.TextBox();
      this.label4 = new System.Windows.Forms.Label();
      this.txtComments = new System.Windows.Forms.TextBox();
      this.label3 = new System.Windows.Forms.Label();
      this.txtContent = new System.Windows.Forms.TextBox();
      this.label2 = new System.Windows.Forms.Label();
      this.txtShortcut = new System.Windows.Forms.TextBox();
      this.label1 = new System.Windows.Forms.Label();
      this.txtName = new System.Windows.Forms.TextBox();
      ((System.ComponentModel.ISupportInitialize)(this.splitContainer1)).BeginInit();
      this.splitContainer1.Panel1.SuspendLayout();
      this.splitContainer1.Panel2.SuspendLayout();
      this.splitContainer1.SuspendLayout();
      this.panel1.SuspendLayout();
      this.panel2.SuspendLayout();
      this.SuspendLayout();
      // 
      // splitContainer1
      // 
      this.splitContainer1.Dock = System.Windows.Forms.DockStyle.Fill;
      this.splitContainer1.Location = new System.Drawing.Point(0, 0);
      this.splitContainer1.Name = "splitContainer1";
      // 
      // splitContainer1.Panel1
      // 
      this.splitContainer1.Panel1.Controls.Add(this.lstSnippets);
      this.splitContainer1.Panel1.Controls.Add(this.panel1);
      // 
      // splitContainer1.Panel2
      // 
      this.splitContainer1.Panel2.Controls.Add(this.panel2);
      this.splitContainer1.Panel2.Controls.Add(this.label5);
      this.splitContainer1.Panel2.Controls.Add(this.txtTags);
      this.splitContainer1.Panel2.Controls.Add(this.label4);
      this.splitContainer1.Panel2.Controls.Add(this.txtComments);
      this.splitContainer1.Panel2.Controls.Add(this.label3);
      this.splitContainer1.Panel2.Controls.Add(this.txtContent);
      this.splitContainer1.Panel2.Controls.Add(this.label2);
      this.splitContainer1.Panel2.Controls.Add(this.txtShortcut);
      this.splitContainer1.Panel2.Controls.Add(this.label1);
      this.splitContainer1.Panel2.Controls.Add(this.txtName);
      this.splitContainer1.Size = new System.Drawing.Size(784, 461);
      this.splitContainer1.SplitterDistance = 261;
      this.splitContainer1.TabIndex = 0;
      // 
      // lstSnippets
      // 
      this.lstSnippets.Columns.AddRange(new System.Windows.Forms.ColumnHeader[] {
      this.colName,
      this.colShortcut,
      this.colTags});
      this.lstSnippets.Dock = System.Windows.Forms.DockStyle.Fill;
      this.lstSnippets.FullRowSelect = true;
      this.lstSnippets.HideSelection = false;
      this.lstSnippets.Location = new System.Drawing.Point(0, 0);
      this.lstSnippets.MultiSelect = false;
      this.lstSnippets.Name = "lstSnippets";
      this.lstSnippets.Size = new System.Drawing.Size(261, 421);
      this.lstSnippets.TabIndex = 0;
      this.lstSnippets.UseCompatibleStateImageBehavior = false;
      this.lstSnippets.View = System.Windows.Forms.View.Details;
      this.lstSnippets.SelectedIndexChanged += new System.EventHandler(this.lstSnippets_SelectedIndexChanged);
      // 
      // colName
      // 
      this.colName.Text = "Name";
      this.colName.Width = 100;
      // 
      // colShortcut
      // 
      this.colShortcut.Text = "Shortcut";
      this.colShortcut.Width = 70;
      // 
      // colTags
      // 
      this.colTags.Text = "Tags";
      this.colTags.Width = 80;
      // 
      // panel1
      // 
      this.panel1.Controls.Add(this.btnNew);
      this.panel1.Dock = System.Windows.Forms.DockStyle.Bottom;
      this.panel1.Location = new System.Drawing.Point(0, 421);
      this.panel1.Name = "panel1";
      this.panel1.Size = new System.Drawing.Size(261, 40);
      this.panel1.TabIndex = 1;
      // 
      // btnNew
      // 
      this.btnNew.Location = new System.Drawing.Point(12, 8);
      this.btnNew.Name = "btnNew";
      this.btnNew.Size = new System.Drawing.Size(75, 23);
      this.btnNew.TabIndex = 0;
      this.btnNew.Text = "New";
      this.btnNew.UseVisualStyleBackColor = true;
      this.btnNew.Click += new System.EventHandler(this.btnNew_Click);
      // 
      // panel2
      // 
      this.panel2.Controls.Add(this.btnDelete);
      this.panel2.Controls.Add(this.btnSave);
      this.panel2.Dock = System.Windows.Forms.DockStyle.Bottom;
      this.panel2.Location = new System.Drawing.Point(0, 421);
      this.panel2.Name = "panel2";
      this.panel2.Size = new System.Drawing.Size(519, 40);
      this.panel2.TabIndex = 10;
      // 
      // btnDelete
      // 
      this.btnDelete.Enabled = false;
      this.btnDelete.Location = new System.Drawing.Point(93, 8);
      this.btnDelete.Name = "btnDelete";
      this.btnDelete.Size = new System.Drawing.Size(75, 23);
      this.btnDelete.TabIndex = 1;
      this.btnDelete.Text = "Delete";
      this.btnDelete.UseVisualStyleBackColor = true;
      this.btnDelete.Click += new System.EventHandler(this.btnDelete_Click);
      // 
      // btnSave
      // 
      this.btnSave.Location = new System.Drawing.Point(12, 8);
      this.btnSave.Name = "btnSave";
      this.btnSave.Size = new System.Drawing.Size(75, 23);
      this.btnSave.TabIndex = 0;
      this.btnSave.Text = "Create";
      this.btnSave.UseVisualStyleBackColor = true;
      this.btnSave.Click += new System.EventHandler(this.btnSave_Click);
      // 
      // label5
      // 
      this.label5.AutoSize = true;
      this.label5.Location = new System.Drawing.Point(12, 347);
      this.label5.Name = "label5";
      this.label5.Size = new System.Drawing.Size(31, 15);
      this.label5.TabIndex = 9;
      this.label5.Text = "Tags";
      // 
      // txtTags
      // 
      this.txtTags.Anchor = ((System.Windows.Forms.AnchorStyles)(((System.Windows.Forms.AnchorStyles.Top | System.Windows.Forms.AnchorStyles.Left) 
      | System.Windows.Forms.AnchorStyles.Right)));
      this.txtTags.Location = new System.Drawing.Point(12, 365);
      this.txtTags.Name = "txtTags";
      this.txtTags.PlaceholderText = "Comma separated tags";
      this.txtTags.Size = new System.Drawing.Size(495, 23);
      this.txtTags.TabIndex = 8;
      // 
      // label4
      // 
      this.label4.AutoSize = true;
      this.label4.Location = new System.Drawing.Point(12, 248);
      this.label4.Name = "label4";
      this.label4.Size = new System.Drawing.Size(66, 15);
      this.label4.TabIndex = 7;
      this.label4.Text = "Comments";
      // 
      // txtComments
      // 
      this.txtComments.Anchor = ((System.Windows.Forms.AnchorStyles)(((System.Windows.Forms.AnchorStyles.Top | System.Windows.Forms.AnchorStyles.Left) 
      | System.Windows.Forms.AnchorStyles.Right)));
      this.txtComments.Location = new System.Drawing.Point(12, 266);
      this.txtComments.Multiline = true;
      this.txtComments.Name = "txtComments";
      this.txtComments.Size = new System.Drawing.Size(495, 60);
      this.txtComments.TabIndex = 6;
      // 
      // label3
      // 
      this.label3.AutoSize = true;
      this.label3.Location = new System.Drawing.Point(12, 99);
      this.label3.Name = "label3";
      this.label3.Size = new System.Drawing.Size(50, 15);
      this.label3.TabIndex = 5;
      this.label3.Text = "Content";
      // 
      // txtContent
      // 
      this.txtContent.AcceptsReturn = true;
      this.txtContent.AcceptsTab = true;
      this.txtContent.Anchor = ((System.Windows.Forms.AnchorStyles)(((System.Windows.Forms.AnchorStyles.Top | System.Windows.Forms.AnchorStyles.Left) 
      | System.Windows.Forms.AnchorStyles.Right)));
      this.txtContent.Font = new System.Drawing.Font("Consolas", 9F, System.Drawing.FontStyle.Regular, System.Drawing.GraphicsUnit.Point);
      this.txtContent.Location = new System.Drawing.Point(12, 117);
      this.txtContent.Multiline = true;
      this.txtContent.Name = "txtContent";
      this.txtContent.ScrollBars = System.Windows.Forms.ScrollBars.Both;
      this.txtContent.Size = new System.Drawing.Size(495, 120);
      this.txtContent.TabIndex = 4;
      this.txtContent.WordWrap = false;
      // 
      // label2
      // 
      this.label2.AutoSize = true;
      this.label2.Location = new System.Drawing.Point(12, 55);
      this.label2.Name = "label2";
      this.label2.Size = new System.Drawing.Size(52, 15);
      this.label2.TabIndex = 3;
      this.label2.Text = "Shortcut";
      // 
      // txtShortcut
      // 
      this.txtShortcut.Anchor = ((System.Windows.Forms.AnchorStyles)(((System.Windows.Forms.AnchorStyles.Top | System.Windows.Forms.AnchorStyles.Left) 
      | System.Windows.Forms.AnchorStyles.Right)));
      this.txtShortcut.Location = new System.Drawing.Point(12, 73);
      this.txtShortcut.Name = "txtShortcut";
      this.txtShortcut.Size = new System.Drawing.Size(495, 23);
      this.txtShortcut.TabIndex = 2;
      // 
      // label1
      // 
      this.label1.AutoSize = true;
      this.label1.Location = new System.Drawing.Point(12, 11);
      this.label1.Name = "label1";
      this.label1.Size = new System.Drawing.Size(39, 15);
      this.label1.TabIndex = 1;
      this.label1.Text = "Name";
      // 
      // txtName
      // 
      this.txtName.Anchor = ((System.Windows.Forms.AnchorStyles)(((System.Windows.Forms.AnchorStyles.Top | System.Windows.Forms.AnchorStyles.Left) 
      | System.Windows.Forms.AnchorStyles.Right)));
      this.txtName.Location = new System.Drawing.Point(12, 29);
      this.txtName.Name = "txtName";
      this.txtName.Size = new System.Drawing.Size(495, 23);
      this.txtName.TabIndex = 0;
      // 
      // SnippetManagerForm
      // 
      this.AutoScaleDimensions = new System.Drawing.SizeF(7F, 15F);
      this.AutoScaleMode = System.Windows.Forms.AutoScaleMode.Font;
      this.ClientSize = new System.Drawing.Size(784, 461);
      this.Controls.Add(this.splitContainer1);
      this.Name = "SnippetManagerForm";
      this.StartPosition = System.Windows.Forms.FormStartPosition.CenterScreen;
      this.Text = "Snippet Manager";
      this.Load += new System.EventHandler(this.SnippetManagerForm_Load);
      this.splitContainer1.Panel1.ResumeLayout(false);
      this.splitContainer1.Panel2.ResumeLayout(false);
      this.splitContainer1.Panel2.PerformLayout();
      ((System.ComponentModel.ISupportInitialize)(this.splitContainer1)).EndInit();
      this.splitContainer1.ResumeLayout(false);
      this.panel1.ResumeLayout(false);
      this.panel2.ResumeLayout(false);
      this.ResumeLayout(false);
    }

    #endregion

    private System.Windows.Forms.SplitContainer splitContainer1;
    private System.Windows.Forms.ListView lstSnippets;
    private System.Windows.Forms.ColumnHeader colName;
    private System.Windows.Forms.ColumnHeader colShortcut;
    private System.Windows.Forms.ColumnHeader colTags;
    private System.Windows.Forms.Panel panel1;
    private System.Windows.Forms.Button btnNew;
    private System.Windows.Forms.Label label1;
    private System.Windows.Forms.TextBox txtName;
    private System.Windows.Forms.Label label2;
    private System.Windows.Forms.TextBox txtShortcut;
    private System.Windows.Forms.Label label3;
    private System.Windows.Forms.TextBox txtContent;
    private System.Windows.Forms.Label label4;
    private System.Windows.Forms.TextBox txtComments;
    private System.Windows.Forms.Label label5;
    private System.Windows.Forms.TextBox txtTags;
    private System.Windows.Forms.Panel panel2;
    private System.Windows.Forms.Button btnDelete;
    private System.Windows.Forms.Button btnSave;
  }
}