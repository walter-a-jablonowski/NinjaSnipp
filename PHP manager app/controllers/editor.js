class EditorController
{
  constructor(app)
  {
    this.app = app;
  }

  async loadSnippet(path)
  {
    showLoading('editContent');

    const result = await apiCall(this.app.currentDataPath, 'loadSnippet', { path });

    if( result.success ) {
      this.app.currentSnippet = result.snippet;
      this.renderEditForm(result.snippet);
      // Add to recent snippets and persist
      const item = { path, name: result.snippet._name, timestamp: Date.now() };
      this.app.recentSnippets = this.app.recentSnippets.filter(snippet => snippet.path !== path);
      this.app.recentSnippets.unshift(item);
      this.app.recentSnippets = this.app.recentSnippets.slice(0, 10);
      await apiCall(this.app.currentDataPath, 'saveRecentSnippets', { data: this.app.recentSnippets });

      // Activate the appropriate tab and render
      if( result.snippet._type === 'yml' ) {
        this.app.render.composeAndRenderInline();
        this.updateActionButtonsVisibility();
      }
      else {
        this.app.render.renderMarkdownPreview();
        activateTab('render-tab');
        this.updateActionButtonsVisibility();
      }
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
    const fieldUsage = document.getElementById('fieldUsage');
    const snippetSc = document.getElementById('snippetSc');
    const snippetShort = document.getElementById('snippetShort');
    const snippetUsage = document.getElementById('snippetUsage');
    const snippetContent = document.getElementById('snippetContent');
    const labelSnippetContent = document.getElementById('labelSnippetContent');

    if( ! editForm || ! snippetContent ) return;

    const isYaml = snippet._type === 'yml';

    snippetContent.value = snippet.content || '';

    if( isYaml ) {
      if( snippetSc )    snippetSc.value    = snippet.sc    || '';
      if( snippetShort ) snippetShort.value = snippet.short || '';
      if( snippetUsage )
        snippetUsage.value = this._serializeUsage(snippet.usage);
    }

    if( fieldUsage ) fieldUsage.classList.toggle('force-hide', ! isYaml);

    const fieldContent = document.getElementById('fieldContent');
    if( fieldContent )
      fieldContent.className = isYaml ? 'col-md-6 d-flex flex-column' : 'col-12 d-flex flex-column';

    const editFieldPills = document.getElementById('editFieldPills');
    if( editFieldPills ) editFieldPills.style.display = isYaml ? 'flex' : 'none';

    const editFieldsRow    = document.getElementById('editFieldsRow');
    const usageFieldPill   = document.getElementById('usageFieldPill');
    const contentFieldPill = document.getElementById('contentFieldPill');
    if( editFieldsRow ) {
      editFieldsRow.classList.remove('mobile-usage-active');
      editFieldsRow.classList.add('mobile-content-active');
    }
    if( usageFieldPill ) usageFieldPill.classList.remove('active');
    if( contentFieldPill ) contentFieldPill.classList.add('active');
    if( isYaml ) this.app.render.showUsagePreview();
    else this.app.render.resetUsagePreview();

    if( labelSnippetContent ) {
      if( isYaml ) {
        labelSnippetContent.style.display = '';
        labelSnippetContent.classList.add('d-none', 'd-md-block');
      }
      else {
        labelSnippetContent.style.display = 'none';
        labelSnippetContent.classList.remove('d-none', 'd-md-block');
      }
    }

    const usagePreviewBtnMobile = document.getElementById('usagePreviewBtnMobile');
    if( usagePreviewBtnMobile ) usagePreviewBtnMobile.style.display = 'none';

    if( editEmptyState ) editEmptyState.style.display = 'none';
    editForm.style.display = 'flex';

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

    this.configureRenderTab(true);
    this.setActionButtonsEnabled(true);
  }

  configureRenderTab(enabled)
  {
    const renderTab = document.getElementById('render-tab');
    if( renderTab ) {
      renderTab.disabled = !enabled;
      renderTab.classList.toggle('disabled', !enabled);
      const tabLi = renderTab.closest('li');
      if( tabLi ) tabLi.style.display = enabled ? '' : 'none';
    }
  }

  async saveCurrentSnippet()
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
      data.usage = document.getElementById('snippetUsage')?.value.trim() || '';
    }

    const extension = this.app.currentSnippet._type === 'yml' ? 'yml' : 'md';
    const path = (this.app.currentPath ? this.app.currentPath + '/' : '') + data._name + '.' + extension;

    const result = await apiCall(this.app.currentDataPath, 'saveSnippet', { path, data });

    if( result.success ) {
      const silent = arguments[0] === true || (typeof arguments[0] === 'object' && arguments[0]?.silent === true);
      if( ! silent ) showSuccess('Snippet saved successfully');
      this.app.currentSnippet = data;
      this.app.loadFiles();

      if( this.app.currentSnippet._type === 'yml' ) {
        this.app.render.composeAndRenderInline();
      }
    }
    else {
      showError('Failed to save snippet: ' + result.message);
    }
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

    const result = await apiCall(this.app.currentDataPath, 'duplicateSnippet', { sourcePath, targetPath });
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
    let clearCurrent = false;

    if( this.app._deleteContext ) {
      path = this.app._deleteContext.path;
      if( this.app.currentSnippet ) {
        const ext = this.app.currentSnippet._type === 'yml' ? 'yml' : 'md';
        const curPath = (this.app.currentPath ? this.app.currentPath + '/' : '') + this.app.currentSnippet._name + '.' + ext;
        if( curPath === path ) clearCurrent = true;
      }
    }
    else if( this.app.currentSnippet ) {
      const extension = this.app.currentSnippet._type === 'yml' ? 'yml' : 'md';
      path = (this.app.currentPath ? this.app.currentPath + '/' : '') + this.app.currentSnippet._name + '.' + extension;
      clearCurrent = true;
    }
    else {
      return;
    }

    const isFolder = this.app._deleteContext?.type === 'folder';
    const result = await apiCall(this.app.currentDataPath, isFolder ? 'deleteFolder' : 'deleteSnippet', { path });
    if( result.success ) {
      showSuccess('Deleted successfully');
      const modal = bootstrap.Modal.getInstance(document.getElementById('deleteSnippetModal'));
      if( modal ) modal.hide();
      this.app._deleteContext = null;
      if( clearCurrent ) {
        this.app.currentSnippet = null;
        this.clearEditForm();
      }
      this.app.loadFiles();
    }
    else {
      showError('Failed to delete: ' + (result?.message || 'Unknown error'));
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
    const result = await apiCall(this.app.currentDataPath, 'renameItem', { oldPath: ctx.oldPath, newPath });
    if( result && result.success ) {
      const modal = bootstrap.Modal.getInstance(document.getElementById('renameItemModal')) || new bootstrap.Modal(document.getElementById('renameItemModal'));
      if( modal ) modal.hide();
      if( ctx.parent ) this.app.expandedFolders.add(ctx.parent);
      await this.app.loadFiles();
      const newItem = document.querySelector(`.tree-item[data-path="${newPath}"]`);
      if( newItem ) {
        document.querySelectorAll('.tree-item.active, .file-item.active').forEach(n => n.classList.remove('active'));
        newItem.classList.add('active');
      }
      showSuccess('Renamed successfully');
    }
    else {
      showError('Failed to rename: ' + (result?.message || 'Unknown error'));
    }
  }

  clearEditForm()
  {
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

    const editFieldPills = document.getElementById('editFieldPills');
    if( editFieldPills ) editFieldPills.style.display = 'none';
    const editFieldsRow = document.getElementById('editFieldsRow');
    if( editFieldsRow ) {
      editFieldsRow.classList.remove('mobile-usage-active');
      editFieldsRow.classList.add('mobile-content-active');
    }
    this.app.render.resetUsagePreview();

    const renderRow = document.getElementById('renderRow');
    const mdPreview = document.getElementById('markdownPreview');
    if( renderRow ) renderRow.style.display = '';
    if( mdPreview ) mdPreview.style.display = 'none';

    const fieldContent = document.getElementById('fieldContent');
    if( fieldContent ) fieldContent.className = 'col-md-6 d-flex flex-column';

    this.configureRenderTab(false);
    this.setActionButtonsEnabled(false);
  }

  updateActionButtonsVisibility()
  {
    const activeTab = document.querySelector('#contentTabs .nav-link.active');
    const show = activeTab && activeTab.id === 'edit-tab';

    const saveBtn = document.getElementById('saveSnippetBtn');
    if( saveBtn ) saveBtn.style.display = show ? '' : 'none';

    const hasSnippet = !!this.app.currentSnippet;
    const dropdown = document.getElementById('snippetActionsDropdown');
    if( dropdown ) dropdown.style.display = hasSnippet ? '' : 'none';

    ['snippetActionsEditGroup', 'snippetActionsEditDivider',
     'snippetActionsDeleteGroup', 'snippetActionsDeleteDivider'].forEach(id => {
      const el = document.getElementById(id);
      if( el ) el.style.display = show ? '' : 'none';
    });

    const copyBtn         = document.getElementById('copyRenderedBtn');
    const renderToggleBtn = document.getElementById('renderViewToggleBtn');
    const renderActive    = !!(activeTab && activeTab.id === 'render-tab');
    const canRender       = !!(this.app.currentSnippet && this.app.currentSnippet._type === 'yml');
    if( copyBtn )         copyBtn.style.display         = (renderActive && canRender) ? '' : 'none';
    if( renderToggleBtn ) renderToggleBtn.style.display = (renderActive && canRender) ? '' : 'none';

    const autosaveWrap = document.getElementById('autosaveSwitchWrapper');
    if( autosaveWrap ) autosaveWrap.style.display = show ? '' : 'none';
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
    const path = (this.app.currentPath ? this.app.currentPath + '/' : '') + name + '.' + extension;
    const baseFolderSel = document.getElementById('snippetBaseFolder');
    const targetBasePath = (! this.app.currentPath && baseFolderSel && baseFolderSel.options.length > 0)
      ? baseFolderSel.value
      : null;

    const payload = { path, data };
    if( targetBasePath ) payload.targetBasePath = targetBasePath;

    const result = await apiCall(this.app.currentDataPath, 'saveSnippet', payload);

    if( result.success ) {
      if( this.app.currentPath ) this.app.expandedFolders.add(this.app.currentPath);
      await this.app.loadFiles();

      document.querySelectorAll('.tree-item.active, .file-item.active').forEach(item => item.classList.remove('active'));
      const newItem = document.querySelector(`.tree-item[data-path="${path}"]`);
      if( newItem ) newItem.classList.add('active');
      await this.loadSnippet(path);
      activateTab('edit-tab');

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

    const folderPath = (this.app.currentPath ? this.app.currentPath + '/' : '') + name;
    const baseFolderSel = document.getElementById('folderBaseFolder');
    const targetBasePath = (! this.app.currentPath && baseFolderSel && baseFolderSel.options.length > 0)
      ? baseFolderSel.value
      : null;

    const payload = { folderPath };
    if( targetBasePath ) payload.targetBasePath = targetBasePath;

    const result = await apiCall(this.app.currentDataPath, 'createFolder', payload);

    if( result.success ) {
      if( this.app.currentPath ) this.app.expandedFolders.add(this.app.currentPath);
      this.app.loadFiles();
      const modal = bootstrap.Modal.getInstance(document.getElementById('newFolderModal'));
      modal.hide();
      document.getElementById('newFolderForm').reset();
    }
    else {
      showError('Failed to create folder: ' + result.message);
    }
  }

  // Serialize usage object to editable YAML text for the textarea
  _serializeUsage(u)
  {
    if( ! u ) return '';
    if( typeof u === 'string' ) return u;

    const parts  = [];
    const indent = '  ';

    const addBlock = (key, value) => {
      if( value == null ) return;
      const indented = String(value).split('\n').map(l => indent + l).join('\n').trimEnd();
      parts.push(`${key}: |\n${indented}`);
    };

    const addMapping = (key, obj) => {
      if( ! obj || typeof obj !== 'object' ) return;
      const entries = Object.entries(obj);
      if( ! entries.length ) return;
      const rows = entries.map(([k, v]) => `${indent}${k}: ${v ?? ''}`).join('\n');
      parts.push(`${key}:\n${rows}`);
    };

    addBlock('head', u.head);
    addMapping('maybe', u.maybe);
    addMapping('vars', u.vars);
    addBlock('text', u.text);

    return parts.join('\n\n');
  }
}
