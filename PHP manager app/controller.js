class SnippetManager
{
  constructor()
  {
    // Shared state accessed by sub-controllers via this.app
    this.currentPath = '';
    this.currentSnippet = null;
    this.currentDataPath = '';
    this.searchHistory = [];
    this.recentSnippets = [];
    this.selectedFiles = new Set();
    this.placeholderGroups = new Map(); // name => [elements]
    this.renderedText = '';
    this.fileTree = []; // Tree state for file navigator
    this.baseFolderLabels = {}; // path => label map from last listFiles call
    this.expandedFolders = new Set(); // Paths of currently expanded folders
    this._deleteContext = null; // Context for deleting via tree-item "..." menu
    this.isSearchMode = false; // Track if we're showing search results
    this._mdAutoHeight = false; // reuse flag for content auto-height
    this._onResizeHandler = null;
    this._initialLoad = true; // Flag for initial page load
    this._initialContentHeight = null; // Initial height of content textarea
    this._contentExpanded = false; // Flag for expanded content area
    this.userSettings = {}; // loaded from users/default/settings.yml
    this._autosaveTimer = null; // debounce timer id
    this._autosaveDelayMs = 800; // debounce delay for autosave
    this._autosaveBound = false; // ensure we bind handlers once
    this._lineWrapOff = true; // global line-wrap toggle state

    // Sub-controllers (each receives `this` as `app`)
    this.tree   = new FileTreeController(this);
    this.editor = new EditorController(this);
    this.render = new RenderController(this);
    this.search = new SearchController(this);

    this.init();
  }

  handleFileListDropdownClick(e) { this.tree.handleFileListDropdownClick(e); }

  enableMdTextareaAutoHeight()
  {
    this._mdAutoHeight = true;
    // Apply immediately
    this.resizeMdTextarea();
    this.resizeInlineSnippet();
    // Extra delayed recalculation to account for late layout/Font/BS paints
    setTimeout(() => {
      if( this._mdAutoHeight ) {
        this.resizeMdTextarea();
        this.resizeInlineSnippet();
      }
    }, 120);
    // Bind resize once
    if( ! this._onResizeHandler ) {
      this._onResizeHandler = () => {
        if( this._mdAutoHeight ) {
          this.resizeMdTextarea();
          this.resizeInlineSnippet();
        }
      };
      window.addEventListener('resize', this._onResizeHandler);
    }
  }

  disableMdTextareaAutoHeight()
  {
    this._mdAutoHeight = false;
    const ta = document.getElementById('snippetContent');
    if( ta ) {
      ta.style.height = '';
    }
  }

  resizeMdTextarea()
  {
    const ta = document.getElementById('snippetContent');
    if( ! ta ) return;
    if( ! this.currentSnippet ) return;
    // Compute available height from textarea top to viewport bottom with a small padding
    const rect = ta.getBoundingClientRect();
    const bottomPadding = 8; // gap below textarea
    const available = Math.max(200, Math.floor(window.innerHeight - rect.top - bottomPadding));
    ta.style.height = available + 'px';

    // Also constrain fieldUsage height so fieldSc stays visible
    const fieldUsage = document.getElementById('fieldUsage');
    if( fieldUsage && window.innerWidth >= 768 ) {
      const fuRect = fieldUsage.getBoundingClientRect();
      const fuAvailable = Math.floor(window.innerHeight - fuRect.top - 8);
      fieldUsage.style.height = Math.max(100, fuAvailable) + 'px';
    }
    else if( fieldUsage ) {
      fieldUsage.style.height = ''; // let CSS flex handle it on mobile
    }

  }

  resizeInlineSnippet()
  {
    if( ! this.currentSnippet ) return;

    // Markdown: resize the markdown preview panel
    if( this.currentSnippet._type !== 'yml' ) {
      const mp = document.getElementById('markdownPreview');
      if( ! mp || mp.style.display === 'none' ) return;
      const rect = mp.getBoundingClientRect();
      const available = Math.max(200, Math.floor(window.innerHeight - rect.top - 8));
      mp.style.height = available + 'px';
      mp.style.overflowY = 'auto';
      mp.style.overflowX = this._lineWrapOff ? 'auto' : 'hidden';
      return;
    }

    // YAML: resize inline snippet and usage preview
    const el = document.getElementById('inlineSnippet');
    if( ! el ) return;
    const rect = el.getBoundingClientRect();
    const available = Math.max(200, Math.floor(window.innerHeight - rect.top - 8));
    el.style.height = available + 'px';
    el.style.overflowY = 'auto';
    el.style.overflowX = this._lineWrapOff ? 'auto' : 'hidden';
    // Keep usage preview the same height so both columns align
    const renderUsage = document.getElementById('renderUsage');
    if( renderUsage ) renderUsage.style.height = available + 'px';
  }

  async init()
  {
    this.bindEvents();
    const dataFolderDropdown = document.getElementById('dataFolderDropdown');
    this.currentDataPath = dataFolderDropdown?.dataset.current || '';
    // Load server-backed user lists (single user)
    try {
      const [h, r] = await Promise.all([
        apiCall(this.currentDataPath, 'getSearchHistory'),
        apiCall(this.currentDataPath, 'getRecentSnippets')
      ]);
      this.searchHistory = (h && h.success && Array.isArray(h.data)) ? h.data : [];
      this.recentSnippets = (r && r.success && Array.isArray(r.data)) ? r.data : [];
    }
    catch( e ) {
      this.searchHistory = [];
      this.recentSnippets = [];
    }
    // Load user settings (e.g., edit.autosave)
    await this.loadUserSettings();
    this.loadFiles();
    this.search.loadRecentSnippets();
    this.search.setupSearchHistory();
  }

  bindEvents()
  {
    // Search
    const searchInput = document.getElementById('searchInput');
    if( searchInput ) {
      searchInput.addEventListener('input', (e) => this.search.handleSearch(e.target.value));
      searchInput.addEventListener('keydown', (e) => {
        if( e.key === 'Enter' ) this.search.performSearch();
        if( e.key === 'ArrowDown' || e.key === 'ArrowUp' ) {
          this.navigateSearchHistory(e.key);
          e.preventDefault();
        }
      });
    }

    // Button bindings
    const buttonEvents = [
      ['searchBtn',          'click', () => this.search.performSearch()],
      ['newSnippetBtn',      'click', () => { this.currentPath = ''; this.currentMergedBases = null; showModal('newSnippetModal'); }],
      ['newFolderBtn',       'click', () => { this.currentPath = ''; this.currentMergedBases = null; showModal('newFolderModal'); }],
      ['newSnippetDropBtn',  'click', () => { this.currentPath = ''; this.currentMergedBases = null; showModal('newSnippetModal'); }],
      ['newFolderDropBtn',   'click', () => { this.currentPath = ''; this.currentMergedBases = null; showModal('newFolderModal'); }],
      ['backBtn',            'click', () => this.goBack()],
      ['createSnippetBtn',   'click', () => this.editor.createSnippet()],
      ['createFolderBtn',    'click', () => this.editor.createFolder()],
      ['render-tab',         'click', () => this.render.composeAndRenderInline()],
      ['copyRenderedBtn',    'click', () => this.render.copyRenderedContent()],
      ['saveSnippetBtn',     'click', () => this.editor.saveCurrentSnippet()],
      ['duplicateSnippetBtn','click', () => this.editor.duplicateCurrentSnippet()],
      ['deleteSnippetBtn',   'click', () => this.editor.deleteCurrentSnippet()],
      ['toggleLineWrapBtn',  'click', () => this.render.toggleLineWrap()],
      ['aiBtn',              'click', () => this.toggleAiSidebar()],
      ['aiSidebarClose',     'click', () => this.toggleAiSidebar(false)],
      ['confirmDuplicateBtn','click', () => this.editor.performDuplicate()],
      ['confirmDeleteBtn',   'click', () => this.editor.performDelete()],
      ['recent-tab',         'click', () => this.search.loadRecentSnippets()],
      ['confirmRenameBtn',   'click', () => this.editor.performRename()]
    ];

    buttonEvents.forEach(([elementId, event, handler]) => {
      const element = document.getElementById(elementId);
      if( element ) element.addEventListener(event, handler);
    });

    // Data folder dropdown in navbar
    const dataFolderDropdown = document.getElementById('dataFolderDropdown');
    if( dataFolderDropdown )
      dataFolderDropdown.addEventListener('click', (e) => {
        const item = e.target.closest('[data-label]');
        if( ! item ) return;
        e.preventDefault();
        this.changeDataFolder(item.dataset.label);
      });

    // New snippet modal: show/hide source folder select
    const newSnippetModalEl = document.getElementById('newSnippetModal');
    if( newSnippetModalEl ) {
      newSnippetModalEl.addEventListener('show.bs.modal', () => {
        const row     = document.getElementById('snippetBaseFolderRow');
        const sel     = document.getElementById('snippetBaseFolder');
        const atRoot  = ! this.currentPath;
        const merged  = this.currentMergedBases;
        this._populateBaseFolderSelect(sel, merged);
        const show = (atRoot || (merged && merged.length > 1)) && sel && sel.options.length > 1;
        if( row ) row.style.display = show ? '' : 'none';
      });
      newSnippetModalEl.addEventListener('shown.bs.modal', () => {
        const input = document.getElementById('snippetName');
        if( input ) input.focus();
      });
    }

    // New folder modal: show/hide source folder select
    const newFolderModalEl = document.getElementById('newFolderModal');
    if( newFolderModalEl ) {
      newFolderModalEl.addEventListener('show.bs.modal', () => {
        const row     = document.getElementById('folderBaseFolderRow');
        const sel     = document.getElementById('folderBaseFolder');
        const atRoot  = ! this.currentPath;
        const merged  = this.currentMergedBases;
        this._populateBaseFolderSelect(sel, merged);
        const show = (atRoot || (merged && merged.length > 1)) && sel && sel.options.length > 1;
        if( row ) row.style.display = show ? '' : 'none';
      });
      newFolderModalEl.addEventListener('shown.bs.modal', () => {
        const input = document.getElementById('folderName');
        if( input ) input.focus();
      });
    }

    // Duplicate modal: prefill and focus
    const dupModalEl = document.getElementById('duplicateSnippetModal');
    if( dupModalEl ) {
      dupModalEl.addEventListener('shown.bs.modal', () => {
        const input = document.getElementById('duplicateNameInput');
        if( input ) {
          const base = this.currentSnippet ? (this.currentSnippet._name + '_copy') : '';
          if( base ) input.value = base;
          input.focus();
          input.select();
        }
      });
    }

    // Rename modal: focus input
    const renameModalEl = document.getElementById('renameItemModal');
    if( renameModalEl ) {
      renameModalEl.addEventListener('shown.bs.modal', () => {
        const input = document.getElementById('renameNameInput');
        if( input ) { input.focus(); input.select(); }
      });
    }

    // Delete modal: inject snippet name
    const delModalEl = document.getElementById('deleteSnippetModal');
    if( delModalEl ) {
      delModalEl.addEventListener('show.bs.modal', () => {
        const nameEl = document.getElementById('deleteSnippetName');
        if( nameEl && this.currentSnippet ) nameEl.textContent = this.currentSnippet._name;
      });
    }

    // Form Enter-key submit handlers
    this._bindFormSubmit('newSnippetForm', () => this.editor.createSnippet());
    this._bindFormSubmit('newFolderForm',  () => this.editor.createFolder());
    this._bindFormSubmit('duplicateSnippetForm', () => this.editor.performDuplicate());
    this._bindFormSubmit('renameItemForm', () => this.editor.performRename());

    // Tab switching
    document.querySelectorAll('#contentTabs [data-bs-toggle="tab"]').forEach(btn =>
      btn.addEventListener('shown.bs.tab', () => {
        this.editor.updateActionButtonsVisibility();
        this.render.applyLineWrap();
        this.resizeMdTextarea();
        this.resizeInlineSnippet();
      })
    );

    // Global click: file navigation + context menu
    document.addEventListener('click', (e) => {
      if( e.target.closest('.dropdown') || e.target.closest('.dropdown-menu') ) return;
      if( e.target.closest('.tree-item') || e.target.closest('.file-item') ) this.tree.handleFileClick(e);
      else this.search.hideContextMenu();
    });

    document.addEventListener('contextmenu', (e) => {
      if( e.target.closest('.tree-item') || e.target.closest('.file-item') ) {
        e.preventDefault();
        this.search.showContextMenu(e);
      }
    });

    // Initial state
    this.editor.updateActionButtonsVisibility();
    this.editor.setActionButtonsEnabled(false);

    // Autosave toggle
    const autosaveSwitch = document.getElementById('autosaveSwitch');
    if( autosaveSwitch ) {
      autosaveSwitch.addEventListener('change', async () => {
        const enabled = !!autosaveSwitch.checked;
        await this.setAutosave(enabled);
        if( ! enabled ) this.editor.clearAutosaveTimer();
      });
    }

    // Recalc heights after full page load
    window.addEventListener('load', () => {
      this.resizeMdTextarea();
      this.resizeInlineSnippet();
    });

    // File list: dropdown clicks + keyboard navigation focus tracking
    const fileList = document.getElementById('fileList');
    if( fileList ) {
      fileList.addEventListener('click', (e) => this.tree.handleFileListDropdownClick(e));
      fileList.addEventListener('focusin', (e) => {
        const item = e.target.closest('.tree-item');
        if( item ) this._focusedTreeItem = item;
      });
    }
    document.addEventListener('keydown', (e) => this.tree.fileListKeyDown(e));

    // Mobile Usage/Content pill switcher
    const usageFieldPill   = document.getElementById('usageFieldPill');
    const contentFieldPill = document.getElementById('contentFieldPill');
    const editFieldsRow    = document.getElementById('editFieldsRow');
    if( usageFieldPill && contentFieldPill && editFieldsRow ) {
      const usagePreviewBtnMobile = document.getElementById('usagePreviewBtnMobile');
      const setMobileEyeVisible = (visible) => {
        if( usagePreviewBtnMobile ) usagePreviewBtnMobile.style.display = visible ? '' : 'none';
      };
      usageFieldPill.addEventListener('click', () => {
        editFieldsRow.classList.add('mobile-usage-active');
        editFieldsRow.classList.remove('mobile-content-active');
        usageFieldPill.classList.add('active');
        contentFieldPill.classList.remove('active');
        setMobileEyeVisible(true);
      });
      contentFieldPill.addEventListener('click', () => {
        editFieldsRow.classList.add('mobile-content-active');
        editFieldsRow.classList.remove('mobile-usage-active');
        contentFieldPill.classList.add('active');
        usageFieldPill.classList.remove('active');
        setMobileEyeVisible(false);
        this.render.resetUsagePreview();
      });
    }

    // Usage preview buttons
    const usagePreviewBtn       = document.getElementById('usagePreviewBtn');
    const usagePreviewBtnMobile = document.getElementById('usagePreviewBtnMobile');
    if( usagePreviewBtn )       usagePreviewBtn.addEventListener('click', () => this.render.toggleUsagePreview());
    if( usagePreviewBtnMobile ) usagePreviewBtnMobile.addEventListener('click', () => this.render.toggleUsagePreview());

    // Render view toggle (mobile)
    const renderViewToggleBtn = document.getElementById('renderViewToggleBtn');
    if( renderViewToggleBtn ) renderViewToggleBtn.addEventListener('click', () => this.render.toggleRenderView());

    // Bind autosave handlers to edit form inputs (once)
    this.editor.bindAutosaveHandlers();

    this.initSidebarResize();
  }

  initSidebarResize()
  {
    const handle  = document.getElementById('sidebarResizeHandle');
    const sidebar = document.querySelector('.app-sidebar');
    if( ! handle || ! sidebar ) return;

    const minWidth     = 280;
    const defaultWidth = 280;

    const applyWidth = (w) => {
      sidebar.style.setProperty('--sidebar-width', w + 'px');
    };

    // Restore persisted width
    const saved = parseInt(localStorage.getItem('sidebarWidth'), 10);
    if( ! isNaN(saved) && saved >= minWidth )
      applyWidth(saved);

    // Double-click: reset to default
    handle.addEventListener('dblclick', () => {
      applyWidth(defaultWidth);
      localStorage.removeItem('sidebarWidth');
    });

    handle.addEventListener('mousedown', (e) => {
      if( e.button !== 0 ) return;
      e.preventDefault();

      const startX     = e.clientX;
      const startWidth = sidebar.getBoundingClientRect().width;

      document.body.classList.add('sidebar-resizing');

      const onMove = (e) => {
        const maxWidth = Math.floor(window.innerWidth * 0.5);
        const newWidth = Math.min(maxWidth, Math.max(minWidth, startWidth + e.clientX - startX));
        applyWidth(newWidth);
      };

      const onUp = () => {
        document.body.classList.remove('sidebar-resizing');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);

        const w = Math.round(sidebar.getBoundingClientRect().width);
        if( w !== defaultWidth )
          localStorage.setItem('sidebarWidth', w);
        else
          localStorage.removeItem('sidebarWidth');
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  _bindFormSubmit(formId, handler)
  {
    const form = document.getElementById(formId);
    if( ! form ) return;
    form.addEventListener('submit', (e) => { e.preventDefault(); handler(); });
    form.addEventListener('keydown', (e) => {
      if( e.key === 'Enter' && ! e.shiftKey && ! e.ctrlKey && ! e.altKey && ! e.metaKey ) {
        e.preventDefault();
        handler();
      }
    });
  }

  async performRename() { return this.editor.performRename(); }

  // --- Delegates to sub-controllers ---
  // (implementations live in controllers/file-tree.js, editor.js, render.js, search.js)

  buildTreeNodes(files)          { return this.tree.buildTreeNodes(files); }
  findNodeInTree(nodes, path)    { return this.tree.findNodeInTree(nodes, path); }
  flattenTree(nodes, depth = 0)  { return this.tree.flattenTree(nodes, depth); }

  async restoreExpandedFolders(nodes) { return this.tree.restoreExpandedFolders(nodes); }

  async toggleFolder(path)        { return this.tree.toggleFolder(path); }
  renderTree()                    { return this.tree.renderTree(); }
  restoreActiveHighlight()        { return this.tree.restoreActiveHighlight(); }

  renderTreeNode(node)           { return this.tree.renderTreeNode(node); }

  fileListKeyDown(e)              { return this.tree.fileListKeyDown(e); }

  goBack()
  {
    if( this.isSearchMode ) {
      this.isSearchMode = false;
      const searchInput = document.getElementById('searchInput');
      if( searchInput ) searchInput.value = '';
      this.loadFiles();
    }
  }

  handleFileClick(e)              { return this.tree.handleFileClick(e); }

  async loadSnippet(path)         { return this.editor.loadSnippet(path); }

  renderEditForm(snippet)         { return this.editor.renderEditForm(snippet); }
  configureRenderTab(enabled)     { return this.editor.configureRenderTab(enabled); }

  async saveCurrentSnippet()      { return this.editor.saveCurrentSnippet(); }
  bindAutosaveHandlers()          { return this.editor.bindAutosaveHandlers(); }
  onEditFieldChanged()            { return this.editor.onEditFieldChanged(); }
  getAutosaveEnabled()            { return this.editor.getAutosaveEnabled(); }
  scheduleAutosave()              { return this.editor.scheduleAutosave(); }
  clearAutosaveTimer()            { return this.editor.clearAutosaveTimer(); }
  async autosaveIfEnabled()       { return this.editor.autosaveIfEnabled(); }
  async duplicateCurrentSnippet() { return this.editor.duplicateCurrentSnippet(); }
  async performDuplicate()        { return this.editor.performDuplicate(); }
  async deleteCurrentSnippet()    { return this.editor.deleteCurrentSnippet(); }
  async performDelete()           { return this.editor.performDelete(); }
  clearEditForm()                 { return this.editor.clearEditForm(); }
  updateActionButtonsVisibility() { return this.editor.updateActionButtonsVisibility(); }

  async loadUserSettings()
  {
    try {
      const res = await apiCall(this.currentDataPath, 'getUserSettings');
      if( res && res.success ) {
        this.userSettings = res.settings || {};
      }
      else {
        this.userSettings = {};
      }
    }
    catch( e ) {
      this.userSettings = {};
    }
    const autosaveSwitch = document.getElementById('autosaveSwitch');
    if( autosaveSwitch ) {
      const enabled = !!(this.userSettings.edit && this.userSettings.edit.autosave);
      autosaveSwitch.checked = enabled;
    }
  }

  async setAutosave(enabled)
  {
    if( ! this.userSettings.edit ) this.userSettings.edit = {};
    this.userSettings.edit.autosave = !!enabled;
    const payload = { settings: { edit: { autosave: !!enabled } } };
    const res = await apiCall(this.currentDataPath, 'setUserSettings', payload);
    if( ! (res && res.success) ) showError('Failed to save settings');
  }

  setActionButtonsEnabled(enabled) { return this.editor.setActionButtonsEnabled(enabled); }

  toggleAiSidebar(open)
  {
    const sidebar = document.getElementById('aiSidebar');
    if( ! sidebar ) return;
    const isOpen = open !== undefined ? open : ! sidebar.classList.contains('open');
    sidebar.classList.toggle('open', isOpen);
  }

  toggleLineWrap()               { return this.render.toggleLineWrap(); }
  applyLineWrap()                { return this.render.applyLineWrap(); }

  async composeAndRenderInline()  { return this.render.composeAndRenderInline(); }
  renderMarkdownPreview()         { return this.render.renderMarkdownPreview(); }
  renderInlineSnippet(t)          { return this.render.renderInlineSnippet(t); }

  buildInlineHtmlFromComposed(t)  { return this.render.buildInlineHtmlFromComposed(t); }
  bindInlinePlaceholderEvents()   { return this.render.bindInlinePlaceholderEvents(); }
  openChoiceMenu(el)              { return this.render.openChoiceMenu(el); }
  closeChoiceMenu()               { return this.render.closeChoiceMenu(); }
  _buildUsageMetaHtml()           { return this.render._buildUsageMetaHtml(); }
  _buildUsageHtml()               { return this.render._buildUsageHtml(); }
  toggleUsagePreview()            { return this.render.toggleUsagePreview(); }
  resetUsagePreview()             { return this.render.resetUsagePreview(); }
  showUsagePreview()              { return this.render.showUsagePreview(); }
  _setUsagePreviewIcon(c)         { return this.render._setUsagePreviewIcon(c); }
  renderUsageInPreview()          { return this.render.renderUsageInPreview(); }
  toggleRenderView()              { return this.render.toggleRenderView(); }
  getCurrentPlaceholderValues()   { return this.render.getCurrentPlaceholderValues(); }
  async updateRenderedOutput()    { return this.render.updateRenderedOutput(); }
  async copyRenderedContent()     { return this.render.copyRenderedContent(); }

  async performSearch()           { return this.search.performSearch(); }
  renderSearchResults(r)          { return this.search.renderSearchResults(r); }
  handleSearch(q)                 { return this.search.handleSearch(q); }
  showSearchHistory()             { return this.search.showSearchHistory(); }
  hideSearchHistory()             { return this.search.hideSearchHistory(); }
  setupSearchHistory()            { return this.search.setupSearchHistory(); }
  showContextMenu(e)              { return this.search.showContextMenu(e); }
  hideContextMenu()               { return this.search.hideContextMenu(); }
  loadRecentSnippets()            { return this.search.loadRecentSnippets(); }
  async createSnippet()           { return this.editor.createSnippet(); }
  async createFolder()            { return this.editor.createFolder(); }

  // --- Kept in main: data-folder switching and top-level file loading ---

  async changeDataFolder(dataPath)
  {
    this.currentDataPath = dataPath;
    const result = await apiCall(this.currentDataPath, 'setDataPath', { dataPath });

    if( result.success ) {
      this._updateBrandLabel(dataPath);
      this.currentPath = '';
      this.fileTree = [];
      this.expandedFolders.clear();
      this.currentSnippet = null;
      this.clearEditForm();
      const recentResult = await apiCall(this.currentDataPath, 'getRecentSnippets');
      if( recentResult.success ) this.recentSnippets = recentResult.data;
      this.loadFiles();
    }
    else {
      showError('Failed to change data folder: ' + result.message);
    }
  }

  // Populates a <select> with source folder options.
  // overrideBases: array of physical paths to use instead of all baseFolderLabels (for merged folder context)
  _populateBaseFolderSelect(sel, overrideBases = null)
  {
    if( ! sel ) return;
    sel.innerHTML = '';
    const labels  = this.baseFolderLabels || {};
    const entries = overrideBases
      ? overrideBases.map(p => [p, labels[p] || p.split('/').pop()])
      : Object.entries(labels);
    entries.forEach(([path, label]) => {
      const opt = document.createElement('option');
      opt.value = path;
      opt.textContent = label;
      sel.appendChild(opt);
    });
  }

  _updateBrandLabel(label)
  {
    document.querySelectorAll('#dataFolderDropdown .dropdown-item').forEach(item => {
      item.classList.toggle('active', item.dataset.label === label);
    });
    const el = document.getElementById('brandDataLabel');
    const elMobile = document.getElementById('brandDataLabelMobile');
    if( el ) el.textContent = label;
    if( elMobile ) elMobile.textContent = label;
  }

  // apiCall moved to global helper in lib/functions.js

  async loadFiles()
  {
    showLoading('fileList');

    const result = await apiCall(this.currentDataPath, 'listFiles', { subPath: '' });

    if( result.success ) {
      this.isSearchMode = false;
      this.baseFolderLabels = result.baseFolderLabels || {};
      this.fileTree = this.buildTreeNodes(result.files);
      await this.restoreExpandedFolders(this.fileTree);
      this.renderTree();

      // Auto-load first yml/md file on initial page load
      if( this._initialLoad ) {
        const firstFile = result.files.find(f => f.type === 'file' && (f.extension === 'yml' || f.extension === 'md'));
        if( firstFile ) {
          const fileItem = document.querySelector(`.tree-item[data-path="${firstFile.path}"]`);
          if( fileItem ) fileItem.classList.add('active');
          this.currentPath = '';
          this.loadSnippet(firstFile.path);
        }
        this._initialLoad = false;
      }
    }
    else {
      showError('Failed to load files: ' + result.message);
    }

    hideLoading('fileList');
  }

  // showLoading/hideLoading moved to global helpers in lib/functions.js

}
