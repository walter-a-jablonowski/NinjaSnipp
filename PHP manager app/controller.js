// Snippet Manager App JavaScript

class SnippetManager {
  constructor() {
    this.currentPath = '';
    this.currentSnippet = null;
    this.currentDataPath = '';
    this.searchHistory = JSON.parse(localStorage.getItem('searchHistory') || '[]');
    this.recentSnippets = JSON.parse(localStorage.getItem('recentSnippets') || '[]');
    this.selectedFiles = new Set();
    
    this.init();
  }

  init() {
    this.bindEvents();
    const dataFolderSelect = document.getElementById('dataFolderSelect');
    this.currentDataPath = dataFolderSelect?.value || '';
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
      ['render-tab', 'click', () => this.extractAndShowPlaceholders()],
      ['renderBtn', 'click', () => this.renderSnippet()],
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
      
      return `
        <div class="list-group-item file-item" data-path="${file.path}" data-type="${file.type}" data-extension="${file.extension || ''}">
          <div class="d-flex align-items-center">
            <i class="bi ${icon} file-icon me-2"></i>
            <div class="flex-grow-1">
              <div class="fw-medium">${file.name}</div>
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
      this.loadFiles(path);
    }
    else {
      this.loadSnippet(path);
    }
  }


  async loadSnippet(path) {
    this.showLoading('editContent');
    
    const result = await this.apiCall('loadSnippet', { path });
    
    if( result.success ) {
      this.currentSnippet = result.snippet;
      this.renderEditForm(result.snippet);
      this.addToRecentSnippets(path, result.snippet._name);
      
      // Enable render tab for yml files
      const renderTab = document.getElementById('render-tab');
      if( result.snippet._type === 'yml' ) {
        renderTab.disabled = false;
        renderTab.classList.remove('disabled');
        // Auto-render immediately when a YAML snippet is selected
        this.extractAndShowPlaceholders();
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
        this.extractAndShowPlaceholders();
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


  async extractAndShowPlaceholders() {
    if( ! this.currentSnippet || this.currentSnippet._type !== 'yml' ) return;
    
    const snippetContent = document.getElementById('snippetContent');
    if( ! snippetContent ) return;

    const result = await this.apiCall('extractPlaceholders', { content: snippetContent.value });
    
    if( result.success ) {
      this.renderPlaceholderForm(result.placeholders);
    }
  }

  renderPlaceholderForm(placeholders) {
    const placeholderForm = document.getElementById('placeholderForm');
    const placeholderInputs = document.getElementById('placeholderInputs');
    
    if( Object.keys(placeholders).length === 0 ) {
      if( placeholderForm ) placeholderForm.style.display = 'none';
      this.renderSnippet();
      return;
    }

    if( placeholderForm ) placeholderForm.style.display = 'block';
    
    if( placeholderInputs ) {
      placeholderInputs.innerHTML = Object.entries(placeholders).map(([name, config]) => {
        if( config.type === 'choice' ) {
          return `
            <div class="placeholder-input">
              <label class="form-label">${name}</label>
              <div class="placeholder-choice">
                ${config.choices.map((choice, index) => `
                  <button type="button" class="btn btn-outline-primary ${index === 0 ? 'active' : ''}" 
                          data-placeholder="${name}" data-value="${choice}">
                    ${choice}
                  </button>
                `).join('')}
              </div>
            </div>
          `;
        }
        else {
          return `
            <div class="placeholder-input">
              <label for="placeholder_${name}" class="form-label">${name}</label>
              <input type="text" class="form-control" id="placeholder_${name}" 
                     data-placeholder="${name}" value="${config.default}" placeholder="${config.default}">
            </div>
          `;
        }
      }).join('');

      // Bind choice buttons
      placeholderInputs.addEventListener('click', (e) => {
        if( e.target.matches('.placeholder-choice .btn') ) {
          const placeholder = e.target.dataset.placeholder;
          const buttons = placeholderInputs.querySelectorAll(`[data-placeholder="${placeholder}"]`);
          buttons.forEach(btn => btn.classList.remove('active'));
          e.target.classList.add('active');
        }
      });
    }

    this.renderSnippet();
  }

  async renderSnippet() {
    if( ! this.currentSnippet ) return;

    const placeholders = this.collectPlaceholderValues();
    
    const result = await this.apiCall('renderSnippet', { 
      snippet: this.currentSnippet, 
      placeholders 
    });
    
    if( result.success ) {
      const renderedOutput = document.getElementById('renderedOutput');
      if( renderedOutput ) {
        renderedOutput.innerHTML = `<code>${this.escapeHtml(result.rendered)}</code>`;
      }
      const copyRenderedBtn = document.getElementById('copyRenderedBtn');
      if( copyRenderedBtn ) {
        copyRenderedBtn.disabled = false;
      }
    }
    else {
      this.showError('Failed to render snippet: ' + result.message);
    }
  }

  collectPlaceholderValues() {
    const placeholders = {};
    const inputs = document.querySelectorAll('#placeholderInputs input[data-placeholder]');
    const activeButtons = document.querySelectorAll('#placeholderInputs .btn.active[data-placeholder]');
    
    inputs.forEach(input => {
      placeholders[input.dataset.placeholder] = input.value;
    });
    
    activeButtons.forEach(button => {
      placeholders[button.dataset.placeholder] = button.dataset.value;
    });
    
    return placeholders;
  }

  async copyRenderedContent() {
    const renderedOutput = document.getElementById('renderedOutput');
    if( ! renderedOutput ) return;
    
    try {
      await navigator.clipboard.writeText(renderedOutput.textContent);
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

    this.addToSearchHistory(query);
    
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
        <div class="list-group-item file-item" data-path="${result.path.replace(/\.[^.]+$/, '')}" 
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

  addToSearchHistory(query) {
    // Remove if already exists
    this.searchHistory = this.searchHistory.filter(item => item !== query);
    // Add to beginning
    this.searchHistory.unshift(query);
    // Keep only last 20 items
    this.searchHistory = this.searchHistory.slice(0, 20);
    
    localStorage.setItem('searchHistory', JSON.stringify(this.searchHistory));
  }

  addToRecentSnippets(path, name) {
    const item = { path, name, timestamp: Date.now() };
    
    // Remove if already exists
    this.recentSnippets = this.recentSnippets.filter(snippet => snippet.path !== path);
    // Add to beginning
    this.recentSnippets.unshift(item);
    // Keep only last 10 items
    this.recentSnippets = this.recentSnippets.slice(0, 10);
    
    localStorage.setItem('recentSnippets', JSON.stringify(this.recentSnippets));
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
        <div class="list-group-item file-item" data-path="${item.path.replace(/\.[^.]+$/, '')}" 
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
      content: type === 'yml' ? 'Some {var} snippet content...' : '# New Markdown File\n\nContent here...'
    };

    if( type === 'yml' ) {
      data.sh = '';
      data.usage = '';
    }

    const extension = type === 'yml' ? 'yml' : 'md';
    const path = (this.currentPath ? this.currentPath + '/' : '') + name + '.' + extension;

    const result = await this.apiCall('saveSnippet', { path, data });
    
    if( result.success ) {
      this.showSuccess('Snippet created successfully');
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
      this.showSuccess('Folder created successfully');
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
    // Update local state and notify server for consistency
    this.currentDataPath = dataPath;
    const result = await this.apiCall('setDataPath', { dataPath });
    
    if( result.success ) {
      this.currentPath = '';
      this.loadFiles();
      this.showSuccess('Data folder changed successfully');
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
