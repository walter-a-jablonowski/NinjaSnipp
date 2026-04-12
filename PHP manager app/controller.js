class SnippetManager
{
  constructor()
  {
    this.currentPath = '';
    this.currentSnippet = null;
    this.currentDataPath = '';
    this.searchHistory = [];
    this.recentSnippets = [];
    this.selectedFiles = new Set();
    this.placeholderGroups = new Map(); // name => [elements]
    this.renderedText = '';
    this.fileTree = []; // Tree state for file navigator
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

    this.init();
  }

  handleFileListDropdownClick(e)
  {
    const actionEl = e.target.closest('.dropdown-item');
    if( ! actionEl ) return;
    const action = actionEl.getAttribute('data-action');
    const item   = actionEl.closest('.tree-item');
    if( ! item ) return;
    const path = item.getAttribute('data-path');
    const type = item.getAttribute('data-type');
    const ext  = item.getAttribute('data-extension') || '';

    if( action === 'rename' ) {
      const parts    = path.split('/');
      const filename = parts.pop();
      const parent   = parts.join('/');
      let base = filename;
      if( type === 'file' && ext ) {
        const dExt = '.' + ext;
        if( base.toLowerCase().endsWith(dExt) ) base = base.slice(0, -dExt.length);
      }
      this._renameContext = { oldPath: path, parent, type, ext };
      const input = document.getElementById('renameNameInput');
      if( input ) input.value = base;
      showModal('renameItemModal');
    }
    else if( action === 'new-snippet' ) {
      // Create new snippet inside this folder
      this.currentPath = path;
      if( path ) this.expandedFolders.add(path);
      showModal('newSnippetModal');
    }
    else if( action === 'new-folder' ) {
      // Create new subfolder inside this folder
      this.currentPath = path;
      if( path ) this.expandedFolders.add(path);
      showModal('newFolderModal');
    }
    else if( action === 'delete' ) {
      const nameParts = path.split('/');
      const fullName  = nameParts.pop();
      const baseName  = ext ? fullName.replace(new RegExp('\\.' + ext + '$', 'i'), '') : fullName;
      this._deleteContext = { path, name: baseName };
      const nameEl = document.getElementById('deleteSnippetName');
      if( nameEl ) nameEl.textContent = baseName;
      showModal('deleteSnippetModal');
    }
  }

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

    // Also constrain fieldUsage height so fieldSh stays visible
    const fieldUsage = document.getElementById('fieldUsage');
    if( fieldUsage && window.innerWidth >= 768 ) {
      const fuRect = fieldUsage.getBoundingClientRect();
      const fuAvailable = Math.floor(window.innerHeight - fuRect.top - 8);
      fieldUsage.style.height = Math.max(100, fuAvailable) + 'px';
    }
    else if( fieldUsage ) {
      fieldUsage.style.height = ''; // let CSS flex handle it on mobile
    }

    this.debugShPosition(); // DEBUG
  }

  debugShPosition()
  {
    const fieldUsage  = document.getElementById('fieldUsage');
    const snippetUsage = document.getElementById('snippetUsage');
    const fieldSh     = document.getElementById('fieldSh');
    if( ! fieldSh || ! fieldUsage ) return;

    const s = (e, p) => window.getComputedStyle(e).getPropertyValue(p);
    const fuRect  = fieldUsage.getBoundingClientRect();
    const shRect  = fieldSh.getBoundingClientRect();
    const usRect  = snippetUsage ? snippetUsage.getBoundingClientRect() : null;

    console.group('fieldSh position debug');
    console.log('viewport                   :', window.innerHeight);
    console.log('#fieldUsage  top/bottom    :', Math.round(fuRect.top), '/', Math.round(fuRect.bottom), '| oh:', fieldUsage.offsetHeight);
    console.log('#fieldUsage  display/flex  :', s(fieldUsage, 'display'), '/', s(fieldUsage, 'flex-direction'));
    console.log('#snippetUsage top/bottom   :', usRect ? `${Math.round(usRect.top)} / ${Math.round(usRect.bottom)} | oh:${snippetUsage.offsetHeight}` : 'null');
    console.log('#fieldSh     top/bottom    :', Math.round(shRect.top), '/', Math.round(shRect.bottom), '| oh:', fieldSh.offsetHeight);
    console.log('#fieldSh     below viewport:', shRect.bottom > window.innerHeight);
    console.log('#fieldSh     flex-shrink   :', s(fieldSh, 'flex-shrink'));
    console.groupEnd();
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
      return;
    }

    // YAML: resize inline snippet and usage preview
    const el = document.getElementById('inlineSnippet');
    if( ! el ) return;
    const rect = el.getBoundingClientRect();
    const available = Math.max(200, Math.floor(window.innerHeight - rect.top - 8));
    el.style.height = available + 'px';
    el.style.overflowY = 'auto';
    // Keep usage preview the same height so both columns align
    const renderUsage = document.getElementById('renderUsage');
    if( renderUsage ) renderUsage.style.height = available + 'px';
  }

  async init()
  {
    this.bindEvents();
    const dataFolderSelect = document.getElementById('dataFolderSelect');
    this.currentDataPath = dataFolderSelect?.value || '';
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
    this.loadRecentSnippets();
    this.setupSearchHistory();
  }

  bindEvents()
  {
    // Search functionality
    const searchInput = document.getElementById('searchInput');
    if( searchInput ) {
      searchInput.addEventListener('input', (e) => this.handleSearch(e.target.value));
      searchInput.addEventListener('keydown', (e) => {
        if( e.key === 'Enter' ) this.performSearch();
        if( e.key === 'ArrowDown' || e.key === 'ArrowUp' ) {
          this.navigateSearchHistory(e.key);
          e.preventDefault();
        }
      });
    }

    // Button event bindings
    const buttonEvents = [
      ['searchBtn', 'click', () => this.performSearch()],
      ['dataFolderSelect', 'change', (e) => this.changeDataFolder(e.target.value)],
      ['newSnippetBtn', 'click', () => showModal('newSnippetModal')],
      ['newFolderBtn', 'click', () => showModal('newFolderModal')],
      ['backBtn', 'click', () => this.goBack()],
      ['createSnippetBtn', 'click', () => this.createSnippet()],
      ['createFolderBtn', 'click', () => this.createFolder()],
      ['render-tab', 'click', () => this.composeAndRenderInline()],
      ['copyRenderedBtn', 'click', () => this.copyRenderedContent()],
      ['saveSnippetBtn', 'click', () => this.saveCurrentSnippet()],
      ['duplicateSnippetBtn', 'click', () => this.duplicateCurrentSnippet()],
      ['deleteSnippetBtn', 'click', () => this.deleteCurrentSnippet()],
      ['confirmDuplicateBtn', 'click', () => this.performDuplicate()],
      ['confirmDeleteBtn', 'click', () => this.performDelete()],
      ['recent-tab', 'click', () => this.loadRecentSnippets()],
      ['confirmRenameBtn', 'click', () => this.performRename()]
    ];

    buttonEvents.forEach(([elementId, event, handler]) => {
      const element = document.getElementById(elementId);
      if( element ) element.addEventListener(event, handler);
    });

    // Auto-focus inputs when modals open
    const newSnippetModalEl = document.getElementById('newSnippetModal');
    if( newSnippetModalEl ) {
      newSnippetModalEl.addEventListener('shown.bs.modal', () => {
        const input = document.getElementById('snippetName');
        if( input ) input.focus();
      });
    }

    const newFolderModalEl = document.getElementById('newFolderModal');
    if( newFolderModalEl ) {
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
        if( input ) {
          input.focus();
          input.select();
        }
      });
    }

    // Delete modal: inject name
    const delModalEl = document.getElementById('deleteSnippetModal');
    if( delModalEl ) {
      delModalEl.addEventListener('show.bs.modal', () => {
        const nameEl = document.getElementById('deleteSnippetName');
        if( nameEl && this.currentSnippet ) nameEl.textContent = this.currentSnippet._name;
      });
    }

    // Allow pressing Enter to submit the New Snippet and New Folder forms
    const newSnippetForm = document.getElementById('newSnippetForm');
    if( newSnippetForm ) {
      // Submit event (covers Enter in most browsers)
      newSnippetForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.createSnippet();
      });
      // Keydown fallback to ensure Enter triggers create
      newSnippetForm.addEventListener('keydown', (e) => {
        // Avoid interfering with multiline inputs (none here) and modifiers
        if( e.key === 'Enter' && ! e.shiftKey && ! e.ctrlKey && ! e.altKey && ! e.metaKey ) {
          e.preventDefault();
          this.createSnippet();
        }
      });
    }

    const newFolderForm = document.getElementById('newFolderForm');
    if( newFolderForm ) {
      newFolderForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.createFolder();
      });
      newFolderForm.addEventListener('keydown', (e) => {
        if( e.key === 'Enter' && ! e.shiftKey && ! e.ctrlKey && ! e.altKey && ! e.metaKey ) {
          e.preventDefault();
          this.createFolder();
        }
      });
    }

    // Duplicate form: submit with Enter
    const dupForm = document.getElementById('duplicateSnippetForm');
    if( dupForm ) {
      dupForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.performDuplicate();
      });
      dupForm.addEventListener('keydown', (e) => {
        if( e.key === 'Enter' && ! e.shiftKey && ! e.ctrlKey && ! e.altKey && ! e.metaKey ) {
          e.preventDefault();
          this.performDuplicate();
        }
      });
    }

    // Rename form: submit with Enter
    const renameForm = document.getElementById('renameItemForm');
    if( renameForm ) {
      renameForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.performRename();
      });
      renameForm.addEventListener('keydown', (e) => {
        if( e.key === 'Enter' && ! e.shiftKey && ! e.ctrlKey && ! e.altKey && ! e.metaKey ) {
          e.preventDefault();
          this.performRename();
        }
      });
    }

    // Tab switching visibility
    document.querySelectorAll('#contentTabs [data-bs-toggle="tab"]').forEach(btn =>
      btn.addEventListener('shown.bs.tab', (e) => {
        this.updateActionButtonsVisibility();
        // Recompute heights when switching tabs
        this.resizeMdTextarea();
        this.resizeInlineSnippet();
      })
    );

    // Global document events
    document.addEventListener('click', (e) => {
      // If the click is inside any dropdown control or its menu, don't trigger navigation
      if( e.target.closest('.dropdown') || e.target.closest('.dropdown-menu') ) return;
      if( e.target.closest('.tree-item') || e.target.closest('.file-item') ) this.handleFileClick(e);
      else this.hideContextMenu();
    });

    document.addEventListener('contextmenu', (e) => {
      if( e.target.closest('.tree-item') || e.target.closest('.file-item') ) {
        e.preventDefault();
        this.showContextMenu(e);
      }
    });

    // Initial state
    this.updateActionButtonsVisibility();
    this.setActionButtonsEnabled(false);

    // Bind autosave toggle
    const autosaveSwitch = document.getElementById('autosaveSwitch');
    if( autosaveSwitch ) {
      autosaveSwitch.addEventListener('change', async () => {
        const enabled = !!autosaveSwitch.checked;
        await this.setAutosave(enabled);
        if( ! enabled ) this.clearAutosaveTimer();
      });
    }

    // After full page load (fonts, BS), recalc heights once
    window.addEventListener('load', () => {
      this.resizeMdTextarea();
      this.resizeInlineSnippet();
    });

    // File list dropdown actions (delegate)
    const fileList = document.getElementById('fileList');
    if( fileList ) fileList.addEventListener('click', (e) => this.handleFileListDropdownClick(e));

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
        this.resetUsagePreview();
      });
    }

    // Usage preview buttons
    const usagePreviewBtn       = document.getElementById('usagePreviewBtn');
    const usagePreviewBtnMobile = document.getElementById('usagePreviewBtnMobile');
    if( usagePreviewBtn )       usagePreviewBtn.addEventListener('click', () => this.toggleUsagePreview());
    if( usagePreviewBtnMobile ) usagePreviewBtnMobile.addEventListener('click', () => this.toggleUsagePreview());

    // Render tab: mobile view toggle
    const renderViewToggleBtn = document.getElementById('renderViewToggleBtn');
    if( renderViewToggleBtn ) renderViewToggleBtn.addEventListener('click', () => this.toggleRenderView());

    // Bind autosave handlers to edit form inputs (once)
    this.bindAutosaveHandlers();
  }

  async performRename()
  {
    const ctx = this._renameContext;
    if( ! ctx ) return;
    const input = document.getElementById('renameNameInput');
    const safeName = (input?.value || '').trim();
    if( ! safeName ) return;
    const newPath = (ctx.parent ? ctx.parent + '/' : '') + (ctx.type === 'file' && ctx.ext ? (safeName + '.' + ctx.ext) : safeName);
    const result = await apiCall(this.currentDataPath, 'renameItem', { oldPath: ctx.oldPath, newPath });
    if( result && result.success ) {
      const modal = bootstrap.Modal.getInstance(document.getElementById('renameItemModal')) || new bootstrap.Modal(document.getElementById('renameItemModal'));
      if( modal ) modal.hide();
      // Ensure the parent folder stays expanded after refresh
      if( ctx.parent ) this.expandedFolders.add(ctx.parent);
      await this.loadFiles();
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

  // --- Tree state helpers ---

  buildTreeNodes(files)
  {
    return files.map(file => ({
      name: file.name,
      path: file.path,
      type: file.type,
      extension: file.extension || '',
      modified: file.modified || null,
      isIncluded: file.isIncluded || false,
      color: file.color || null,
      children: file.type === 'folder' ? null : undefined,
      isOpen: false
    }));
  }

  findNodeInTree(nodes, path)
  {
    for( const node of nodes ) {
      if( node.path === path ) return node;
      if( node.type === 'folder' && node.children ) {
        const found = this.findNodeInTree(node.children, path);
        if( found ) return found;
      }
    }
    return null;
  }

  flattenTree(nodes, depth = 0)
  {
    const result = [];
    for( const node of nodes ) {
      result.push({ ...node, _depth: depth });
      if( node.type === 'folder' && node.isOpen && node.children )
        result.push(...this.flattenTree(node.children, depth + 1));
    }
    return result;
  }

  async restoreExpandedFolders(nodes)
  {
    for( const node of nodes ) {
      if( node.type === 'folder' && this.expandedFolders.has(node.path) ) {
        node.isOpen = true;
        if( node.children === null ) {
          const result = await apiCall(this.currentDataPath, 'listFiles', { subPath: node.path });
          if( result.success )
            node.children = this.buildTreeNodes(result.files);
        }
        if( node.children )
          await this.restoreExpandedFolders(node.children);
      }
    }
  }

  async toggleFolder(path)
  {
    const node = this.findNodeInTree(this.fileTree, path);
    if( ! node || node.type !== 'folder' ) return;

    if( node.isOpen ) {
      node.isOpen = false;
      this.expandedFolders.delete(path);
    }
    else {
      if( node.children === null ) {
        const result = await apiCall(this.currentDataPath, 'listFiles', { subPath: path });
        if( result.success )
          node.children = this.buildTreeNodes(result.files);
        else {
          showError('Failed to load folder');
          return;
        }
      }
      node.isOpen = true;
      this.expandedFolders.add(path);
    }

    this.renderTree();
  }

  // --- Tree rendering ---

  renderTree()
  {
    const fileList = document.getElementById('fileList');
    if( ! fileList ) return;

    const flat = this.flattenTree(this.fileTree);

    if( flat.length === 0 ) {
      fileList.innerHTML = `
        <div class="empty-state">
          <i class="bi bi-folder-x"></i>
          <p>No files found</p>
        </div>
      `;
      return;
    }

    fileList.innerHTML = flat.map(node => this.renderTreeNode(node)).join('');
    this.restoreActiveHighlight();
  }

  restoreActiveHighlight()
  {
    if( ! this.currentSnippet ) return;
    const ext = this.currentSnippet._type === 'yml' ? 'yml' : 'md';
    const activePath = (this.currentPath ? this.currentPath + '/' : '') + this.currentSnippet._name + '.' + ext;
    const item = document.querySelector(`.tree-item[data-path="${activePath}"]`);
    if( item ) item.classList.add('active');
  }

  renderTreeNode(node)
  {
    const { type, _depth, path, name, isOpen, extension, isIncluded, color } = node;
    const isFolder  = type === 'folder';
    const indentPx  = 6 + _depth * 14;

    const icon = isFolder
      ? (isOpen ? 'bi-folder2-open' : 'bi-folder')
      : (extension === 'yml' ? 'bi-file-code' : 'bi-file-text');

    const toggleEl = isFolder
      ? `<i class="bi ${isOpen ? 'bi-chevron-down' : 'bi-chevron-right'} tree-toggle"></i>`
      : `<span class="tree-toggle-spacer"></span>`;

    const includedIcon = isIncluded
      ? '<i class="bi bi-link-45deg text-primary ms-1" title="Included file"></i>'
      : '';

    const styleVal = color
      ? `padding-left: ${indentPx}px; background-color: ${color};`
      : `padding-left: ${indentPx}px;`;

    const menuItems = isFolder
      ? `<li><a class="dropdown-item small" href="#" data-action="new-snippet">New Snippet here</a></li>
         <li><a class="dropdown-item small" href="#" data-action="new-folder">New Folder here</a></li>
         <li><hr class="dropdown-divider"></li>
         <li><a class="dropdown-item small" href="#" data-action="rename">Rename</a></li>`
      : `<li><a class="dropdown-item small" href="#" data-action="rename">Rename</a></li>
         <li><a class="dropdown-item small text-danger" href="#" data-action="delete">Delete</a></li>`;

    return `<div class="tree-item${isFolder ? ' tree-folder' : ' tree-file'}" ` +
      `data-path="${path}" data-type="${type}" data-extension="${extension || ''}" ` +
      `style="${styleVal}">` +
      `<div class="d-flex align-items-center">` +
        toggleEl +
        `<i class="bi ${icon} file-icon"></i>` +
        `<span class="tree-name flex-grow-1">${name}${includedIcon}</span>` +
        `<div class="dropdown">` +
          `<button class="btn btn-sm btn-link text-muted p-0 tree-menu-btn" type="button" ` +
            `data-bs-toggle="dropdown" aria-expanded="false" aria-label="More actions">` +
            `<i class="bi bi-three-dots-vertical"></i>` +
          `</button>` +
          `<ul class="dropdown-menu dropdown-menu-end">${menuItems}</ul>` +
        `</div>` +
      `</div>` +
    `</div>`;
  }

  goBack()
  {
    // In tree mode goBack only handles exiting search mode
    if( this.isSearchMode ) {
      this.isSearchMode = false;
      const searchInput = document.getElementById('searchInput');
      if( searchInput ) searchInput.value = '';
      this.loadFiles();
    }
  }

  handleFileClick(e)
  {
    const treeItem = e.target.closest('.tree-item');
    const fileItem = e.target.closest('.file-item'); // search results use file-item
    const item = treeItem || fileItem;
    if( ! item ) return;

    const { path, type } = item.dataset;

    if( type === 'folder' ) {
      // Toggle folder expand/collapse (only for tree-items, not search results)
      if( treeItem ) this.toggleFolder(path);
      return;
    }

    // File: update active state and load snippet
    document.querySelectorAll('.tree-item.active, .file-item.active').forEach(i => i.classList.remove('active'));
    item.classList.add('active');

    // Set currentPath to the file's parent folder
    const parts = path.split('/');
    parts.pop();
    this.currentPath = parts.join('/');

    this.loadSnippet(path);

    // Auto-close sidebar on mobile
    if( window.innerWidth < 992 ) {
      const sidebar = document.getElementById('sidebarNav');
      const offcanvas = bootstrap.Offcanvas.getInstance(sidebar);
      if( offcanvas ) offcanvas.hide();
    }
  }

  async loadSnippet(path)
  {
    showLoading('editContent');

    const result = await apiCall(this.currentDataPath, 'loadSnippet', { path });

    if( result.success ) {
      this.currentSnippet = result.snippet;
      this.renderEditForm(result.snippet);
      // Inline: add to recent snippets and persist
      const item = { path, name: result.snippet._name, timestamp: Date.now() };
      this.recentSnippets = this.recentSnippets.filter(snippet => snippet.path !== path);
      this.recentSnippets.unshift(item);
      this.recentSnippets = this.recentSnippets.slice(0, 10);
      await apiCall(this.currentDataPath, 'saveRecentSnippets', { data: this.recentSnippets });

      // Activate the appropriate tab and render
      if( result.snippet._type === 'yml' ) {
        // YAML: render inline snippet, stay on Preview tab
        this.composeAndRenderInline();
        this.updateActionButtonsVisibility();
      }
      else {
        // Markdown: render preview, show Preview tab by default
        this.renderMarkdownPreview();
        activateTab('render-tab');
        this.updateActionButtonsVisibility();
      }
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
    const fieldSh = document.getElementById('fieldSh');
    const fieldUsage = document.getElementById('fieldUsage');
    const snippetSh = document.getElementById('snippetSh');
    const snippetUsage = document.getElementById('snippetUsage');
    const snippetContent = document.getElementById('snippetContent');
    const labelSnippetContent = document.getElementById('labelSnippetContent');

    if( ! editForm || ! snippetContent ) return;

    const isYaml = snippet._type === 'yml';

    // Populate form fields
    snippetContent.value = snippet.content || '';

    if( isYaml ) {
      if( snippetSh ) snippetSh.value = snippet.sh || '';
      if( snippetUsage ) snippetUsage.value = snippet.usage || '';
    }

    // Toggle YAML-only fields visibility (use class to beat Bootstrap's d-flex !important)
    [fieldSh, fieldUsage].forEach(field => {
      if( field ) field.classList.toggle('force-hide', ! isYaml);
    });

    // Content column: full width for Markdown, half for YAML (usage takes the other half)
    const fieldContent = document.getElementById('fieldContent');
    if( fieldContent )
      fieldContent.className = isYaml ? 'col-md-6 d-flex flex-column' : 'col-12 d-flex flex-column';

    // Mobile pill nav: only relevant for YAML (d-md-none keeps it hidden on desktop)
    const editFieldPills = document.getElementById('editFieldPills');
    if( editFieldPills ) editFieldPills.style.display = isYaml ? 'flex' : 'none';

    // Reset pill state to default (Content active) on each snippet load
    const editFieldsRow    = document.getElementById('editFieldsRow');
    const usageFieldPill   = document.getElementById('usageFieldPill');
    const contentFieldPill = document.getElementById('contentFieldPill');
    if( editFieldsRow ) {
      editFieldsRow.classList.remove('mobile-usage-active');
      editFieldsRow.classList.add('mobile-content-active');
    }
    if( usageFieldPill ) usageFieldPill.classList.remove('active');
    if( contentFieldPill ) contentFieldPill.classList.add('active');
    if( isYaml ) this.showUsagePreview();
    else this.resetUsagePreview();

    // Content label: hidden for markdown (single field needs no label); for YAML show on desktop only
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

    // Mobile eye icon: only visible when Usage pill is active (Content is default)
    const usagePreviewBtnMobile = document.getElementById('usagePreviewBtnMobile');
    if( usagePreviewBtnMobile ) usagePreviewBtnMobile.style.display = 'none';

    // Show form, hide empty state
    if( editEmptyState ) editEmptyState.style.display = 'none';
    editForm.style.display = 'flex';

    // Make editors taller to fill available vertical space for YAML and Markdown
    // Do it after the form becomes visible to get correct element geometry
    requestAnimationFrame(() => {
      // Handle content height for YAML files after layout settles
      if( isYaml ) {
        if( this._initialContentHeight === null ) {
          this._initialContentHeight = 300;
        }
      }

      this.enableMdTextareaAutoHeight();
      // One more frame to ensure layout has fully settled
      requestAnimationFrame(() => {
        this.resizeMdTextarea();
        if( this.currentSnippet && this.currentSnippet._type === 'yml' ) this.resizeInlineSnippet();
      });
      // And once more after a brief delay to fix initial load oversizing
      setTimeout(() => {
        this.resizeMdTextarea();
        if( this.currentSnippet && this.currentSnippet._type === 'yml' ) this.resizeInlineSnippet();
      }, 150);
    });

    // Render tab is always enabled (YAML gets inline snippet, MD gets markdown preview)
    this.configureRenderTab(true);
    this.setActionButtonsEnabled(true);
  }

  configureRenderTab(enabled)
  {
    const renderTab = document.getElementById('render-tab');
    if( renderTab ) {
      renderTab.disabled = !enabled;
      renderTab.classList.toggle('disabled', !enabled);
      // Hide the tab entirely when disabled (e.g., for Markdown files)
      const tabLi = renderTab.closest('li');
      if( tabLi ) tabLi.style.display = enabled ? '' : 'none';
    }
  }

  async saveCurrentSnippet()
  {
    if( ! this.currentSnippet ) return;

    const contentInput = document.getElementById('snippetContent');

    if( ! contentInput.value.trim() ) {
      showError('Content is required');
      return;
    }

    const data = {
      _type: this.currentSnippet._type,
      _name: this.currentSnippet._name,
      content: contentInput.value
    };

    if( this.currentSnippet._type === 'yml' ) {
      const shInput = document.getElementById('snippetSh');
      const usageInput = document.getElementById('snippetUsage');

      data.sh = shInput.value.trim();
      data.usage = usageInput.value.trim();
    }

    const extension = this.currentSnippet._type === 'yml' ? 'yml' : 'md';
    const path = (this.currentPath ? this.currentPath + '/' : '') + data._name + '.' + extension;

    const result = await apiCall(this.currentDataPath, 'saveSnippet', { path, data });

    if( result.success ) {
      // If called with silent flag, don't pop success toast
      const silent = arguments[0] === true || (typeof arguments[0] === 'object' && arguments[0]?.silent === true);
      if( ! silent ) showSuccess('Snippet saved successfully');
      this.currentSnippet = data;
      this.loadFiles(); // Refresh file list

      // Re-render after save when YAML
      if( this.currentSnippet._type === 'yml' ) {
        this.composeAndRenderInline();
      }
    }
    else {
      showError('Failed to save snippet: ' + result.message);
    }
  }

  bindAutosaveHandlers()
  {
    if( this._autosaveBound ) return;
    const shEl = document.getElementById('snippetSh');
    const usageEl = document.getElementById('snippetUsage');
    const contentEl = document.getElementById('snippetContent');
    const handler = () => this.onEditFieldChanged();
    [shEl, usageEl, contentEl].forEach(el => {
      if( el ) {
        el.addEventListener('input', handler);
        el.addEventListener('blur', handler);
      }
    });
    this._autosaveBound = true;
  }

  onEditFieldChanged()
  {
    if( ! this.getAutosaveEnabled() ) return;
    if( ! this.currentSnippet ) return;
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
    this._autosaveTimer = setTimeout(() => {
      this.autosaveIfEnabled();
    }, this._autosaveDelayMs);
  }

  clearAutosaveTimer()
  {
    if( this._autosaveTimer ) {
      clearTimeout(this._autosaveTimer);
      this._autosaveTimer = null;
    }
  }

  async autosaveIfEnabled()
  {
    this._autosaveTimer = null;
    if( ! this.getAutosaveEnabled() ) return;
    if( ! this.currentSnippet ) return;
    // Save silently
    await this.saveCurrentSnippet(true);
  }

  async duplicateCurrentSnippet()
  {
    if( ! this.currentSnippet ) return;
    // Open modal; confirm handled by performDuplicate()
    showModal('duplicateSnippetModal');
  }

  async performDuplicate()
  {
    if( ! this.currentSnippet ) return;
    const input = document.getElementById('duplicateNameInput');
    const newName = input ? input.value.trim() : '';
    if( ! newName ) return;

    const extension = this.currentSnippet._type === 'yml' ? 'yml' : 'md';
    const sourcePath = (this.currentPath ? this.currentPath + '/' : '') + this.currentSnippet._name + '.' + extension;
    const targetPath = (this.currentPath ? this.currentPath + '/' : '') + newName + '.' + extension;

    const result = await apiCall(this.currentDataPath, 'duplicateSnippet', { sourcePath, targetPath });
    if( result.success ) {
      showSuccess('Snippet duplicated successfully');
      // Close modal
      const modal = bootstrap.Modal.getInstance(document.getElementById('duplicateSnippetModal'));
      if( modal ) modal.hide();
      this.loadFiles();
    }
    else {
      showError('Failed to duplicate snippet: ' + result.message);
    }
  }

  async deleteCurrentSnippet()
  {
    if( ! this.currentSnippet ) return;
    this._deleteContext = null; // ensure we use currentSnippet, not a tree-item context
    showModal('deleteSnippetModal');
  }

  async performDelete()
  {
    let path;
    let clearCurrent = false;

    if( this._deleteContext ) {
      // Delete triggered from tree "..." menu
      path = this._deleteContext.path;
      // If we're deleting the currently loaded snippet, clear the editor
      if( this.currentSnippet ) {
        const ext = this.currentSnippet._type === 'yml' ? 'yml' : 'md';
        const curPath = (this.currentPath ? this.currentPath + '/' : '') + this.currentSnippet._name + '.' + ext;
        if( curPath === path ) clearCurrent = true;
      }
    }
    else if( this.currentSnippet ) {
      // Delete triggered from toolbar
      const extension = this.currentSnippet._type === 'yml' ? 'yml' : 'md';
      path = (this.currentPath ? this.currentPath + '/' : '') + this.currentSnippet._name + '.' + extension;
      clearCurrent = true;
    }
    else {
      return;
    }

    const result = await apiCall(this.currentDataPath, 'deleteSnippet', { path });
    if( result.success ) {
      showSuccess('Deleted successfully');
      const modal = bootstrap.Modal.getInstance(document.getElementById('deleteSnippetModal'));
      if( modal ) modal.hide();
      this._deleteContext = null;
      if( clearCurrent ) {
        this.currentSnippet = null;
        this.clearEditForm();
      }
      this.loadFiles();
    }
    else {
      showError('Failed to delete: ' + (result?.message || 'Unknown error'));
    }
  }

  clearEditForm()
  {
    const editEmptyState = document.getElementById('editEmptyState');
    const editForm = document.getElementById('editForm');

    if( editEmptyState && editForm ) {
      editForm.style.display = 'none';
      editEmptyState.style.display = 'block';

      // Clear form values
      const inputs = ['snippetSh', 'snippetUsage', 'snippetContent'];
      inputs.forEach(id => {
        const input = document.getElementById(id);
        if( input ) input.value = '';
      });
    }

    // Reset mobile pill nav
    const editFieldPills = document.getElementById('editFieldPills');
    if( editFieldPills ) editFieldPills.style.display = 'none';
    const editFieldsRow = document.getElementById('editFieldsRow');
    if( editFieldsRow ) {
      editFieldsRow.classList.remove('mobile-usage-active');
      editFieldsRow.classList.add('mobile-content-active');
    }
    this.resetUsagePreview();

    // Reset render pane to YAML layout defaults
    const renderRow = document.getElementById('renderRow');
    const mdPreview = document.getElementById('markdownPreview');
    if( renderRow ) renderRow.style.display = '';
    if( mdPreview ) mdPreview.style.display = 'none';

    // Reset content column to half-width default
    const fieldContent = document.getElementById('fieldContent');
    if( fieldContent ) fieldContent.className = 'col-md-6 d-flex flex-column';

    this.configureRenderTab(false);
    this.setActionButtonsEnabled(false);
  }

  updateActionButtonsVisibility()
  {
    const activeTab = document.querySelector('#contentTabs .nav-link.active');
    const show = activeTab && activeTab.id === 'edit-tab';

    ['saveSnippetBtn', 'duplicateSnippetBtn', 'deleteSnippetBtn'].forEach(id => {
      const btn = document.getElementById(id);
      if( btn ) btn.style.display = show ? '' : 'none';
    });

    // Copy + render view toggle: only visible on Render tab when a YAML snippet is loaded
    const copyBtn         = document.getElementById('copyRenderedBtn');
    const renderToggleBtn = document.getElementById('renderViewToggleBtn');
    const renderActive    = !!(activeTab && activeTab.id === 'render-tab');
    const canRender       = !!(this.currentSnippet && this.currentSnippet._type === 'yml');
    if( copyBtn )         copyBtn.style.display         = (renderActive && canRender) ? '' : 'none';
    if( renderToggleBtn ) renderToggleBtn.style.display = (renderActive && canRender) ? '' : 'none';

    // Autosave switch is visible only on Edit tab
    const autosaveWrap = document.getElementById('autosaveSwitchWrapper');
    if( autosaveWrap ) autosaveWrap.style.display = show ? '' : 'none';
  }

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
    // Reflect autosave state
    const autosaveSwitch = document.getElementById('autosaveSwitch');
    if( autosaveSwitch ) {
      const enabled = !!(this.userSettings.edit && this.userSettings.edit.autosave);
      autosaveSwitch.checked = enabled;
    }
  }

  async setAutosave(enabled)
  {
    // Update local cache
    if( ! this.userSettings.edit ) this.userSettings.edit = {};
    this.userSettings.edit.autosave = !!enabled;
    // Persist to server
    const payload = { settings: { edit: { autosave: !!enabled } } };
    const res = await apiCall(this.currentDataPath, 'setUserSettings', payload);
    if( ! (res && res.success) ) {
      showError('Failed to save settings');
    }
  }

  setActionButtonsEnabled(enabled)
  {
    ['saveSnippetBtn', 'duplicateSnippetBtn', 'deleteSnippetBtn'].forEach(id => {
      const btn = document.getElementById(id);
      if( btn ) btn.disabled = !enabled;
    });
  }

  // activateTab moved to global helper in lib/functions.js

  async composeAndRenderInline()
  {
    if( ! this.currentSnippet ) return;

    // Markdown: delegate to simple markdown renderer
    if( this.currentSnippet._type !== 'yml' ) {
      this.renderMarkdownPreview();
      return;
    }

    const snippetContent = document.getElementById('snippetContent');
    const inlineContainer = document.getElementById('inlineSnippet');
    if( ! snippetContent || ! inlineContainer ) return;

    // Ensure correct panels are shown for YAML
    const renderRow    = document.getElementById('renderRow');
    const mdPreview    = document.getElementById('markdownPreview');
    if( renderRow )  renderRow.style.display  = '';
    if( mdPreview )  mdPreview.style.display  = 'none';

    const snippet = { ...this.currentSnippet, content: snippetContent.value };
    const result = await apiCall(this.currentDataPath, 'composeContent', { snippet });
    if( result.success ) {
      this.renderInlineSnippet(result.composed || '');
      this.renderUsageInPreview();
      // Reset render view to snippet on each re-render
      if( renderRow ) {
        renderRow.classList.add('render-snippet-active');
        renderRow.classList.remove('render-usage-active');
      }
      const renderToggleBtn = document.getElementById('renderViewToggleBtn');
      if( renderToggleBtn ) {
        const icon = renderToggleBtn.querySelector('i');
        if( icon ) icon.className = 'bi bi-card-text';
      }
      // Also update live preview initially with defaults
      this.updateRenderedOutput();
      // Adjust preview height after (re)render
      this.resizeInlineSnippet();
    }
  }

  renderMarkdownPreview()
  {
    const renderRow = document.getElementById('renderRow');
    const mdPreview = document.getElementById('markdownPreview');
    if( ! mdPreview ) return;

    // Show markdown preview, hide YAML inline snippet row
    if( renderRow ) renderRow.style.display = 'none';
    mdPreview.style.display = '';

    const content = document.getElementById('snippetContent')?.value || '';
    mdPreview.innerHTML = marked.parse(content);
    this.resizeInlineSnippet(); // routes to MD resize path
  }

  renderInlineSnippet(composedText)
  {
    const container = document.getElementById('inlineSnippet');
    if( ! container ) return;
    // Build HTML with editable placeholders
    const html = this.buildInlineHtmlFromComposed(composedText);
    container.innerHTML = html;
    this.bindInlinePlaceholderEvents();
  }

  buildInlineHtmlFromComposed(text)
  {
    // First pass: convert MAYBE to HTML structure
    const maybeStack = [];
    const maybeR2 = /<<<MAYBE:START:([^>]+)>>>|<<<MAYBE:END>>>/g;
    let processedText = text.replace(maybeR2, (match, name) => {
      if( match.startsWith('<<<MAYBE:START:') ) {
        maybeStack.push(name);
        return `<<<MAYBE-DIV-START:${name}>>>`;
      }
      else {
        maybeStack.pop();
        return '<<<MAYBE-DIV-END>>>';
      }
    });

    const regex = /\{\{\s*([^}]*)\s*\}\}/g;
    let lastIndex = 0;
    let match;
    let out = '';
    // Track open include wrappers across placeholder boundaries
    const incStack = [];

    // Helper to emit literal text that may contain include and MAYBE-DIV
    const emitLiteralWithInc = (literal, idxTag) => {
      if( ! literal ) return;
      const maybeR = /(<<<INC:START:([^>]+)>>>|<<<INC:END>>>|<<<MAYBE-DIV-START:([^>]+)>>>|<<<MAYBE-DIV-END>>>)/g;
      let pos = 0;
      let m;
      while( (m = maybeR.exec(literal)) ) {
        const before = literal.slice(pos, m.index);
        if( before ) {
          out += `<span class="ph-literal" contenteditable="true" tabindex="-1" data-chunk="${idxTag}">${escapeHtml(before)}</span>`;
        }
        const token = m[1];
        if( token.startsWith('<<<INC:START:') ) {
          const name = m[2] || '';
          out += `<span class="inc-block" data-inc="${escapeHtml(name)}">`;
          incStack.push({type: 'inc', name});
        }
        else if( token === '<<<INC:END>>>' ) {
          if( incStack.length > 0 && incStack[incStack.length - 1].type === 'inc' ) {
            incStack.pop();
            out += `</span>`;
          }
        }
        else if( token.startsWith('<<<MAYBE-DIV-START:') ) {
          const name = m[3] || '';
          out += `<div class="maybe-block" data-maybe="${escapeHtml(name)}" data-enabled="true">`;
          out += `<div class="maybe-header">`;
          out += `<input type="checkbox" class="maybe-checkbox" checked> `;
          out += `<span class="maybe-label">${escapeHtml(name)}</span>`;
          out += `</div>`;
          out += `<div class="maybe-content">`;
          incStack.push({type: 'maybe', name});
        }
        else if( token === '<<<MAYBE-DIV-END>>>' ) {
          if( incStack.length > 0 && incStack[incStack.length - 1].type === 'maybe' ) {
            incStack.pop();
            out += `</div>`; // close maybe-content
            out += `<div class="maybe-end"></div>`; // add footer line
            out += `</div>`; // close maybe-block
          }
        }
        pos = maybeR.lastIndex;
      }
      const tail = literal.slice(pos);
      if( tail ) {
        out += `<span class="ph-literal" contenteditable="true" tabindex="-1" data-chunk="${idxTag}-tail">${escapeHtml(tail)}</span>`;
      }
    };
    while( (match = regex.exec(processedText)) ) {
      const before = processedText.slice(lastIndex, match.index);
      if( before ) emitLiteralWithInc(before, String(lastIndex));

      const raw   = match[1];
      const token = raw.trim();

      // Include directives: leave verbatim (should be pre-resolved server-side)
      if( /^include:\s*["'][^"']+["']$/i.test(token) ) {
        // Render include directive verbatim (shouldn't occur since server resolves)
        out += escapeHtml(match[0]);
        lastIndex = regex.lastIndex;
        continue;
      }

      const simpleRe = /^[A-Za-z0-9_.-]+$/;
      const withDefaultRe = /^([A-Za-z0-9_.-]+)=(.+)$/;

      const m = token.match(withDefaultRe);
      if( m ) {
        const name = m[1];
        const def = m[2];
        if( def.includes('|') ) {
          const choices = def.split('|').map(s => s.trim());
          const defChoice = choices[0] || '';
          const dataChoices = escapeHtml(JSON.stringify(choices));
          out += `<span class="ph ph-choice" tabindex="0" data-ph="${escapeHtml(name)}" data-default="${escapeHtml(defChoice)}" data-choices='${dataChoices}'>${escapeHtml(defChoice)}</span>`;
        }
        else {
          const defVal = def;
          out += `<span class="ph ph-text" contenteditable="true" tabindex="0" data-ph="${escapeHtml(name)}" data-default="${escapeHtml(defVal)}">${escapeHtml(defVal)}</span>`;
        }
      }
      else if( simpleRe.test(token) ) {
        const name = token;
        out += `<span class="ph ph-text" contenteditable="true" tabindex="0" data-ph="${escapeHtml(name)}" data-default="" data-ph-label="${escapeHtml(name)}"></span>`;
      }
      else {
        // No valid placeholder token; render verbatim
        out += `<span class="ph-literal" contenteditable="true" tabindex="-1">${escapeHtml(match[0])}</span>`;
      }
      lastIndex = regex.lastIndex;
    }

    const tail = processedText.slice(lastIndex);
    if( tail ) emitLiteralWithInc(tail, 'tail');

    // Close any unclosed include wrappers (robustness)
    while( incStack.length > 0 ) {
      incStack.pop();
      out += `</span>`;
    }

    return out;
  }

  bindInlinePlaceholderEvents()
  {
    this.placeholderGroups = new Map();
    const nodes = document.querySelectorAll('#inlineSnippet .ph');
    nodes.forEach(el => {
      const name = el.dataset.ph;
      // Only process elements that have a valid placeholder name
      if( name && name.trim() !== '' ) {
        if( ! this.placeholderGroups.has(name) ) this.placeholderGroups.set(name, []);
        this.placeholderGroups.get(name).push(el);
      }
    });

    // Synchronize default values and assign colors to each placeholder group
    let groupIndex = 0;
    this.placeholderGroups.forEach((group, name) => {
      if( group.length > 1 ) {
        // Multi-instance placeholder: synchronize default values
        // Find the first element that has a non-empty default value
        let sharedDefault = '';
        for( const el of group ) {
          const defaultVal = el.dataset.default || '';
          if( defaultVal !== '' ) {
            sharedDefault = defaultVal;
            break;
          }
        }

        // Apply the shared default to all elements in the group
        group.forEach(el => {
          el.dataset.default = sharedDefault;
          // If element is empty or has the placeholder label, set it to the shared default
          const currentText = (el.textContent || '').trim();
          if( currentText === '' || currentText === '…' || el.hasAttribute('data-ph-label') ) {
            el.textContent = sharedDefault;
          }
        });

        // Assign a group color
        const colorClass = `ph-group-${groupIndex % 8}`; // Cycle through 8 colors
        group.forEach(el => {
          // Remove any existing group classes
          el.classList.remove('ph-group-0', 'ph-group-1', 'ph-group-2', 'ph-group-3',
                             'ph-group-4', 'ph-group-5', 'ph-group-6', 'ph-group-7');
          el.classList.add(colorClass);
        });
        groupIndex++;
      }
      else {
        // Single instance: remove any group classes (keep default yellow)
        group.forEach(el => {
          el.classList.remove('ph-group-0', 'ph-group-1', 'ph-group-2', 'ph-group-3',
                             'ph-group-4', 'ph-group-5', 'ph-group-6', 'ph-group-7');
        });
      }
    });

    // helpers
    const setGroupValue = (name, value) => {
      const group = this.placeholderGroups.get(name) || [];
      group.forEach(node => {
        if( node.classList.contains('ph-text') ) node.textContent = value;
        else node.textContent = value; // ph-choice
      });
      this.updateRenderedOutput();
    };

    const onFocus = (e) => {
      const el = e.currentTarget;
      // Only reset edited flag if the element has the default value or is empty
      const currentValue = (el.textContent || '').trim();
      const defaultValue = el.dataset.default || '';
      if( currentValue === defaultValue || currentValue === '' ) {
        el.dataset.edited = '0';
      }
      if( el.classList.contains('ph-choice') ) {
        this.openChoiceMenu(el);
      }
    };

    const onClick = (e) => {
      const el = e.currentTarget;
      if( el.classList.contains('ph-choice') ) {
        e.stopPropagation(); // Prevent the click from bubbling up
        e.preventDefault(); // Prevent default click behavior
        el.focus(); // Manually trigger focus which will open the menu
      }
    };
    const onBlur = (e) => {
      const el = e.currentTarget;
      if( el.classList.contains('ph') ) {
        const name = el.dataset.ph;
        const edited = el.dataset.edited === '1';
        const defVal = el.dataset.default || '';
        let value = (el.textContent || '').trim();
        if( ! edited || value === '' ) value = defVal;
        setGroupValue(name, value);
      }
      else if( el.classList.contains('ph-literal') ) {
        // Just update rendered output to reflect literal edits
        this.updateRenderedOutput();
      }
      this.closeChoiceMenu();
    };
    const onInput = (e) => {
      const el = e.currentTarget;
      if( el.classList.contains('ph') ) {
        el.dataset.edited = '1';
        const name = el.dataset.ph;
        const value = el.textContent;
        // mirror to siblings (avoid recursion by direct assignment)
        const group = this.placeholderGroups.get(name) || [];
        group.forEach(node => { if( node !== el ) node.textContent = value; });
      }
      // For ph and ph-literal, recompute rendered output
      this.updateRenderedOutput();
    };
    const onKeyDown = (e) => {
      const el = e.currentTarget;
      if( el.classList.contains('ph-choice') ) {
        if( e.key === 'Enter' || e.key === ' ' ) {
          this.openChoiceMenu(el);
          e.preventDefault();
        }
      }
    };

    nodes.forEach(el => {
      // Only bind events to elements with valid placeholder names
      const name = el.dataset.ph;
      if( name && name.trim() !== '' ) {
        el.addEventListener('focus', onFocus);
        el.addEventListener('blur', onBlur);
        el.addEventListener('keydown', onKeyDown);
        if( el.classList.contains('ph-text') ) el.addEventListener('input', onInput);
        if( el.classList.contains('ph-choice') ) el.addEventListener('click', onClick);
      }
      else {
        // Remove from tab order if it doesn't have a valid placeholder name
        el.removeAttribute('tabindex');
      }
    });

    // Bind events for literal editable spans (but no focus/blur to avoid undefined logs)
    const literalNodes = document.querySelectorAll('#inlineSnippet .ph-literal');
    literalNodes.forEach( el => {
      // Don't bind focus/blur to literals to avoid "undefined" placeholder logs
      el.addEventListener('input', onInput);
      el.addEventListener('keydown', onKeyDown);
    });

    // Bind events for MAYBE block checkboxes
    const maybeCheckboxes = document.querySelectorAll('#inlineSnippet .maybe-checkbox');
    maybeCheckboxes.forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const maybeBlock = e.target.closest('.maybe-block');
        if( maybeBlock ) {
          const enabled = e.target.checked;
          maybeBlock.dataset.enabled = enabled ? 'true' : 'false';
          this.updateRenderedOutput();
        }
      });
    });
  }

  openChoiceMenu(el)
  {
    // Clean up any previously orphaned outside-click handler before opening
    this.closeChoiceMenu();
    const menu = document.getElementById('phChoiceMenu');
    if( ! menu ) return;
    const choices = JSON.parse(el.dataset.choices || '[]');
    const name = el.dataset.ph;
    const rect = el.getBoundingClientRect();
    menu.innerHTML = choices.map(ch => `<button type=\"button\" class=\"dropdown-item\" data-value=\"${escapeHtml(ch)}\">${escapeHtml(ch)}</button>`).join('');
    menu.style.display = 'block';
    menu.style.position = 'absolute';
    menu.style.left = (rect.left + window.scrollX) + 'px';
    menu.style.top = (rect.bottom + window.scrollY) + 'px';
    menu.style.zIndex = '1070';
    menu.classList.add('show');
    // Set a flag to prevent immediate outside click detection
    this._menuJustOpened = true;

    // Add click handlers directly to each button (using mousedown since it works reliably)
    const buttons = menu.querySelectorAll('.dropdown-item');
    buttons.forEach((btn) => {
      btn.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const val = e.target.getAttribute('data-value');
        const group = this.placeholderGroups.get(name) || [];
        group.forEach(node => {
          node.textContent = val;
          node.dataset.edited = '1'; // Mark as edited so onBlur doesn't reset it
        });
        this.updateRenderedOutput();
        this.closeChoiceMenu();
      });
    });

    const clickOutside = (evt) => {
      // Skip if menu was just opened
      if( this._menuJustOpened ) {
        this._menuJustOpened = false;
        return;
      }

      // Don't close if clicking on the menu or its items
      if( ! menu.contains(evt.target) && ! evt.target.closest('#phChoiceMenu') ) {
        this.closeChoiceMenu();
      }
    };

    // Store to remove later
    this._choiceOutsideHandler = clickOutside;
    // Add the outside click handler immediately but with the flag proection
    document.addEventListener('click', clickOutside);

    // Clear the flag after a short delay
    setTimeout(() => {
      this._menuJustOpened = false;
    }, 50);
  }

  closeChoiceMenu()
  {
    const menu = document.getElementById('phChoiceMenu');
    if( ! menu ) return;
    menu.classList.remove('show');
    menu.style.display = 'none';

    // Clean up event listeners
    if( this._choiceOutsideHandler ) {
      document.removeEventListener('click', this._choiceOutsideHandler);
      this._choiceOutsideHandler = null;
    }
  }

  toggleUsagePreview()
  {
    const textarea = document.getElementById('snippetUsage');
    const preview  = document.getElementById('usagePreview');
    if( ! textarea || ! preview ) return;

    // On mobile, auto-switch to Usage pill if Content is currently active
    const editFieldsRow = document.getElementById('editFieldsRow');
    if( editFieldsRow?.classList.contains('mobile-content-active') ) {
      editFieldsRow.classList.add('mobile-usage-active');
      editFieldsRow.classList.remove('mobile-content-active');
      document.getElementById('usageFieldPill')?.classList.add('active');
      document.getElementById('contentFieldPill')?.classList.remove('active');
    }

    const isActive = preview.style.display !== 'none';
    if( isActive ) {
      preview.style.display = 'none';
      textarea.style.display = '';
      this._setUsagePreviewIcon('bi-eye');
    }
    else {
      preview.innerHTML = marked.parse(textarea.value || '');
      preview.style.display = '';
      textarea.style.display = 'none';
      this._setUsagePreviewIcon('bi-eye-slash');
    }
  }

  resetUsagePreview()
  {
    const textarea = document.getElementById('snippetUsage');
    const preview  = document.getElementById('usagePreview');
    if( textarea ) textarea.style.display = '';
    if( preview ) preview.style.display = 'none';
    this._setUsagePreviewIcon('bi-eye');
  }

  showUsagePreview()
  {
    const textarea = document.getElementById('snippetUsage');
    const preview  = document.getElementById('usagePreview');
    if( ! textarea || ! preview ) return;
    preview.innerHTML = marked.parse(textarea.value || '');
    preview.style.display = '';
    textarea.style.display = 'none';
    this._setUsagePreviewIcon('bi-eye-slash');
  }

  _setUsagePreviewIcon(iconClass)
  {
    ['usagePreviewBtn', 'usagePreviewBtnMobile'].forEach(id => {
      const btn = document.getElementById(id);
      if( btn ) btn.querySelector('i').className = `bi ${iconClass}`;
    });
  }

  renderUsageInPreview()
  {
    const el = document.getElementById('renderUsage');
    if( ! el ) return;
    const usageText = document.getElementById('snippetUsage')?.value || '';
    el.innerHTML = usageText ? marked.parse(usageText) : '';
  }

  toggleRenderView()
  {
    const row = document.getElementById('renderRow');
    const btn = document.getElementById('renderViewToggleBtn');
    if( ! row || ! btn ) return;

    const showingUsage = row.classList.contains('render-usage-active');
    if( showingUsage ) {
      row.classList.remove('render-usage-active');
      row.classList.add('render-snippet-active');
      btn.querySelector('i').className = 'bi bi-card-text';
    }
    else {
      row.classList.remove('render-snippet-active');
      row.classList.add('render-usage-active');
      btn.querySelector('i').className = 'bi bi-braces';
    }
  }

  getCurrentPlaceholderValues()
  {
    const values = {};
    this.placeholderGroups.forEach((nodes, name) => {
      const el = nodes[0];
      const txt = (el.textContent || '').trim();
      values[name] = txt !== '' ? txt : (el.dataset.default || '');
    });
    return values;
  }

  async updateRenderedOutput()
  {
    if( ! this.currentSnippet ) return;
    // Build final text from inline DOM: placeholders -> current values, literals -> their text
    const container = document.getElementById('inlineSnippet');
    if( ! container ) return;

    // Recursive function to extract text from nodes, respecting MAYBE block state
    const extractText = (node) => {
      if( node.nodeType === Node.TEXT_NODE ) {
        return node.nodeValue || '';
      }
      else if( node.nodeType === Node.ELEMENT_NODE ) {
        const el = node;

        // Handle MAYBE blocks
        if( el.classList.contains('maybe-block') ) {
          const enabled = el.dataset.enabled === 'true';
          if( ! enabled ) return ''; // Skip disabled blocks

          // Extract text from maybe-content only (skip header)
          const content = el.querySelector('.maybe-content');
          if( content ) {
            let text = '';
            content.childNodes.forEach(child => {
              text += extractText(child);
            });
            return text;
          }
          return '';
        }

        // Skip maybe-header and maybe-end (checkbox, label, and footer line)
        if( el.classList.contains('maybe-header') || el.classList.contains('maybe-end') ) {
          return '';
        }

        // Handle placeholders and literals
        if( el.classList.contains('ph') || el.classList.contains('ph-literal') ) {
          return el.textContent || '';
        }

        // Handle include blocks and other containers
        if( el.classList.contains('inc-block') || el.classList.contains('maybe-content') ) {
          let text = '';
          el.childNodes.forEach(child => {
            text += extractText(child);
          });
          return text;
        }

        // Default: recursively process children
        let text = '';
        el.childNodes.forEach(child => {
          text += extractText(child);
        });
        return text;
      }
      return '';
    };

    let parts = [];
    container.childNodes.forEach(node => {
      parts.push(extractText(node));
    });

    this.renderedText = parts.join('');
    const copyRenderedBtn = document.getElementById('copyRenderedBtn');
    if( copyRenderedBtn ) copyRenderedBtn.disabled = this.renderedText.length === 0;
  }

  async copyRenderedContent()
  {
    // Ensure we have the latest composed text from the inline DOM
    await this.updateRenderedOutput();
    if( ! this.renderedText ) return;

    const text = this.renderedText;
    let copied = false;

    // Try modern Clipboard API first when available and in a secure context
    try {
      if( navigator.clipboard && typeof navigator.clipboard.writeText === 'function' && (window.isSecureContext || location.hostname === 'localhost') ) {
        await navigator.clipboard.writeText(text);
        copied = true;
      }
    }
    catch( e1 ) {
      // Intentionally fall through to fallback below
    }

    // Fallback: use a temporary textarea and execCommand('copy')
    if( ! copied ) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        ta.style.left = '-1000px';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if( ! ok ) throw new Error('execCommand(copy) returned false');
        copied = true;
      }
      catch( e2 ) {
        showError('Failed to copy content: ' + (e2?.message || 'Unknown error'));
        return;
      }
    }

    if( copied ) {
      showSuccess('Content copied to clipboard');
    }
  }

  async performSearch()
  {
    const searchInput = document.getElementById('searchInput');
    const query = searchInput?.value.trim();
    if( ! query ) return;

    // Inline: update search history and persist
    this.searchHistory = this.searchHistory.filter(item => item !== query);
    this.searchHistory.unshift(query);
    this.searchHistory = this.searchHistory.slice(0, 20);
    await apiCall(this.currentDataPath, 'saveSearchHistory', { data: this.searchHistory });

    const result = await apiCall(this.currentDataPath, 'searchSnippets', { query });

    if( result.success ) {
      this.isSearchMode = true;
      this.renderSearchResults(result.results);
    }
    else {
      showError('Search failed: ' + result.message);
    }
  }

  renderSearchResults(results)
  {
    const fileList = document.getElementById('fileList');
    if( ! fileList ) return;

    if( results.length === 0 ) {
      fileList.innerHTML = `
        <div class="empty-state">
          <i class="bi bi-search"></i>
          <p>No snippets found matching your search</p>
        </div>
      `;
      return;
    }

    fileList.innerHTML = results.map(result => {
      let icon, dataType, dataExtension, metaInfo;

      if( result.type === 'folder' ) {
        icon = 'bi-folder';
        dataType = 'folder';
        dataExtension = '';
        metaInfo = 'FOLDER • ' + result.path;
      }
      else {
        icon = result.type === 'yml' ? 'bi-file-code' : 'bi-file-text';
        dataType = 'file';
        dataExtension = result.type;
        metaInfo = result.type.toUpperCase() + ' • ' + result.path;
      }

      return `
        <div class="list-group-item file-item" data-path="${result.path}"
             data-type="${dataType}" data-extension="${dataExtension}">
          <div class="d-flex align-items-center">
            <i class="bi ${icon} file-icon me-2"></i>
            <div class="flex-grow-1">
              <div class="fw-medium">${result.name}</div>
              <div class="file-meta">${metaInfo}</div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  handleSearch(query)
  {
    if( query.length > 0 ) {
      this.showSearchHistory();
    }
    else {
      this.hideSearchHistory();
      // If search input is cleared and we're in search mode, return to tree listing
      if( this.isSearchMode ) {
        this.isSearchMode = false;
        this.loadFiles();
      }
    }
  }

  showSearchHistory()
  {
    const searchHistory = document.getElementById('searchHistory');
    const searchInput = document.getElementById('searchInput');
    if( ! searchHistory || ! searchInput ) return;

    const rect = searchInput.getBoundingClientRect();

    searchHistory.style.display = 'block';
    searchHistory.style.top = (rect.bottom + window.scrollY) + 'px';
    searchHistory.style.left = rect.left + 'px';
    searchHistory.style.width = rect.width + 'px';

    searchHistory.innerHTML = this.searchHistory.slice(0, 10).map(item => `
      <div class="search-history-item" data-query="${item}">
        <i class="bi bi-clock-history me-2"></i>${item}
      </div>
    `).join('');
  }

  hideSearchHistory()
  {
    document.getElementById('searchHistory').style.display = 'none';
  }


  setupSearchHistory()
  {
    const searchHistory = document.getElementById('searchHistory');
    const searchInput = document.getElementById('searchInput');

    // Handle clicks on history items (bound once here instead of on every showSearchHistory call)
    if( searchHistory && searchInput ) {
      searchHistory.addEventListener('click', (e) => {
        const item = e.target.closest('.search-history-item');
        if( item ) {
          searchInput.value = item.dataset.query;
          this.performSearch();
          this.hideSearchHistory();
        }
      });
    }

    // Hide search history when clicking outside
    document.addEventListener('click', (e) => {
      if( ! e.target.closest('#searchInput') && ! e.target.closest('#searchHistory') ) {
        this.hideSearchHistory();
      }
    });
  }

  showContextMenu(e)
  {
    // Context menu functionality can be implemented here
    // For now, just prevent the default context menu
    e.preventDefault();
  }

  hideContextMenu()
  {
    // Hide any custom context menu if implemented
    const contextMenu = document.querySelector('.context-menu');
    if( contextMenu ) {
      contextMenu.remove();
    }
  }

  loadRecentSnippets()
  {
    const recentList = document.getElementById('recentList');
    if( ! recentList ) return;

    if( this.recentSnippets.length === 0 ) {
      recentList.innerHTML = `
        <div class="empty-state">
          <i class="bi bi-clock-history"></i>
          <p>No recent snippets</p>
        </div>
      `;
      return;
    }

    recentList.innerHTML = this.recentSnippets.map(item => {
      const extension = item.path.split('.').pop();
      const icon = extension === 'yml' ? 'bi-file-code' : 'bi-file-text';
      const timeStr = timeAgo(item.timestamp);

      return `
        <div class="list-group-item file-item" data-path="${item.path}"
             data-type="file" data-extension="${extension}">
          <div class="d-flex align-items-center">
            <i class="bi ${icon} file-icon me-2"></i>
            <div class="flex-grow-1">
              <div class="fw-medium">${item.name}</div>
              <div class="file-meta">${timeStr}</div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // timeAgo and showModal moved to global helpers in lib/functions.js

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
      data.sh = '';
      data.usage = '';
    }

    const extension = type === 'yml' ? 'yml' : 'md';
    const path = (this.currentPath ? this.currentPath + '/' : '') + name + '.' + extension;

    const result = await apiCall(this.currentDataPath, 'saveSnippet', { path, data });

    if( result.success ) {
      // Ensure parent folder is expanded so the new file is visible
      if( this.currentPath ) this.expandedFolders.add(this.currentPath);
      await this.loadFiles();

      // Select and open the newly created snippet, then switch to Edit tab
      document.querySelectorAll('.tree-item.active, .file-item.active').forEach(item => item.classList.remove('active'));
      const newItem = document.querySelector(`.tree-item[data-path="${path}"]`);
      if( newItem ) newItem.classList.add('active');
      await this.loadSnippet(path);
      activateTab('edit-tab');

      // Close modal
      const modal = bootstrap.Modal.getInstance(document.getElementById('newSnippetModal'));
      modal.hide();

      // Clear form
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

    const folderPath = (this.currentPath ? this.currentPath + '/' : '') + name;
    const result     = await apiCall(this.currentDataPath, 'createFolder', { folderPath });

    if( result.success ) {
      if( this.currentPath ) this.expandedFolders.add(this.currentPath);
      this.loadFiles();

      // Close modal
      const modal = bootstrap.Modal.getInstance(document.getElementById('newFolderModal'));
      modal.hide();

      // Clear form
      document.getElementById('newFolderForm').reset();
    }
    else {
      showError('Failed to create folder: ' + result.message);
    }
  }

  async changeDataFolder(dataPath)
  {
    this.currentDataPath = dataPath;
    const result = await apiCall(this.currentDataPath, 'setDataPath', { dataPath });

    if( result.success ) {
      this.currentPath = '';
      this.fileTree = [];
      this.expandedFolders.clear();
      this.currentSnippet = null;
      this.clearEditForm();
      // Load recent snippets for the new data folder
      const recentResult = await apiCall(this.currentDataPath, 'getRecentSnippets');
      if( recentResult.success ) {
        this.recentSnippets = recentResult.data;
      }
      this.loadFiles();
    }
    else {
      showError('Failed to change data folder: ' + result.message);
    }
  }

  // apiCall moved to global helper in lib/functions.js

  async loadFiles()
  {
    showLoading('fileList');

    const result = await apiCall(this.currentDataPath, 'listFiles', { subPath: '' });

    if( result.success ) {
      this.isSearchMode = false;
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

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new SnippetManager();
});
