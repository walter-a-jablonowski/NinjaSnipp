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
    // Initialize current data path from select
    const sel = document.getElementById('dataFolderSelect');
    if( sel ) this.currentDataPath = sel.value;
    this.loadFiles();
    this.loadRecentSnippets();
    this.setupSearchHistory();
  }

  bindEvents() {
    // Search functionality
    document.getElementById('searchInput').addEventListener('input', (e) => {
      this.handleSearch(e.target.value);
    });
    
    document.getElementById('searchBtn').addEventListener('click', () => {
      this.performSearch();
    });
    
    document.getElementById('searchInput').addEventListener('keydown', (e) => {
      if( e.key === 'Enter' ) {
        this.performSearch();
      }
      if( e.key === 'ArrowDown' || e.key === 'ArrowUp' ) {
        this.navigateSearchHistory(e.key);
        e.preventDefault();
      }
    });

    // Data folder selection
    document.getElementById('dataFolderSelect').addEventListener('change', (e) => {
      this.changeDataFolder(e.target.value);
    });

    // New snippet/folder buttons
    document.getElementById('newSnippetBtn').addEventListener('click', () => {
      this.showNewSnippetModal();
    });
    
    document.getElementById('newFolderBtn').addEventListener('click', () => {
      this.showNewFolderModal();
    });

    // Modal actions
    document.getElementById('createSnippetBtn').addEventListener('click', () => {
      this.createSnippet();
    });
    
    document.getElementById('createFolderBtn').addEventListener('click', () => {
      this.createFolder();
    });

    // Tab switching
    document.getElementById('render-tab').addEventListener('click', () => {
      this.switchToRenderTab();
    });

    // Render button
    document.getElementById('renderBtn').addEventListener('click', () => {
      this.renderSnippet();
    });

    // Copy rendered button
    document.getElementById('copyRenderedBtn').addEventListener('click', () => {
      this.copyRenderedContent();
    });

    // Breadcrumb navigation
    document.addEventListener('click', (e) => {
      if( e.target.matches('.breadcrumb a') ) {
        e.preventDefault();
        this.navigateToPath(e.target.dataset.path);
      }
    });

    // File list interactions
    document.addEventListener('click', (e) => {
      if( e.target.closest('.file-item') ) {
        this.handleFileClick(e);
      }
    });

    // Context menu
    document.addEventListener('contextmenu', (e) => {
      if( e.target.closest('.file-item') ) {
        e.preventDefault();
        this.showContextMenu(e);
      }
    });

    // Hide context menu on click outside
    document.addEventListener('click', () => {
      this.hideContextMenu();
    });

    // Recent tab
    document.getElementById('recent-tab').addEventListener('click', () => {
      this.loadRecentSnippets();
    });
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
      this.updateBreadcrumb(subPath);
      this.currentPath = subPath;
    }
    else {
      this.showError('Failed to load files: ' + result.message);
    }
    
    this.hideLoading('fileList');
  }

  renderFileList(files) {
    const fileList = document.getElementById('fileList');
    
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

  updateBreadcrumb(path) {
    const breadcrumb = document.getElementById('breadcrumb');
    const parts = path ? path.split('/') : [];
    
    let html = '<li class="breadcrumb-item"><a href="#" data-path="">Base</a></li>';
    let currentPath = '';
    
    parts.forEach((part, index) => {
      currentPath += (currentPath ? '/' : '') + part;
      const isLast = index === parts.length - 1;
      
      if( isLast ) {
        html += `<li class="breadcrumb-item active">${part}</li>`;
      }
      else {
        html += `<li class="breadcrumb-item"><a href="#" data-path="${currentPath}">${part}</a></li>`;
      }
    });
    
    breadcrumb.innerHTML = html;
  }

  handleFileClick(e) {
    const fileItem = e.target.closest('.file-item');
    const path = fileItem.dataset.path;
    const type = fileItem.dataset.type;
    const extension = fileItem.dataset.extension;

    // Clear previous selection
    document.querySelectorAll('.file-item.active').forEach(item => {
      item.classList.remove('active');
    });
    
    fileItem.classList.add('active');

    if( type === 'folder' ) {
      this.navigateToPath(path);
    }
    else {
      // The path already includes the full filename with extension
      this.loadSnippet(path);
    }
  }

  navigateToPath(path) {
    this.loadFiles(path);
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
      }
      else {
        renderTab.disabled = true;
        renderTab.classList.add('disabled');
      }
    }
    else {
      this.showError('Failed to load snippet: ' + result.message);
    }
    
    this.hideLoading('editContent');
  }

  renderEditForm(snippet) {
    const editContent = document.getElementById('editContent');
    
    if( snippet._type === 'yml' ) {
      editContent.innerHTML = `
        <form class="snippet-form">
          <div class="action-buttons d-flex gap-2 mb-3">
            <button type="button" class="btn btn-primary" id="saveSnippetBtn">
              <i class="bi bi-save me-1"></i>Save
            </button>
            <button type="button" class="btn btn-outline-secondary" id="duplicateSnippetBtn">
              <i class="bi bi-files me-1"></i>Duplicate
            </button>
            <button type="button" class="btn btn-outline-danger" id="deleteSnippetBtn">
              <i class="bi bi-trash me-1"></i>Delete
            </button>
          </div>
          
          <div class="mb-3">
            <label for="snippetNameEdit" class="form-label">Name</label>
            <input type="text" class="form-control" id="snippetNameEdit" value="${snippet._name}" required>
          </div>
          
          <div class="mb-3">
            <label for="snippetSh" class="form-label">Short Code</label>
            <input type="text" class="form-control" id="snippetSh" value="${snippet.sh || ''}" placeholder="e.g., arr--">
          </div>
          
          <div class="mb-3">
            <label for="snippetUsage" class="form-label">Usage</label>
            <textarea class="form-control" id="snippetUsage" rows="3" placeholder="Comments, usage and sample...">${snippet.usage || ''}</textarea>
          </div>
          
          <div class="mb-3">
            <label for="snippetContent" class="form-label">Content</label>
            <textarea class="form-control" id="snippetContent" rows="10" placeholder="Some {var} snippet..." required>${snippet.content || ''}</textarea>
          </div>
        </form>
      `;
    }
    else {
      editContent.innerHTML = `
        <form class="snippet-form">
          <div class="action-buttons d-flex gap-2 mb-3">
            <button type="button" class="btn btn-primary" id="saveSnippetBtn">
              <i class="bi bi-save me-1"></i>Save
            </button>
            <button type="button" class="btn btn-outline-secondary" id="duplicateSnippetBtn">
              <i class="bi bi-files me-1"></i>Duplicate
            </button>
            <button type="button" class="btn btn-outline-danger" id="deleteSnippetBtn">
              <i class="bi bi-trash me-1"></i>Delete
            </button>
          </div>
          
          <div class="mb-3">
            <label for="snippetNameEdit" class="form-label">File Name</label>
            <input type="text" class="form-control" id="snippetNameEdit" value="${snippet._name}" required>
          </div>
          
          <div class="mb-3">
            <label for="snippetContent" class="form-label">Content</label>
            <textarea class="form-control" id="snippetContent" rows="15" required>${snippet.content || ''}</textarea>
          </div>
        </form>
      `;
    }

    // Bind save button
    document.getElementById('saveSnippetBtn').addEventListener('click', () => {
      this.saveCurrentSnippet();
    });
    
    // Bind duplicate button
    document.getElementById('duplicateSnippetBtn').addEventListener('click', () => {
      this.duplicateCurrentSnippet();
    });
    
    // Bind delete button
    document.getElementById('deleteSnippetBtn').addEventListener('click', () => {
      this.deleteCurrentSnippet();
    });
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
    document.getElementById('editContent').innerHTML = `
      <div class="text-center text-muted py-5">
        <i class="bi bi-file-text display-1"></i>
        <p class="mt-3">Select a snippet to edit or create a new one</p>
      </div>
    `;
    
    // Disable render tab
    const renderTab = document.getElementById('render-tab');
    renderTab.disabled = true;
    renderTab.classList.add('disabled');
  }

  switchToRenderTab() {
    if( ! this.currentSnippet || this.currentSnippet._type !== 'yml' ) return;

    this.extractAndShowPlaceholders();
  }

  async extractAndShowPlaceholders() {
    const contentInput = document.getElementById('snippetContent');
    if( ! contentInput ) return;

    const result = await this.apiCall('extractPlaceholders', { content: contentInput.value });
    
    if( result.success ) {
      this.renderPlaceholderForm(result.placeholders);
    }
  }

  renderPlaceholderForm(placeholders) {
    const placeholderForm = document.getElementById('placeholderForm');
    const placeholderInputs = document.getElementById('placeholderInputs');
    
    if( Object.keys(placeholders).length === 0 ) {
      placeholderForm.style.display = 'none';
      this.renderSnippet();
      return;
    }

    placeholderForm.style.display = 'block';
    
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
      document.getElementById('renderedOutput').innerHTML = `<code>${this.escapeHtml(result.rendered)}</code>`;
      document.getElementById('copyRenderedBtn').disabled = false;
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
    const output = document.getElementById('renderedOutput');
    const text = output.textContent;
    
    try {
      await navigator.clipboard.writeText(text);
      this.showSuccess('Content copied to clipboard');
    }
    catch( error ) {
      this.showError('Failed to copy content');
    }
  }

  async performSearch() {
    const query = document.getElementById('searchInput').value.trim();
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
        document.getElementById('searchInput').value = query;
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

  showNewSnippetModal() {
    const modal = new bootstrap.Modal(document.getElementById('newSnippetModal'));
    modal.show();
  }

  showNewFolderModal() {
    const modal = new bootstrap.Modal(document.getElementById('newFolderModal'));
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
