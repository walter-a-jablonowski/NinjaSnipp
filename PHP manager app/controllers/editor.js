class EditorController
{
  constructor(app)
  {
    this.app = app;
  }

  // path: physical path of the file; basePath: its source folder (null = last source wins);
  // treePath: the tree row it was opened from (differs from path for links and duplicates)
  async loadSnippet(path, basePath = null, treePath = path)
  {
    // A scheduled autosave belongs to the snippet that is open right now. Run it before
    // that state is replaced, or the edits made just before the click are dropped - and
    // the timer would fire against the next snippet instead.
    if( this.app._autosaveTimer ) {
      this.clearAutosaveTimer();
      if( this.getAutosaveEnabled() && this.app.currentSnippet )
        await this.saveCurrentSnippet(true);
    }

    // Only now switch the location state: the save above must still write to the old one
    this.app.currentPath     = path.split('/').slice(0, -1).join('/');
    this.app.currentBasePath = basePath || null;
    this.app.currentTreePath = treePath;

    showLoading('editContent');

    const result = await apiCall(this.app.currentDataPath, 'loadSnippet', { path, basePath });

    if( result.success ) {
      this.app.currentSnippet = result.snippet;
      this.setAutosaveStatus(null);   // a fresh snippet starts in sync
      this.renderEditForm(result.snippet);
      // Add to recent snippets and persist
      // basePath too, so a merged duplicate reopens from its own source
      const item = { path, basePath: basePath || null, name: result.snippet._name, timestamp: Date.now() };
      this.app.recentSnippets = this.app.recentSnippets.filter(r => r.path !== path || (r.basePath || null) !== item.basePath);
      this.app.recentSnippets.unshift(item);
      this.app.recentSnippets = this.app.recentSnippets.slice(0, 10);
      await apiCall(this.app.currentDataPath, 'saveRecentSnippets', { data: this.app.recentSnippets });

      // Render the rendered views (markdown files get their preview)
      this.app.render.composeAndRenderInline();
      this.updateActionButtonsVisibility();
      this.app.render.applyLineWrap();
    }
    else {
      showError('Failed to load snippet: ' + result.message);
    }

    hideLoading('editContent');
  }

  renderEditForm(snippet)
  {
    const editEmptyState = document.getElementById('editEmptyState');
    const editForm = document.getElementById('editForm');
    const snippetSc = document.getElementById('snippetSc');
    const snippetShort = document.getElementById('snippetShort');
    const snippetUsage = document.getElementById('snippetUsage');
    const snippetContent = document.getElementById('snippetContent');

    if( ! editForm || ! snippetContent ) return;

    const isYaml = snippet._type === 'yml';

    snippetContent.value = snippet.content || '';

    if( isYaml ) {
      if( snippetSc )    snippetSc.value    = snippet.sc    || '';
      if( snippetShort ) snippetShort.value = snippet.short || '';
      // The server dumps usage to YAML text with the same library that parses it back
      if( snippetUsage ) snippetUsage.value = snippet._usageText || '';
    }

    editForm.dataset.type = snippet._type;   // CSS hides the usage column (+ its header, content label) for md

    const fieldContent = document.getElementById('fieldContent');
    if( fieldContent )
      fieldContent.className = isYaml ? 'col-md-6 d-flex flex-column' : 'col-12 d-flex flex-column';

    if( editEmptyState ) editEmptyState.style.display = 'none';
    editForm.style.display = 'flex';

    // Mobile: start with the usage when there is some to read
    const usage    = snippet.usage;
    const hasUsage = isYaml && usage && (typeof usage === 'string' ? usage.trim() : (usage.text || Object.keys(usage).length));
    this.app.render.showMobilePane(hasUsage ? 'usage' : 'content');

    this.app.render.applyFieldViews();

    requestAnimationFrame(() => {
      if( isYaml ) {
        if( this.app._initialContentHeight === null ) {
          this.app._initialContentHeight = 300;
        }
      }
      this.app.enableMdTextareaAutoHeight();
      requestAnimationFrame(() => {
        this.app.resizeMdTextarea();
        if( this.app.currentSnippet && this.app.currentSnippet._type === 'yml' ) this.app.resizeInlineSnippet();
      });
      setTimeout(() => {
        this.app.resizeMdTextarea();
        if( this.app.currentSnippet && this.app.currentSnippet._type === 'yml' ) this.app.resizeInlineSnippet();
      }, 150);
    });

    this.setActionButtonsEnabled(true);
  }

  // silent: autosave path, no success toast
  async saveCurrentSnippet(silent = false)
  {
    if( ! this.app.currentSnippet ) return;

    const contentInput = document.getElementById('snippetContent');

    if( ! contentInput.value.trim() ) {
      showError('Content is required');
      return;
    }

    // Spread all current fields so non-editable keys (short, id, version, ...) are preserved
    const data = { ...this.app.currentSnippet, content: contentInput.value };

    if( this.app.currentSnippet._type === 'yml' ) {
      data.sc    = document.getElementById('snippetSc')?.value.trim()    || '';
      data.short = document.getElementById('snippetShort')?.value.trim() || '';
      // Not trimmed: the trailing newline belongs to the last `|` block in the usage YAML
      data.usage = document.getElementById('snippetUsage')?.value ?? '';
    }

    const extension = this.app.currentSnippet._type === 'yml' ? 'yml' : 'md';
    const path = (this.app.currentPath ? this.app.currentPath + '/' : '') + data._name + '.' + extension;

    // Write back to the source this snippet was opened from, not just the last one
    const payload = { path, data };
    if( this.app.currentBasePath ) payload.targetBasePath = this.app.currentBasePath;

    // The snippet that is open when the request comes back may not be the one it was sent
    // for - opening another snippet mid-request used to overwrite `currentSnippet` with
    // this stale copy, and every later save then wrote the new content under the old name
    const savedSnippet = this.app.currentSnippet;

    const result = await apiCall(this.app.currentDataPath, 'saveSnippet', payload);

    if( this.app.currentSnippet !== savedSnippet ) {
      // The file itself was written (or refused) correctly; only the on-screen state has
      // moved on, so none of it may be touched here
      if( ! result.success && ! silent )
        showError('Failed to save snippet: ' + result.message);
      return;
    }

    if( result.success ) {
      if( ! silent ) showSuccess('Snippet saved successfully');
      this.setAutosaveStatus(null);
      // Adopt the server's normalized copy so `usage` stays a parsed object; keeping the
      // raw textarea text would make the usage preview fall back to rendering plain YAML
      this.app.currentSnippet = result.snippet || data;

      // Autosave changes neither the file list nor a visible preview (it only fires from
      // the source fields), so skip both round trips - a column recomposes when switched
      // back to its rendered view
      if( ! silent ) {
        this.app.loadFiles();
        if( this.app.currentSnippet._type === 'yml' )
          this.app.render.composeAndRenderInline();
      }
    }
    else if( silent ) {
      // Autosave: the file keeps its last good content. Toast once when saving starts
      // failing - repeating it every debounce would spam while a usage block is mid-edit
      // and briefly unparsable - and leave a standing badge until a save succeeds.
      if( ! this.app._autosaveFailed )
        showError('Autosave paused: ' + result.message);

      this.setAutosaveStatus(result.message);
    }
    else {
      showError('Failed to save snippet: ' + result.message);
      this.setAutosaveStatus(result.message);
    }
  }

  // Standing "Not saved" badge next to the file actions. Kept out of the toast flow so it can
  // stay visible for as long as the snippet really is unsaved.
  setAutosaveStatus(message)
  {
    this.app._autosaveFailed = !!message;
    this.updateActionButtonsVisibility();   // a refused autosave brings back the Save button

    const el = document.getElementById('autosaveStatus');
    if( ! el ) return;

    el.style.display = message ? '' : 'none';
    el.title = message ? `Not saved: ${message}` : '';
  }

  bindAutosaveHandlers()
  {
    if( this.app._autosaveBound ) return;
    const scEl      = document.getElementById('snippetSc');
    const shortEl   = document.getElementById('snippetShort');
    const usageEl   = document.getElementById('snippetUsage');
    const contentEl = document.getElementById('snippetContent');
    const handler = () => this.onEditFieldChanged();
    [scEl, shortEl, usageEl, contentEl].forEach(el => {
      if( el ) {
        el.addEventListener('input', handler);
        el.addEventListener('blur', handler);
      }
    });
    this.app._autosaveBound = true;
  }

  onEditFieldChanged()
  {
    if( ! this.getAutosaveEnabled() ) return;
    if( ! this.app.currentSnippet ) return;
    this.scheduleAutosave();
  }

  getAutosaveEnabled()
  {
    const sw = document.getElementById('autosaveSwitch');
    return !!(sw && sw.checked);
  }

  scheduleAutosave()
  {
    this.clearAutosaveTimer();
    this.app._autosaveTimer = setTimeout(() => {
      this.autosaveIfEnabled();
    }, this.app._autosaveDelayMs);
  }

  clearAutosaveTimer()
  {
    if( this.app._autosaveTimer ) {
      clearTimeout(this.app._autosaveTimer);
      this.app._autosaveTimer = null;
    }
  }

  async autosaveIfEnabled()
  {
    this.app._autosaveTimer = null;
    if( ! this.getAutosaveEnabled() ) return;
    if( ! this.app.currentSnippet ) return;
    await this.saveCurrentSnippet(true);
  }

  async duplicateCurrentSnippet()
  {
    if( ! this.app.currentSnippet ) return;
    showModal('duplicateSnippetModal');
  }

  async performDuplicate()
  {
    if( ! this.app.currentSnippet ) return;
    const input = document.getElementById('duplicateNameInput');
    const newName = input ? input.value.trim() : '';
    if( ! newName ) return;

    const extension = this.app.currentSnippet._type === 'yml' ? 'yml' : 'md';
    const sourcePath = (this.app.currentPath ? this.app.currentPath + '/' : '') + this.app.currentSnippet._name + '.' + extension;
    const targetPath = (this.app.currentPath ? this.app.currentPath + '/' : '') + newName + '.' + extension;

    const result = await apiCall(this.app.currentDataPath, 'duplicateSnippet',
      { sourcePath, targetPath, basePath: this.app.currentBasePath || null });
    if( result.success ) {
      showSuccess('Snippet duplicated successfully');
      const modal = bootstrap.Modal.getInstance(document.getElementById('duplicateSnippetModal'));
      if( modal ) modal.hide();
      this.app.loadFiles();
    }
    else {
      showError('Failed to duplicate snippet: ' + result.message);
    }
  }

  async deleteCurrentSnippet()
  {
    if( ! this.app.currentSnippet ) return;
    this.app._deleteContext = null;
    showModal('deleteSnippetModal');
  }

  async performDelete()
  {
    let path;
    let basePath = null;
    let clearCurrent = false;

    if( this.app._deleteContext ) {
      path     = this.app._deleteContext.path;
      basePath = this.app._deleteContext.basePath || null;
      if( this.app.currentSnippet ) {
        const ext = this.app.currentSnippet._type === 'yml' ? 'yml' : 'md';
        const curPath = (this.app.currentPath ? this.app.currentPath + '/' : '') + this.app.currentSnippet._name + '.' + ext;
        // Same file only when it is also the same source. A deleted folder takes the open
        // snippet with it - kept open, the next autosave would recreate folder and file.
        const isFolderCtx = this.app._deleteContext.type === 'folder';
        const sameSource  = isFolderCtx
          ? ! basePath || ! this.app.currentBasePath || basePath === this.app.currentBasePath
            || (this.app._deleteContext.mergedBases || []).includes(this.app.currentBasePath)
          : basePath === (this.app.currentBasePath || null);
        const affected = isFolderCtx ? curPath.startsWith(path + '/') : curPath === path;
        if( affected && sameSource ) clearCurrent = true;
      }
    }
    else if( this.app.currentSnippet ) {
      const extension = this.app.currentSnippet._type === 'yml' ? 'yml' : 'md';
      path = (this.app.currentPath ? this.app.currentPath + '/' : '') + this.app.currentSnippet._name + '.' + extension;
      basePath = this.app.currentBasePath || null;
      clearCurrent = true;
    }
    else {
      return;
    }

    const isFolder    = this.app._deleteContext?.type === 'folder';
    const mergedBases = this.app._deleteContext?.mergedBases;
    let result;

    if( isFolder && mergedBases && mergedBases.length > 1 ) {
      const results = await Promise.all(
        mergedBases.map(base => apiCall(this.app.currentDataPath, 'deleteFolder', { path, targetBase: base }))
      );
      result = { success: results.every(r => r && r.success), message: results.find(r => !r?.success)?.message };
    }
    else if( isFolder ) {
      result = await apiCall(this.app.currentDataPath, 'deleteFolder', { path, targetBase: basePath });
    }
    else {
      result = await apiCall(this.app.currentDataPath, 'deleteSnippet', { path, basePath });
    }

    if( result.success ) {
      showSuccess('Deleted successfully');
      const modal = bootstrap.Modal.getInstance(document.getElementById('deleteSnippetModal'));
      if( modal ) modal.hide();
      this.app._deleteContext = null;
      if( clearCurrent ) {
        this.app.currentSnippet = null;
        this.clearEditForm();
      }
      // Drop recent entries that point at what is gone, or clicking them only shows an error
      this.app.recentSnippets = this.app.recentSnippets.filter(r => r.path !== path && ! r.path.startsWith(path + '/'));
      apiCall(this.app.currentDataPath, 'saveRecentSnippets', { data: this.app.recentSnippets });
      this.app.search.loadRecentSnippets();
      this.app.loadFiles();
    }
    else {
      showError('Failed to delete: ' + (result?.message || 'Unknown error'));
      // A merged folder is deleted per source, so part of it may be gone already - show
      // what is really left rather than the state from before the attempt
      this.app.loadFiles();
    }
  }

  async performRename()
  {
    const ctx = this.app._renameContext;
    if( ! ctx ) return;
    const input = document.getElementById('renameNameInput');
    const safeName = (input?.value || '').trim();
    if( ! safeName ) return;
    const newPath = (ctx.parent ? ctx.parent + '/' : '') + (ctx.type === 'file' && ctx.ext ? (safeName + '.' + ctx.ext) : safeName);

    // One call for all sources: a merged folder has to move everywhere or nowhere, and only
    // the server can undo the halves it already renamed
    const bases = (ctx.mergedBases && ctx.mergedBases.length > 1)
      ? ctx.mergedBases
      : [ctx.basePath || null];

    const result = await apiCall(this.app.currentDataPath, 'renameItem',
      { oldPath: ctx.oldPath, newPath, bases });

    if( result && result.success ) {
      this.followRename(ctx.oldPath, newPath, ctx.type, bases);
      const modal = bootstrap.Modal.getInstance(document.getElementById('renameItemModal')) || new bootstrap.Modal(document.getElementById('renameItemModal'));
      if( modal ) modal.hide();
      if( ctx.parent ) this.app.expandedFolders.add(ctx.parent);
      await this.app.loadFiles();
      const newItem = treeItemByPath(newPath);
      if( newItem ) {
        document.querySelectorAll('.tree-item.active, .file-item.active').forEach(n => n.classList.remove('active'));
        newItem.classList.add('active');
      }
      showSuccess('Renamed successfully');
    }
    else {
      showError('Failed to rename: ' + (result?.message || 'Unknown error'));
      // Reload anyway: the tree still shows the state from before the attempt, which is
      // only right as long as nothing moved
      this.app.loadFiles();
    }
  }

  // Keeps the open snippet pointing at its file after a rename or reorder. Without this
  // the next (auto)save writes the content back under the old name as a second file.
  // bases: the sources the rename happened in (empty / null entries = unknown, not checked)
  followRename(oldPath, newPath, type, bases = [])
  {
    const snippet = this.app.currentSnippet;
    if( ! snippet ) return;

    const knownBases = (bases || []).filter(Boolean);
    if( knownBases.length && this.app.currentBasePath && ! knownBases.includes(this.app.currentBasePath) )
      return;

    const ext     = snippet._type === 'yml' ? 'yml' : 'md';
    const curDir  = this.app.currentPath || '';
    const curPath = (curDir ? curDir + '/' : '') + snippet._name + '.' + ext;

    if( type === 'file' && curPath === oldPath ) {
      const parts = newPath.split('/');
      snippet._name = parts.pop().slice(0, -(ext.length + 1));
      this.app.currentPath     = parts.join('/');
      this.app.currentTreePath = newPath;
    }
    else if( type === 'folder' && (curDir === oldPath || curDir.startsWith(oldPath + '/')) ) {
      this.app.currentPath     = newPath + curDir.slice(oldPath.length);
      this.app.currentTreePath = (this.app.currentPath ? this.app.currentPath + '/' : '') + snippet._name + '.' + ext;
    }
  }

  clearEditForm()
  {
    // The form is going away (delete, data folder switch) - a queued save must not fire
    // against whatever takes its place
    this.clearAutosaveTimer();
    this.app.currentBasePath = null;
    this.app.currentTreePath = null;
    this.setAutosaveStatus(null);

    const editEmptyState = document.getElementById('editEmptyState');
    const editForm = document.getElementById('editForm');

    if( editEmptyState && editForm ) {
      editForm.style.display = 'none';
      editEmptyState.style.display = 'block';
      const inputs = ['snippetSc', 'snippetShort', 'snippetUsage', 'snippetContent'];
      inputs.forEach(id => {
        const input = document.getElementById(id);
        if( input ) input.value = '';
      });
    }

    const fieldContent = document.getElementById('fieldContent');
    if( fieldContent ) fieldContent.className = 'col-md-6 d-flex flex-column';

    this.updateActionButtonsVisibility();
    this.setActionButtonsEnabled(false);
  }

  // File actions (the copy button belongs to the content view, see applyFieldViews)
  updateActionButtonsVisibility()
  {
    const hasSnippet = !!this.app.currentSnippet;

    // With autosave on, Save is only offered while the last autosave was refused
    const saveBtn = document.getElementById('saveSnippetBtn');
    const showSave = hasSnippet && ( ! this.getAutosaveEnabled() || this.app._autosaveFailed );
    if( saveBtn ) saveBtn.style.display = showSave ? '' : 'none';

    const dropdown = document.getElementById('snippetActionsDropdown');
    if( dropdown ) dropdown.style.display = hasSnippet ? '' : 'none';
  }

  setActionButtonsEnabled(enabled)
  {
    ['saveSnippetBtn', 'snippetActionsBtn', 'duplicateSnippetBtn', 'deleteSnippetBtn'].forEach(id => {
      const btn = document.getElementById(id);
      if( btn ) btn.disabled = !enabled;
    });
  }

  async createSnippet()
  {
    const name = document.getElementById('snippetName').value.trim();
    const type = document.getElementById('snippetType').value;

    if( ! name ) {
      showError('Snippet name is required');
      return;
    }

    const data = {
      _type: type,
      _name: name,
      content: type === 'yml' ? 'Some {{ var }} snippet content...' : '# New Markdown File\n\nContent here...'
    };

    if( type === 'yml' ) {
      data.sc = '';
      data.usage = '';
    }

    const extension = type === 'yml' ? 'yml' : 'md';
    const folder = this.app.newItemPath;
    const path = (folder ? folder + '/' : '') + name + '.' + extension;
    const baseFolderSel = document.getElementById('snippetBaseFolder');
    const needTarget     = ! folder || (this.app.currentMergedBases && this.app.currentMergedBases.length > 1);
    const targetBasePath = (needTarget && baseFolderSel && baseFolderSel.options.length > 0)
      ? baseFolderSel.value
      : null;

    // createOnly: a name that is already taken must be reported, never written over
    const payload = { path, data, createOnly: true };
    if( targetBasePath ) payload.targetBasePath = targetBasePath;

    const result = await apiCall(this.app.currentDataPath, 'saveSnippet', payload);

    if( result.success ) {
      if( folder ) this.app.expandedFolders.add(folder);
      await this.app.loadFiles();

      document.querySelectorAll('.tree-item.active, .file-item.active').forEach(item => item.classList.remove('active'));
      const newItem = treeItemByPath(path);
      if( newItem ) newItem.classList.add('active');

      // Open the copy in the source it was just created in, not whichever source wins last
      await this.loadSnippet(path, targetBasePath || null);
      this.app.render.setFieldView('content', 'source');   // a new snippet is there to be written

      const modal = bootstrap.Modal.getInstance(document.getElementById('newSnippetModal'));
      modal.hide();
      document.getElementById('newSnippetForm').reset();
    }
    else {
      showError('Failed to create snippet: ' + result.message);
    }
  }

  async createFolder()
  {
    const name = document.getElementById('folderName').value.trim();

    if( ! name ) {
      showError('Folder name is required');
      return;
    }

    const folder = this.app.newItemPath;
    const folderPath = (folder ? folder + '/' : '') + name;
    const baseFolderSel = document.getElementById('folderBaseFolder');
    const needTarget     = ! folder || (this.app.currentMergedBases && this.app.currentMergedBases.length > 1);
    const targetBasePath = (needTarget && baseFolderSel && baseFolderSel.options.length > 0)
      ? baseFolderSel.value
      : null;

    const payload = { folderPath };
    if( targetBasePath ) payload.targetBasePath = targetBasePath;

    const result = await apiCall(this.app.currentDataPath, 'createFolder', payload);

    if( result.success ) {
      if( folder ) this.app.expandedFolders.add(folder);
      this.app.loadFiles();
      const modal = bootstrap.Modal.getInstance(document.getElementById('newFolderModal'));
      modal.hide();
      document.getElementById('newFolderForm').reset();
    }
    else {
      showError('Failed to create folder: ' + result.message);
    }
  }

  async createLink()
  {
    const raw = document.getElementById('linkTarget').value.trim();
    if( ! raw ) {
      showError('Link target is required');
      return;
    }

    // Accept either a bare name or a pasted marker; reduce to just the target name
    const target = raw.replace(/^(\d{2}[ _.\-]+)?INCLUDE\s+/i, '').trim();
    if( ! target ) {
      showError('Link target is required');
      return;
    }
    if( /[\\/]/.test(target) ) {
      showError('Use a snippet or folder name, not a path');
      return;
    }

    // A link is an empty marker file named "INCLUDE <target>"
    const fileName = 'INCLUDE ' + target;
    const folder   = this.app.newItemPath;
    const linkPath = (folder ? folder + '/' : '') + fileName;

    const baseFolderSel  = document.getElementById('linkBaseFolder');
    const needTarget     = ! folder || (this.app.currentMergedBases && this.app.currentMergedBases.length > 1);
    const targetBasePath = (needTarget && baseFolderSel && baseFolderSel.options.length > 0)
      ? baseFolderSel.value
      : null;

    const payload = { linkPath };
    if( targetBasePath ) payload.targetBasePath = targetBasePath;

    const result = await apiCall(this.app.currentDataPath, 'createLink', payload);

    if( result.success ) {
      if( folder ) this.app.expandedFolders.add(folder);
      await this.app.loadFiles();
      const modal = bootstrap.Modal.getInstance(document.getElementById('newLinkModal'));
      if( modal ) modal.hide();
      document.getElementById('newLinkForm').reset();
      showSuccess('Link created');
    }
    else {
      showError('Failed to create link: ' + result.message);
    }
  }
}
