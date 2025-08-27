// Snippet Manager App JavaScript

class SnippetManager
{
  constructor() {
    this.currentPath = '';
    this.currentSnippet = null;
    this.currentDataPath = '';
    this.searchHistory = [];
    this.recentSnippets = [];
    this.selectedFiles = new Set();
    this.placeholderGroups = new Map(); // name => [elements]
    this.renderedText = '';
    this.navigationHistory = []; // Track navigation history for included folders
    
    this.init();
  }

  async init() {
    this.bindEvents();
    const dataFolderSelect = document.getElementById('dataFolderSelect');
    this.currentDataPath = dataFolderSelect?.value || '';
    // Load server-backed user lists (single user)
    try {
      const [h, r] = await Promise.all([
        this.apiCall('getSearchHistory'),
        this.apiCall('getRecentSnippets')
      ]);
      this.searchHistory = (h && h.success && Array.isArray(h.data)) ? h.data : [];
      this.recentSnippets = (r && r.success && Array.isArray(r.data)) ? r.data : [];
    }
    catch( e ) {
      this.searchHistory = [];
      this.recentSnippets = [];
    }
    this.loadFiles();
    this.loadRecentSnippets();
    this.setupSearchHistory();
  }

  bindEvents() {
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
      ['newSnippetBtn', 'click', () => this.showModal('newSnippetModal')],
      ['newFolderBtn', 'click', () => this.showModal('newFolderModal')],
      ['backBtn', 'click', () => this.goBack()],
      ['createSnippetBtn', 'click', () => this.createSnippet()],
      ['createFolderBtn', 'click', () => this.createFolder()],
      ['render-tab', 'click', () => this.composeAndRenderInline()],
      ['copyRenderedBtn', 'click', () => this.copyRenderedContent()],
      ['saveSnippetBtn', 'click', () => this.saveCurrentSnippet()],
      ['duplicateSnippetBtn', 'click', () => this.duplicateCurrentSnippet()],
      ['deleteSnippetBtn', 'click', () => this.deleteCurrentSnippet()],
      ['recent-tab', 'click', () => this.loadRecentSnippets()]
    ];

    buttonEvents.forEach(([elementId, event, handler]) => {
      const element = document.getElementById(elementId);
      if( element ) element.addEventListener(event, handler);
    });

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

    // Tab switching visibility
    document.querySelectorAll('#contentTabs [data-bs-toggle="tab"]')
      .forEach(btn => btn.addEventListener('shown.bs.tab', () => this.updateActionButtonsVisibility()));
    
    // Global document events
    document.addEventListener('click', (e) => {
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
  }

  

  async apiCall(action, data = {}) {
    try {
      const response = await fetch('ajax.php', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action, dataPath: this.currentDataPath, ...data })
      });
      
      return await response.json();
    }
    catch( error ) {
      console.error('API call failed:', error);
      return { success: false, message: 'Network error' };
    }
  }

  async loadFiles(subPath = '') {
    this.showLoading('fileList');
    
    const result = await this.apiCall('listFiles', { subPath });
    
    if( result.success ) {
      this.renderFileList(result.files);
      this.currentPath = subPath;
    }
    else {
      this.showError('Failed to load files: ' + result.message);
    }
    
    this.hideLoading('fileList');
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
            ${file.type === 'file' ? `<small class="text-muted">${file.extension}</small>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  goBack() {
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

  handleFileClick(e) {
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

  async loadSnippet(path) {
    this.showLoading('editContent');
    
    const result = await this.apiCall('loadSnippet', { path });
    
    if( result.success ) {
      this.currentSnippet = result.snippet;
      this.renderEditForm(result.snippet);
      // Inline: add to recent snippets and persist
      const item = { path, name: result.snippet._name, timestamp: Date.now() };
      this.recentSnippets = this.recentSnippets.filter(snippet => snippet.path !== path);
      this.recentSnippets.unshift(item);
      this.recentSnippets = this.recentSnippets.slice(0, 10);
      await this.apiCall('saveRecentSnippets', { data: this.recentSnippets });
      
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
        this.activateTab('edit-tab');
      }
    }
    else {
      this.showError('Failed to load snippet: ' + result.message);
    }
    
    this.hideLoading('editContent');
  }

  renderEditForm(snippet) {
    const editEmptyState = document.getElementById('editEmptyState');
    const editForm = document.getElementById('editForm');
    const snippetNameEdit = document.getElementById('snippetNameEdit');
    const fieldSh = document.getElementById('fieldSh');
    const fieldUsage = document.getElementById('fieldUsage');
    const snippetSh = document.getElementById('snippetSh');
    const snippetUsage = document.getElementById('snippetUsage');
    const snippetContent = document.getElementById('snippetContent');

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

    // Show form, hide empty state
    if( editEmptyState ) editEmptyState.style.display = 'none';
    editForm.style.display = 'block';

    // Configure render tab
    this.configureRenderTab(isYaml);
    this.setActionButtonsEnabled(true);
  }

  configureRenderTab(enabled) {
    const renderTab = document.getElementById('render-tab');
    if( renderTab ) {
      renderTab.disabled = !enabled;
      renderTab.classList.toggle('disabled', !enabled);
    }
  }

  async saveCurrentSnippet() {
    if( ! this.currentSnippet ) return;

    const nameInput = document.getElementById('snippetNameEdit');
    const contentInput = document.getElementById('snippetContent');
    
    if( ! nameInput.value.trim() || ! contentInput.value.trim() ) {
      this.showError('Name and content are required');
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

    const result = await this.apiCall('saveSnippet', { path, data });
    
    if( result.success ) {
      this.showSuccess('Snippet saved successfully');
      this.currentSnippet = data;
      this.loadFiles(this.currentPath); // Refresh file list

      // Re-render after save when YAML
      if( this.currentSnippet._type === 'yml' ) {
        this.composeAndRenderInline();
      }
    }
    else {
      this.showError('Failed to save snippet: ' + result.message);
    }
  }

  async duplicateCurrentSnippet() {
    if( ! this.currentSnippet ) return;

    const newName = prompt('Enter new name for the duplicate:', this.currentSnippet._name + '_copy');
    if( ! newName ) return;

    const extension = this.currentSnippet._type === 'yml' ? 'yml' : 'md';
    const sourcePath = (this.currentPath ? this.currentPath + '/' : '') + this.currentSnippet._name + '.' + extension;
    const targetPath = (this.currentPath ? this.currentPath + '/' : '') + newName + '.' + extension;

    const result = await this.apiCall('duplicateSnippet', { sourcePath, targetPath });
    
    if( result.success ) {
      this.showSuccess('Snippet duplicated successfully');
      this.loadFiles(this.currentPath);
    }
    else {
      this.showError('Failed to duplicate snippet: ' + result.message);
    }
  }

  async deleteCurrentSnippet() {
    if( ! this.currentSnippet ) return;

    if( ! confirm(`Are you sure you want to delete "${this.currentSnippet._name}"?`) ) return;

    const extension = this.currentSnippet._type === 'yml' ? 'yml' : 'md';
    const path = (this.currentPath ? this.currentPath + '/' : '') + this.currentSnippet._name + '.' + extension;

    const result = await this.apiCall('deleteSnippet', { path });
    
    if( result.success ) {
      this.showSuccess('Snippet deleted successfully');
      this.currentSnippet = null;
      this.clearEditForm();
      this.loadFiles(this.currentPath);
    }
    else {
      this.showError('Failed to delete snippet: ' + result.message);
    }
  }

  clearEditForm() {
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

  updateActionButtonsVisibility() {
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
  }

  setActionButtonsEnabled(enabled) {
    ['saveSnippetBtn', 'duplicateSnippetBtn', 'deleteSnippetBtn'].forEach(id => {
      const btn = document.getElementById(id);
      if( btn ) btn.disabled = !enabled;
    });
  }

  activateTab(tabButtonId) {
    const btn = document.getElementById(tabButtonId);
    if( ! btn ) return;
    try {
      const tab = new bootstrap.Tab(btn);
      tab.show();
    }
    catch(e) {
      // No-op if Bootstrap is unavailable
    }
  }

  async composeAndRenderInline() {
    if( ! this.currentSnippet || this.currentSnippet._type !== 'yml' ) return;
    const snippetContent = document.getElementById('snippetContent');
    const inlineContainer = document.getElementById('inlineSnippet');
    if( ! snippetContent || ! inlineContainer ) return;

    const snippet = { ...this.currentSnippet, content: snippetContent.value };
    const result = await this.apiCall('composeContent', { snippet });
    if( result.success ) {
      this.renderInlineSnippet(result.composed || '');
      // Also update live preview initially with defaults
      this.updateRenderedOutput();
    }
  }

  renderInlineSnippet(composedText) {
    const container = document.getElementById('inlineSnippet');
    if( ! container ) return;
    // Build HTML with editable placeholders
    const html = this.buildInlineHtmlFromComposed(composedText);
    container.innerHTML = html;
    this.bindInlinePlaceholderEvents();
  }

  buildInlineHtmlFromComposed(text) {
    const regex = /\{\{\s*([^}]*)\s*\}\}/g;
    let lastIndex = 0;
    let match;
    let out = '';
    while( (match = regex.exec(text)) ) {
      const before = text.slice(lastIndex, match.index);
      out += this.escapeHtml(before);
      const raw = match[1];

      const token = raw.trim();

      // Include directives: leave verbatim (should be pre-resolved server-side)
      if( /^include:\s*["'][^"']+["']$/i.test(token) ) {
        out += this.escapeHtml(match[0]);
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
          const dataChoices = this.escapeHtml(JSON.stringify(choices));
          out += `<span class="ph ph-choice" tabindex="0" data-ph="${this.escapeHtml(name)}" data-default="${this.escapeHtml(defChoice)}" data-choices='${dataChoices}'>${this.escapeHtml(defChoice)}</span>`;
        }
        else {
          const defVal = def;
          out += `<span class="ph ph-text" contenteditable="true" tabindex="0" data-ph="${this.escapeHtml(name)}" data-default="${this.escapeHtml(defVal)}">${this.escapeHtml(defVal)}</span>`;
        }
      }
      else if( simpleRe.test(token) ) {
        const name = token;
        out += `<span class="ph ph-text" contenteditable="true" tabindex="0" data-ph="${this.escapeHtml(name)}" data-default="" data-ph-label="${this.escapeHtml(name)}"></span>`;
      }
      else {
        // No valid placeholder token; render verbatim
        out += this.escapeHtml(match[0]);
      }
      lastIndex = regex.lastIndex;
    }
    out += this.escapeHtml(text.slice(lastIndex));
    return out;
  }

  bindInlinePlaceholderEvents() {
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
      const name = el.dataset.ph;
      const edited = el.dataset.edited === '1';
      const defVal = el.dataset.default || '';
      let value = (el.textContent || '').trim();
      if( ! edited || value === '' ) value = defVal;
      setGroupValue(name, value);
      this.closeChoiceMenu();
    };
    const onInput = (e) => {
      const el = e.currentTarget;
      el.dataset.edited = '1';
      const name = el.dataset.ph;
      const value = el.textContent;
      // mirror to siblings (avoid recursion by direct assignment)
      const group = this.placeholderGroups.get(name) || [];
      group.forEach(node => { if( node !== el ) node.textContent = value; });
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
  }

  openChoiceMenu(el) {
    const menu = document.getElementById('phChoiceMenu');
    if( ! menu ) return;
    const choices = JSON.parse(el.dataset.choices || '[]');
    const name = el.dataset.ph;
    const rect = el.getBoundingClientRect();
    menu.innerHTML = choices.map(ch => `<button type="button" class="dropdown-item" data-value="${this.escapeHtml(ch)}">${this.escapeHtml(ch)}</button>`).join('');
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

  closeChoiceMenu() {
    const menu = document.getElementById('phChoiceMenu');
    if( ! menu ) return;
    menu.classList.remove('show');
    menu.style.display = 'none';
    if( this._choiceOutsideHandler ) {
      document.removeEventListener('click', this._choiceOutsideHandler);
      this._choiceOutsideHandler = null;
    }
  }

  getCurrentPlaceholderValues() {
    const values = {};
    this.placeholderGroups.forEach((nodes, name) => {
      const el = nodes[0];
      const txt = (el.textContent || '').trim();
      values[name] = txt !== '' ? txt : (el.dataset.default || '');
    });
    return values;
  }

  async updateRenderedOutput() {
    if( ! this.currentSnippet ) return;
    const snippetContent = document.getElementById('snippetContent');
    const snippet = { ...this.currentSnippet, content: snippetContent?.value || this.currentSnippet.content };
    const placeholders = this.getCurrentPlaceholderValues();
    const result = await this.apiCall('renderSnippet', { snippet, placeholders });
    if( result.success ) {
      this.renderedText = result.rendered || '';
      const copyRenderedBtn = document.getElementById('copyRenderedBtn');
      if( copyRenderedBtn ) copyRenderedBtn.disabled = this.renderedText.length === 0;
    }
    else {
      this.showError('Failed to render snippet: ' + result.message);
    }
  }

  async copyRenderedContent() {
    if( ! this.renderedText ) return;
    
    try {
      await navigator.clipboard.writeText(this.renderedText);
      this.showSuccess('Content copied to clipboard');
    }
    catch( error ) {
      this.showError('Failed to copy content');
    }
  }

  async performSearch() {
    const searchInput = document.getElementById('searchInput');
    const query = searchInput?.value.trim();
    if( ! query ) return;

    // Inline: update search history and persist
    this.searchHistory = this.searchHistory.filter(item => item !== query);
    this.searchHistory.unshift(query);
    this.searchHistory = this.searchHistory.slice(0, 20);
    await this.apiCall('saveSearchHistory', { data: this.searchHistory });
    
    const result = await this.apiCall('searchSnippets', { query });
    
    if( result.success ) {
      this.renderSearchResults(result.results);
    }
    else {
      this.showError('Search failed: ' + result.message);
    }
  }

  renderSearchResults(results) {
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
      const icon = result.type === 'yml' ? 'bi-file-code' : 'bi-file-text';
      
      return `
        <div class="list-group-item file-item" data-path="${result.path}" 
             data-type="file" data-extension="${result.type}">
          <div class="d-flex align-items-center">
            <i class="bi ${icon} file-icon me-2"></i>
            <div class="flex-grow-1">
              <div class="fw-medium">${result.name}</div>
              <div class="file-meta">${result.type.toUpperCase()} • ${result.path}</div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  handleSearch(query) {
    if( query.length > 0 ) {
      this.showSearchHistory();
    }
    else {
      this.hideSearchHistory();
    }
  }

  showSearchHistory() {
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

  hideSearchHistory() {
    document.getElementById('searchHistory').style.display = 'none';
  }

  setupSearchHistory() {
    // Hide search history when clicking outside
    document.addEventListener('click', (e) => {
      if( ! e.target.closest('#searchInput') && ! e.target.closest('#searchHistory') ) {
        this.hideSearchHistory();
      }
    });
  }

  showContextMenu(e) {
    // Context menu functionality can be implemented here
    // For now, just prevent the default context menu
    e.preventDefault();
  }

  hideContextMenu() {
    // Hide any custom context menu if implemented
    const contextMenu = document.querySelector('.context-menu');
    if( contextMenu ) {
      contextMenu.remove();
    }
  }

  

  loadRecentSnippets() {
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
      const timeAgo = this.timeAgo(item.timestamp);
      
      return `
        <div class="list-group-item file-item" data-path="${item.path}" 
             data-type="file" data-extension="${extension}">
          <div class="d-flex align-items-center">
            <i class="bi ${icon} file-icon me-2"></i>
            <div class="flex-grow-1">
              <div class="fw-medium">${item.name}</div>
              <div class="file-meta">${timeAgo}</div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  timeAgo(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if( minutes < 1 ) return 'Just now';
    if( minutes < 60 ) return `${minutes}m ago`;
    if( hours < 24 ) return `${hours}h ago`;
    return `${days}d ago`;
  }

  showModal(modalId) {
    const modal = new bootstrap.Modal(document.getElementById(modalId));
    modal.show();
  }

  async createSnippet() {
    const name = document.getElementById('snippetName').value.trim();
    const type = document.getElementById('snippetType').value;
    
    if( ! name ) {
      this.showError('Snippet name is required');
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

    const result = await this.apiCall('saveSnippet', { path, data });
    
    if( result.success ) {
      this.loadFiles(this.currentPath);
      
      // Close modal
      const modal = bootstrap.Modal.getInstance(document.getElementById('newSnippetModal'));
      modal.hide();
      
      // Clear form
      document.getElementById('newSnippetForm').reset();
    }
    else {
      this.showError('Failed to create snippet: ' + result.message);
    }
  }

  async createFolder() {
    const name = document.getElementById('folderName').value.trim();
    
    if( ! name ) {
      this.showError('Folder name is required');
      return;
    }

    const folderPath = (this.currentPath ? this.currentPath + '/' : '') + name;

    const result = await this.apiCall('createFolder', { folderPath });
    
    if( result.success ) {
      this.loadFiles(this.currentPath);
      
      // Close modal
      const modal = bootstrap.Modal.getInstance(document.getElementById('newFolderModal'));
      modal.hide();
      
      // Clear form
      document.getElementById('newFolderForm').reset();
    }
    else {
      this.showError('Failed to create folder: ' + result.message);
    }
  }

  async changeDataFolder(dataPath) {
    // Update local state and inform server for consistency
    this.currentDataPath = dataPath;
    const result = await this.apiCall('setDataPath', { dataPath });
    
    if( result.success ) {
      this.currentPath = '';
      this.loadFiles();
    }
    else {
      this.showError('Failed to change data folder: ' + result.message);
    }
  }

  showLoading(elementId) {
    const element = document.getElementById(elementId);
    element.classList.add('loading');
  }

  hideLoading(elementId) {
    const element = document.getElementById(elementId);
    element.classList.remove('loading');
  }

  showSuccess(message) {
    this.showAlert(message, 'success');
  }

  showError(message) {
    this.showAlert(message, 'danger');
  }

  showAlert(message, type) {
    const alertHtml = `
      <div class="alert alert-${type} alert-floating alert-dismissible fade show" role="alert">
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', alertHtml);
    
    // Auto-dismiss after 5 seconds
    setTimeout(() => {
      const alert = document.querySelector('.alert-floating');
      if( alert ) {
        const bsAlert = new bootstrap.Alert(alert);
        bsAlert.close();
      }
    }, 5000);
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new SnippetManager();
});
