class SearchController
{
  constructor(app)
  {
    this.app = app;
    this._historyIndex = null; // position while walking the history with the arrow keys
  }

  async performSearch()
  {
    const searchInput = document.getElementById('searchInput');
    const query = searchInput?.value.trim();
    if( ! query ) return;

    this._historyIndex = null;
    this.app.searchHistory = this.app.searchHistory.filter(item => item !== query);
    this.app.searchHistory.unshift(query);
    this.app.searchHistory = this.app.searchHistory.slice(0, 20);
    await apiCall(this.app.currentDataPath, 'saveSearchHistory', { data: this.app.searchHistory });

    const result = await apiCall(this.app.currentDataPath, 'searchSnippets', { query });

    if( result.success ) {
      this.app.isSearchMode = true;
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
        <div class="list-group-item file-item" data-path="${escapeHtml(result.path)}"
             data-type="${dataType}" data-extension="${escapeHtml(dataExtension)}">
          <div class="d-flex align-items-center">
            <i class="bi ${icon} file-icon me-2"></i>
            <div class="flex-grow-1">
              <div class="fw-medium">${escapeHtml(result.name)}</div>
              <div class="file-meta">${escapeHtml(metaInfo)}</div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  handleSearch(query)
  {
    this._historyIndex = null; // typing leaves the history walk

    if( query.length > 0 ) {
      this.showSearchHistory();
    }
    else {
      this.hideSearchHistory();
      if( this.app.isSearchMode ) {
        this.app.isSearchMode = false;
        this.app.loadFiles();
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

    searchHistory.innerHTML = this.app.searchHistory.slice(0, 10).map(item => `
      <div class="search-history-item" data-query="${escapeHtml(item)}">
        <i class="bi bi-clock-history me-2"></i>${escapeHtml(item)}
      </div>
    `).join('');
  }

  hideSearchHistory()
  {
    const searchHistory = document.getElementById('searchHistory');
    if( searchHistory ) searchHistory.style.display = 'none';
  }

  // Arrow-key walk through past queries: Up goes to older entries, Down back toward the
  // newest and then clears the field. Typing or running a search resets the position.
  navigateSearchHistory(key)
  {
    const searchInput = document.getElementById('searchInput');
    if( ! searchInput || this.app.searchHistory.length === 0 ) return;

    const oldest = this.app.searchHistory.length - 1;

    if( key === 'ArrowUp' )
      this._historyIndex = this._historyIndex === null ? 0 : Math.min(this._historyIndex + 1, oldest);
    else if( this._historyIndex === null )
      return;                       // Down with nothing recalled yet: leave the field alone
    else if( this._historyIndex === 0 ) {
      this._historyIndex = null;    // stepped past the newest entry
      searchInput.value = '';
      return;
    }
    else
      this._historyIndex--;

    searchInput.value = this.app.searchHistory[this._historyIndex];
    searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
  }

  setupSearchHistory()
  {
    const searchHistory = document.getElementById('searchHistory');
    const searchInput = document.getElementById('searchInput');

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

    document.addEventListener('click', (e) => {
      if( ! e.target.closest('#searchInput') && ! e.target.closest('#searchHistory') ) {
        this.hideSearchHistory();
      }
    });
  }

  loadRecentSnippets()
  {
    const recentList = document.getElementById('recentList');
    if( ! recentList ) return;

    if( this.app.recentSnippets.length === 0 ) {
      recentList.innerHTML = `
        <div class="empty-state">
          <i class="bi bi-clock-history"></i>
          <p>No recent snippets</p>
        </div>
      `;
      return;
    }

    recentList.innerHTML = this.app.recentSnippets.map(item => {
      const extension = item.path.split('.').pop();
      const icon = extension === 'yml' ? 'bi-file-code' : 'bi-file-text';
      const timeStr = timeAgo(item.timestamp);

      return `
        <div class="list-group-item file-item recent-file-item" data-path="${item.path}"
             data-type="file" data-extension="${extension}">
          <div class="d-flex align-items-center">
            <i class="bi ${icon} file-icon me-2"></i>
            <div class="flex-grow-1 overflow-hidden">
              <div class="recent-file-name">${item.name}</div>
              <div class="file-meta">${timeStr}</div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  showContextMenu(e)
  {
    e.preventDefault();
  }

  hideContextMenu()
  {
    const contextMenu = document.querySelector('.context-menu');
    if( contextMenu ) contextMenu.remove();
  }
}
