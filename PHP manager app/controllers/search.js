class SearchController
{
  constructor(app)
  {
    this.app = app;
  }

  async performSearch()
  {
    const searchInput = document.getElementById('searchInput');
    const query = searchInput?.value.trim();
    if( ! query ) return;

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
