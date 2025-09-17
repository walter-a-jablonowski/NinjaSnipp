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
    this.navigationHistory = []; // Track navigation history for included folders
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
    const item = actionEl.closest('.file-item');
    if( ! item ) return;
    const oldPath = item.getAttribute('data-path');
    const type = item.getAttribute('data-type');
    const ext = item.getAttribute('data-extension') || '';

    if( action === 'rename' ) {
      // Prepare context and show modal
      const parts = oldPath.split('/');
      const filename = parts.pop();
      const parent = parts.join('/');
      let base = filename;
      if( type === 'file' && ext ) {
        const dotExt = '.' + ext;
        if( base.toLowerCase().endsWith(dotExt) ) base = base.slice(0, -dotExt.length);
      }
      this._renameContext = { oldPath, parent, type, ext };
      const input = document.getElementById('renameNameInput');
      if( input ) input.value = base;
      showModal('renameItemModal');
    }
  }

  enableMdTextareaAutoHeight()
  {
    this._mdAutoHeight = true;
    // Apply immediately
    this.resizeMdTextarea();
    this.resizeInlineSnippet();
    // Extra delayed recalculation to account for late layout/Font/Bootstrap paints
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
    const bottomPadding = 24; // space for bottom padding/margins
    const available = Math.max(200, Math.floor(window.innerHeight - rect.top - bottomPadding));
    ta.style.height = available + 'px';
  }

  resizeInlineSnippet()
  {
    const el = document.getElementById('inlineSnippet');
    if( ! el ) return;
    // Only relevant if a snippet is loaded (typically YAML for preview)
    if( ! this.currentSnippet ) return;
    const rect = el.getBoundingClientRect();
    const bottomPadding = 24;
    const available = Math.max(200, Math.floor(window.innerHeight - rect.top - bottomPadding));
    el.style.height = available + 'px';
    el.style.overflowY = 'auto';
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
      ['confirmRenameBtn', 'click', () => this.performRename()],
      ['expandContentBtn', 'click', () => this.toggleContentExpansion()]
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
      // If the click is inside any dropdown control or its menu, do not trigger navigation
      if( e.target.closest('.dropdown') || e.target.closest('.dropdown-menu') ) return;
      if( e.target.closest('.file-item') ) this.handleFileClick(e);
      else this.hideContextMenu();
    });
    
    document.addEventListener('contextmenu', (e) => {
      if( e.target.closest('.file-item') ) {
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

    // After full page load (fonts, bootstrap), recalc heights once
    window.addEventListener('load', () => {
      this.resizeMdTextarea();
      this.resizeInlineSnippet();
    });

    // File list dropdown actions (delegate)
    const fileList = document.getElementById('fileList');
    if( fileList ) fileList.addEventListener('click', (e) => this.handleFileListDropdownClick(e));

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
      await this.loadFiles(this.currentPath);
      const newItem = document.querySelector(`.file-item[data-path="${newPath}"]`);
      if( newItem ) {
        document.querySelectorAll('.file-item.active').forEach(n => n.classList.remove('active'));
        newItem.classList.add('active');
      }
      showSuccess('Renamed successfully');
    }
    else {
      showError('Failed to rename: ' + (result?.message || 'Unknown error'));
    }
  }

  renderFileList(files) {
    const fileList = document.getElementById('fileList');
    if( ! fileList ) return;
    
    if( files.length === 0 ) {
      fileList.innerHTML = `
        <div class="empty-state">
          <i class="bi bi-folder-x"></i>
          <p>No files found in this folder</p>
        </div>
      `;
      return;
    }

    fileList.innerHTML = files.map(file => {
      const icon = file.type === 'folder' ? 'bi-folder' : 
                   file.extension === 'yml' ? 'bi-file-code' : 'bi-file-text';
      const modified = file.modified ? new Date(file.modified * 1000).toLocaleDateString() : '';
      const includedClass = file.isIncluded ? ' file-item-included' : '';
      const includedIcon = file.isIncluded ? '<i class="bi bi-link-45deg text-primary ms-1" title="Included file"></i>' : '';
      
      return `
        <div class="list-group-item file-item${includedClass}" data-path="${file.path}" data-type="${file.type}" data-extension="${file.extension || ''}">
          <div class="d-flex align-items-center">
            <i class="bi ${icon} file-icon me-2"></i>
            <div class="flex-grow-1">
              <div class="fw-medium">${file.name}${includedIcon}</div>
              ${file.type === 'file' ? `<div class="file-meta">${file.extension.toUpperCase()} • ${modified}</div>` : ''}
            </div>
            <div class="dropdown ms-2">
              <button class="btn btn-sm btn-link text-muted p-0" type="button" data-bs-toggle="dropdown" aria-expanded="false" aria-label="More actions">
                <i class="bi bi-three-dots-vertical"></i>
              </button>
              <ul class="dropdown-menu dropdown-menu-end">
                <li><a class="dropdown-item" href="#" data-action="rename">Rename</a></li>
                <li><a class="dropdown-item" href="#" data-action="delete">Delete</a></li>
              </ul>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  goBack()
  {
    // If we're in search mode, exit search and return to normal file listing
    if( this.isSearchMode ) {
      this.isSearchMode = false;
      const searchInput = document.getElementById('searchInput');
      if( searchInput ) searchInput.value = '';
      this.loadFiles(this.currentPath);
      return;
    }
    
    if( ! this.currentPath ) return; // already at base
    
    // Check if we have navigation history (for included folders)
    if( this.navigationHistory.length > 0 ) {
      const previousPath = this.navigationHistory.pop();
      this.loadFiles(previousPath);
      return;
    }
    
    // Default behavior: go up one level
    const parts = this.currentPath.split('/');
    parts.pop();
    const parent = parts.join('/');
    this.loadFiles(parent);
  }

  handleFileClick(e)
  {
    const fileItem = e.target.closest('.file-item');
    const { path, type } = fileItem.dataset;

    // Clear previous selection and set new active item
    document.querySelectorAll('.file-item.active').forEach(item => item.classList.remove('active'));
    fileItem.classList.add('active');

    if( type === 'folder' ) {
      // Check if this is an included folder
      if( fileItem.classList.contains('file-item-included') ) {
        // Save current path to navigation history before navigating to included folder
        this.navigationHistory.push(this.currentPath);
      }
      this.loadFiles(path);
    }
    else {
      this.loadSnippet(path);
      
      // Auto-close sidebar on mobile when a file is selected
      // check if we're on mobile (screen width < 992px, BS's lg breakpoint)
      if( window.innerWidth < 992 ) {
        const sidebar = document.getElementById('sidebarNav');
        const offcanvas = bootstrap.Offcanvas.getInstance(sidebar);
        if( offcanvas )  offcanvas.hide();
      }
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
      
      // Enable render tab for yml files
      const renderTab = document.getElementById('render-tab');
      if( result.snippet._type === 'yml' ) {
        renderTab.disabled = false;
        renderTab.classList.remove('disabled');
        // Auto-render inline immediately when a YAML snippet is selected
        this.composeAndRenderInline();
        // Keep Rendered tab active (it's first now); just update actions visibility
        this.updateActionButtonsVisibility();
      }
      else {
        renderTab.disabled = true;
        renderTab.classList.add('disabled');
        // Switch to Edit tab for non-YAML files
        activateTab('edit-tab');
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
    const snippetNameEdit = document.getElementById('snippetNameEdit');
    const labelSnippetName = document.getElementById('labelSnippetName');
    const fieldSh = document.getElementById('fieldSh');
    const fieldUsage = document.getElementById('fieldUsage');
    const snippetSh = document.getElementById('snippetSh');
    const snippetUsage = document.getElementById('snippetUsage');
    const snippetContent = document.getElementById('snippetContent');
    const labelSnippetContent = document.getElementById('labelSnippetContent');

    if( ! editForm || ! snippetNameEdit || ! snippetContent ) return;

    const isYaml = snippet._type === 'yml';
    
    // Populate form fields
    snippetNameEdit.value = snippet._name || '';
    snippetContent.value = snippet.content || '';
    
    if( isYaml ) {
      if( snippetSh ) snippetSh.value = snippet.sh || '';
      if( snippetUsage ) snippetUsage.value = snippet.usage || '';
    }

    // Toggle YAML-only fields visibility
    [fieldSh, fieldUsage].forEach(field => {
      if( field ) field.style.display = isYaml ? '' : 'none';
    });

    // Hide Name and Content labels for Markdown to save space
    if( labelSnippetName ) labelSnippetName.style.display = isYaml ? '' : 'none';
    if( labelSnippetContent ) labelSnippetContent.style.display = isYaml ? '' : 'none';

    // Hide name row for Markdown files
    const fieldNameRow = document.getElementById('fieldNameRow');
    if( fieldNameRow ) fieldNameRow.style.display = isYaml ? '' : 'none';

    // Toggle expand button visibility
    const expandBtn = document.getElementById('expandContentBtn');
    if( expandBtn ) expandBtn.style.display = isYaml ? '' : 'none';

    // Show form, hide empty state
    if( editEmptyState ) editEmptyState.style.display = 'none';
    editForm.style.display = 'block';

    // Make editors taller to fill available vertical space for both YAML and Markdown
    // Do it after the form becomes visible to get correct element geometry
    requestAnimationFrame(() => {
      // Handle content height for YAML files after layout settles
      if( isYaml ) {
        if( this._initialContentHeight === null ) {
          this._initialContentHeight = 300;
        }
        // Reset to initial height if expanded
        if( this._contentExpanded ) {
          snippetContent.style.height = this._initialContentHeight + 'px';
          this._contentExpanded = false;
          const expandBtn = document.getElementById('expandContentBtn');
          if( expandBtn ) {
            const icon = expandBtn.querySelector('i');
            if( icon ) icon.className = 'bi bi-caret-down fs-5 text-muted';
          }
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

    // Configure render tab
    this.configureRenderTab(isYaml);
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

    const nameInput = document.getElementById('snippetNameEdit');
    const contentInput = document.getElementById('snippetContent');
    
    if( ! nameInput.value.trim() || ! contentInput.value.trim() ) {
      showError('Name and content are required');
      return;
    }

    const data = {
      _type: this.currentSnippet._type,
      _name: nameInput.value.trim(),
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
      // If called with silent flag, do not pop success toast
      const silent = arguments[0] === true || (typeof arguments[0] === 'object' && arguments[0]?.silent === true);
      if( ! silent ) showSuccess('Snippet saved successfully');
      this.currentSnippet = data;
      this.loadFiles(this.currentPath); // Refresh file list

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
    const nameEl = document.getElementById('snippetNameEdit');
    const shEl = document.getElementById('snippetSh');
    const usageEl = document.getElementById('snippetUsage');
    const contentEl = document.getElementById('snippetContent');
    const handler = () => this.onEditFieldChanged();
    [nameEl, shEl, usageEl, contentEl].forEach(el => {
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
      // Refresh list
      this.loadFiles(this.currentPath);
    }
    else {
      showError('Failed to duplicate snippet: ' + result.message);
    }
  }

  async deleteCurrentSnippet()
  {
    if( ! this.currentSnippet ) return;
    // Open confirmation modal; confirm handled by performDelete()
    showModal('deleteSnippetModal');
  }

  async performDelete()
  {
    if( ! this.currentSnippet ) return;
    const extension = this.currentSnippet._type === 'yml' ? 'yml' : 'md';
    const path = (this.currentPath ? this.currentPath + '/' : '') + this.currentSnippet._name + '.' + extension;
    const result = await apiCall(this.currentDataPath, 'deleteSnippet', { path });
    if( result.success ) {
      showSuccess('Snippet deleted successfully');
      // Close modal
      const modal = bootstrap.Modal.getInstance(document.getElementById('deleteSnippetModal'));
      if( modal ) modal.hide();
      this.currentSnippet = null;
      this.clearEditForm();
      this.loadFiles(this.currentPath);
    }
    else {
      showError('Failed to delete snippet: ' + result.message);
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
      const inputs = ['snippetNameEdit', 'snippetSh', 'snippetUsage', 'snippetContent'];
      inputs.forEach(id => {
        const input = document.getElementById(id);
        if( input ) input.value = '';
      });
    }
    
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

    // Copy button is only visible on Render tab when a YAML snippet is loaded
    const copyBtn = document.getElementById('copyRenderedBtn');
    if( copyBtn ) {
      const renderActive = activeTab && activeTab.id === 'render-tab';
      const canRender = !!(this.currentSnippet && this.currentSnippet._type === 'yml');
      copyBtn.style.display = (renderActive && canRender) ? '' : 'none';
    }

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
    if( ! this.currentSnippet || this.currentSnippet._type !== 'yml' ) return;
    const snippetContent = document.getElementById('snippetContent');
    const inlineContainer = document.getElementById('inlineSnippet');
    if( ! snippetContent || ! inlineContainer ) return;

    const snippet = { ...this.currentSnippet, content: snippetContent.value };
    const result = await apiCall(this.currentDataPath, 'composeContent', { snippet });
    if( result.success ) {
      this.renderInlineSnippet(result.composed || '');
      // Also update live preview initially with defaults
      this.updateRenderedOutput();
      // Adjust preview height after (re)render
      this.resizeInlineSnippet();
    }
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
    const regex = /\{\{\s*([^}]*)\s*\}\}/g;
    let lastIndex = 0;
    let match;
    let out = '';
    // Track open include wrappers across placeholder boundaries
    const incStack = [];

    // Helper to emit literal text that may contain include markers
    const emitLiteralWithInc = (literal, idxTag) => {
      if( ! literal ) return;
      const markerRe = /(<<<INC:START:([^>]+)>>>|<<<INC:END>>>)/g;
      let pos = 0;
      let m;
      while( (m = markerRe.exec(literal)) ) {
        const before = literal.slice(pos, m.index);
        if( before ) {
          out += `<span class="ph-literal" contenteditable="true" tabindex="0" data-chunk="${idxTag}">${escapeHtml(before)}</span>`;
        }
        const token = m[1];
        if( token.startsWith('<<<INC:START:') ) {
          const name = m[2] || '';
          out += `<span class="inc-block" data-inc="${escapeHtml(name)}">`;
          incStack.push(name);
        }
        else { // <<<INC:END>>>
          if( incStack.length > 0 ) {
            incStack.pop();
            out += `</span>`;
          }
        }
        pos = markerRe.lastIndex;
      }
      const tail = literal.slice(pos);
      if( tail ) {
        out += `<span class="ph-literal" contenteditable="true" tabindex="0" data-chunk="${idxTag}-tail">${escapeHtml(tail)}</span>`;
      }
    };
    while( (match = regex.exec(text)) ) {
      const before = text.slice(lastIndex, match.index);
      if( before ) emitLiteralWithInc(before, String(lastIndex));

      const raw   = match[1];
      const token = raw.trim();

      // Include directives: leave verbatim (should be pre-resolved server-side)
      if( /^include:\s*["'][^"']+["']$/i.test(token) ) {
        // Render include directive verbatim (should not occur since server resolves)
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
        out += `<span class="ph-literal" contenteditable="true" tabindex="0">${escapeHtml(match[0])}</span>`;
      }
      lastIndex = regex.lastIndex;
    }

    const tail = text.slice(lastIndex);
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
      if( ! this.placeholderGroups.has(name) ) this.placeholderGroups.set(name, []);
      this.placeholderGroups.get(name).push(el);
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
      el.dataset.edited = '0';
      if( el.classList.contains('ph-choice') ) this.openChoiceMenu(el);
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
      // For both ph and ph-literal, recompute rendered output
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
      el.addEventListener('focus', onFocus);
      el.addEventListener('blur', onBlur);
      el.addEventListener('keydown', onKeyDown);
      if( el.classList.contains('ph-text') ) el.addEventListener('input', onInput);
    });

    // Bind events for literal editable spans
    const literalNodes = document.querySelectorAll('#inlineSnippet .ph-literal');
    literalNodes.forEach(el => {
      el.addEventListener('focus', onFocus);
      el.addEventListener('blur', onBlur);
      el.addEventListener('input', onInput);
      el.addEventListener('keydown', onKeyDown);
    });
  }

  openChoiceMenu(el)
  {
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
    menu.classList.add('show');

    const onClick = (e) => {
      if( e.target.matches('.dropdown-item') ) {
        const val = e.target.getAttribute('data-value');
        const group = this.placeholderGroups.get(name) || [];
        group.forEach(node => node.textContent = val);
        this.updateRenderedOutput();
        this.closeChoiceMenu();
      }
    };
    // Rebind each time to keep it simple
    menu.onclick = onClick;

    const clickOutside = (evt) => {
      if( ! menu.contains(evt.target) && evt.target !== el ) this.closeChoiceMenu();
    };
    // Store to remove later
    this._choiceOutsideHandler = clickOutside;
    document.addEventListener('click', clickOutside);
  }

  closeChoiceMenu()
  {
    const menu = document.getElementById('phChoiceMenu');
    if( ! menu ) return;
    menu.classList.remove('show');
    menu.style.display = 'none';
    if( this._choiceOutsideHandler ) {
      document.removeEventListener('click', this._choiceOutsideHandler);
      this._choiceOutsideHandler = null;
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
    const parts = [];
    container.childNodes.forEach(node => {
      if( node.nodeType === Node.TEXT_NODE ) {
        parts.push(node.nodeValue);
      }
      else if( node.nodeType === Node.ELEMENT_NODE ) {
        const el = node;
        if( el.classList.contains('ph') || el.classList.contains('ph-literal') ) {
          parts.push(el.textContent || '');
        }
        else {
          parts.push(el.textContent || '');
        }
      }
    });
    this.renderedText = parts.join('');
    const copyRenderedBtn = document.getElementById('copyRenderedBtn');
    if( copyRenderedBtn ) copyRenderedBtn.disabled = this.renderedText.length === 0;
  }

  async copyRenderedContent()
  {
    if( ! this.renderedText ) return;
    
    try {
      await navigator.clipboard.writeText(this.renderedText);
      showSuccess('Content copied to clipboard');
    }
    catch( error ) {
      showError('Failed to copy content');
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
      // If search input is cleared and we're in search mode, return to normal listing
      if( this.isSearchMode ) {
        this.isSearchMode = false;
        this.loadFiles(this.currentPath);
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
    
    // Bind click events
    searchHistory.addEventListener('click', (e) => {
      if( e.target.closest('.search-history-item') ) {
        const query = e.target.closest('.search-history-item').dataset.query;
        searchInput.value = query;
        this.performSearch();
        this.hideSearchHistory();
      }
    });
  }

  hideSearchHistory()
  {
    document.getElementById('searchHistory').style.display = 'none';
  }

  setupSearchHistory()
  {
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
      const timeAgoText = timeAgo(item.timestamp);
      
      return `
        <div class="list-group-item file-item" data-path="${item.path}" 
             data-type="file" data-extension="${extension}">
          <div class="d-flex align-items-center">
            <i class="bi ${icon} file-icon me-2"></i>
            <div class="flex-grow-1">
              <div class="fw-medium">${item.name}</div>
              <div class="file-meta">${timeAgoText}</div>
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
      // Reload files so the new snippet appears
      await this.loadFiles(this.currentPath);

      // Select and open the newly created snippet, then switch to Edit tab
      const list = document.getElementById('fileList');
      if( list ) {
        document.querySelectorAll('.file-item.active').forEach(item => item.classList.remove('active'));
        const newItem = list.querySelector(`.file-item[data-path="${path}"]`);
        if( newItem ) newItem.classList.add('active');
      }
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
      this.loadFiles(this.currentPath);
      
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
    // Update local state and inform server for consistency
    this.currentDataPath = dataPath;
    const result = await apiCall(this.currentDataPath, 'setDataPath', { dataPath });
    
    if( result.success ) {
      this.currentPath = '';
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

  async loadFiles(subPath = '') {
    showLoading('fileList');
    
    const result = await apiCall(this.currentDataPath, 'listFiles', { subPath });
    
    if( result.success ) {
      this.isSearchMode = false; // Exit search mode when loading normal files
      this.renderFileList(result.files);
      this.currentPath = subPath;

      // Auto-load first yml/md file on initial page load
      if( this._initialLoad && result.files.length > 0 ) {
        const firstFile = result.files.find(f => f.type === 'file' && (f.extension === 'yml' || f.extension === 'md'));
        if( firstFile ) {
          const fileItem = document.querySelector(`.file-item[data-path="${firstFile.path}"]`);
          if( fileItem ) {
            document.querySelectorAll('.file-item.active').forEach(item => item.classList.remove('active'));
            fileItem.classList.add('active');
          }
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

  async toggleContentExpansion() {
    const snippetContent = document.getElementById('snippetContent');
    const expandBtn = document.getElementById('expandContentBtn');
    if( ! snippetContent || ! expandBtn ) return;

    const icon = expandBtn.querySelector('i');
    if( ! icon ) return;

    if( this._contentExpanded ) {
      // Restore to initial height
      snippetContent.style.height = this._initialContentHeight + 'px';
      icon.className = 'bi bi-caret-down fs-5 text-muted';
      this._contentExpanded = false;
    } else {
      // Expand to available height
      const rect = snippetContent.getBoundingClientRect();
      const bottomPadding = 24;
      const available = Math.max(400, Math.floor(window.innerHeight - rect.top - bottomPadding));
      snippetContent.style.height = available + 'px';
      icon.className = 'bi bi-caret-up fs-5 text-muted';
      this._contentExpanded = true;
    }
  }

}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new SnippetManager();
});
