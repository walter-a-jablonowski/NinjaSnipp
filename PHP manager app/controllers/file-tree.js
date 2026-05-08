class FileTreeController
{
  constructor(app)
  {
    this.app = app;
    this._folderColors = null; // cached palette from settings
  }

  async loadFolderColors()
  {
    if( this._folderColors !== null ) return this._folderColors;
    const res = await apiCall(this.app.currentDataPath, 'getFolderColors');
    this._folderColors = (res && res.success && res.colors && typeof res.colors === 'object') ? res.colors : {};
    return this._folderColors;
  }

  // --- Tree state helpers ---

  buildTreeNodes(files)
  {
    return files.map(file => ({
      name: file.name,
      path: file.path,                          // virtual tree path (unique position in tree)
      fsPath: file.fsPath || file.path,          // real filesystem path (for listFiles/loadSnippet)
      type: file.type,
      extension: file.extension || '',
      modified: file.modified || null,
      isIncluded: file.isIncluded || false,
      color: file.color || null,
      colorName: file.colorName || null,
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
      if( node.type === 'folder' && this.app.expandedFolders.has(node.path) ) {
        node.isOpen = true;
        if( node.children === null ) {
          const result = await apiCall(this.app.currentDataPath, 'listFiles', { subPath: node.fsPath || node.path });
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
    const node = this.findNodeInTree(this.app.fileTree, path);
    if( ! node || node.type !== 'folder' ) return;

    if( node.isOpen ) {
      node.isOpen = false;
      this.app.expandedFolders.delete(path);
    }
    else {
      if( node.children === null ) {
        const result = await apiCall(this.app.currentDataPath, 'listFiles', { subPath: node.fsPath || path });
        if( result.success )
          node.children = this.buildTreeNodes(result.files);
        else {
          showError('Failed to load folder');
          return;
        }
      }
      node.isOpen = true;
      this.app.expandedFolders.add(path);
    }

    this.renderTree();
  }

  // --- Tree rendering ---

  async renderTree()
  {
    // Pre-load palette so swatches render on first open
    await this.loadFolderColors();

    const fileList = document.getElementById('fileList');
    if( ! fileList ) return;

    const flat = this.flattenTree(this.app.fileTree);

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
    if( ! this.app.currentSnippet ) return;
    const ext = this.app.currentSnippet._type === 'yml' ? 'yml' : 'md';
    const activePath = (this.app.currentPath ? this.app.currentPath + '/' : '') + this.app.currentSnippet._name + '.' + ext;
    const item = document.querySelector(`.tree-item[data-path="${activePath}"]`)
               || document.querySelector(`.tree-item[data-fspath="${activePath}"]`);
    if( item ) item.classList.add('active');
  }

  renderTreeNode(node)
  {
    const { type, _depth, path, fsPath, name, isOpen, extension, isIncluded, color, colorName } = node;
    const isFolder  = type === 'folder';
    const indentPx  = 6 + _depth * 14;
    const realFsPath = fsPath || path;

    const icon = isFolder
      ? (isOpen ? 'bi-folder2-open' : 'bi-folder')
      : (extension === 'yml' ? 'bi-file-code' : 'bi-file-text');

    const toggleEl = isFolder
      ? `<i class="bi ${isOpen ? 'bi-chevron-down' : 'bi-chevron-right'} tree-toggle"></i>`
      : `<span class="tree-toggle-spacer"></span>`;

    const includedIcon = isIncluded
      ? '<i class="bi bi-link-45deg text-primary ms-1" title="Included"></i>'
      : '';

    const styleVal = color
      ? `padding-left: ${indentPx}px; background-color: ${color};`
      : `padding-left: ${indentPx}px;`;

    const colorSwatches = ! isIncluded
      ? this._buildColorSwatchesHtml(colorName)
      : '';

    let menuItems;
    if( isIncluded ) {
      menuItems = isFolder
        ? `<li><a class="dropdown-item small" href="#" data-action="new-snippet">New Snippet</a></li>
           <li><a class="dropdown-item small" href="#" data-action="new-folder">New Folder</a></li>`
        : `<li><span class="dropdown-item small text-muted disabled">Included file</span></li>`;
    }
    else {
      menuItems = isFolder
        ? `<li><a class="dropdown-item small" href="#" data-action="new-snippet">New Snippet</a></li>
           <li><a class="dropdown-item small" href="#" data-action="new-folder">New Folder</a></li>
           <li><hr class="dropdown-divider"></li>
           ${colorSwatches}
           <li><hr class="dropdown-divider"></li>
           <li><a class="dropdown-item small" href="#" data-action="rename">Rename</a></li>`
        : `${colorSwatches}
           <li><hr class="dropdown-divider"></li>
           <li><a class="dropdown-item small" href="#" data-action="rename">Rename</a></li>
           <li><a class="dropdown-item small text-danger" href="#" data-action="delete">Delete</a></li>`;
    }

    return `<div class="tree-item${isFolder ? ' tree-folder' : ' tree-file'}${isIncluded ? ' tree-included' : ''}" ` +
      `data-path="${path}" data-fspath="${realFsPath}" data-type="${type}" data-extension="${extension || ''}" ` +
      `tabindex="0" style="${styleVal}">` +
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

  _buildColorSwatchesHtml(currentColorName)
  {
    const colors  = this._folderColors || {};
    const entries = Object.entries(colors);
    if( entries.length === 0 ) return '';

    const swatches = entries.map(([name, hex]) => {
      const active = name === currentColorName ? ' swatch-active' : '';
      return `<span class="folder-color-swatch${active}" data-action="set-color" data-color="${name}" style="background:${hex}" title="${name}"></span>`;
    }).join('');

    const clearBtn = currentColorName
      ? `<span class="folder-color-swatch swatch-clear" data-action="set-color" data-color="" title="Clear color">✕</span>`
      : '';

    return `<li><div class="folder-color-row px-2 py-1">${swatches}${clearBtn}</div></li>`;
  }

  handleFileListDropdownClick(e)
  {
    const actionEl = e.target.closest('[data-action]');
    if( ! actionEl ) return;
    const action = actionEl.getAttribute('data-action');
    const item   = actionEl.closest('.tree-item');
    if( ! item ) return;
    const path   = item.getAttribute('data-path');
    const fsPath = item.getAttribute('data-fspath') || path;
    const type   = item.getAttribute('data-type');
    const ext    = item.getAttribute('data-extension') || '';

    if( action === 'rename' ) {
      const parts    = path.split('/');
      const filename = parts.pop();
      const parent   = parts.join('/');
      let base = filename;
      if( type === 'file' && ext ) {
        const dExt = '.' + ext;
        if( base.toLowerCase().endsWith(dExt) ) base = base.slice(0, -dExt.length);
      }
      this.app._renameContext = { oldPath: path, parent, type, ext };
      const input = document.getElementById('renameNameInput');
      if( input ) input.value = base;
      showModal('renameItemModal');
    }
    else if( action === 'set-color' ) {
      e.stopPropagation(); // prevent Bootstrap from closing dropdown before we handle it
      const color = actionEl.getAttribute('data-color') || null;
      // Close the dropdown manually after selection
      const dropdownEl = item.querySelector('.tree-menu-btn');
      if( dropdownEl ) {
        const dd = bootstrap.Dropdown.getInstance(dropdownEl);
        if( dd ) dd.hide();
      }
      if( type === 'folder' )
        this._applyFolderColor(path, color || null);
      else
        this._applyFileColor(fsPath, path, color || null);
    }
    else if( action === 'new-snippet' ) {
      this.app.currentPath = fsPath;
      if( fsPath ) this.app.expandedFolders.add(path);
      showModal('newSnippetModal');
    }
    else if( action === 'new-folder' ) {
      this.app.currentPath = fsPath;
      if( fsPath ) this.app.expandedFolders.add(path);
      showModal('newFolderModal');
    }
    else if( action === 'delete' ) {
      const nameParts = path.split('/');
      const fullName  = nameParts.pop();
      const baseName  = ext ? fullName.replace(new RegExp('\\.' + ext + '$', 'i'), '') : fullName;
      this.app._deleteContext = { path, name: baseName };
      const nameEl = document.getElementById('deleteSnippetName');
      if( nameEl ) nameEl.textContent = baseName;
      showModal('deleteSnippetModal');
    }
  }

  async _applyFileColor(fsPath, treePath, colorName)
  {
    const res = await apiCall(this.app.currentDataPath, 'setFileColor', { filePath: fsPath, color: colorName });
    if( ! (res && res.success) ) {
      showError('Failed to set file color');
      return;
    }
    const node = this.findNodeInTree(this.app.fileTree, treePath);
    if( node ) {
      node.colorName = colorName || null;
      const palette  = this._folderColors || {};
      node.color     = colorName ? (palette[colorName] || null) : null;
    }
    this.renderTree();
  }

  async _applyFolderColor(path, colorName)
  {
    const res = await apiCall(this.app.currentDataPath, 'setFolderColor', { folderPath: path, color: colorName });
    if( ! (res && res.success) ) {
      showError('Failed to set folder color');
      return;
    }
    // Update tree node in memory so re-render is instant
    const node = this.findNodeInTree(this.app.fileTree, path);
    if( node ) {
      node.colorName = colorName || null;
      const palette  = this._folderColors || {};
      node.color     = colorName ? (palette[colorName] || null) : null;
    }
    this.renderTree();
  }

  handleFileClick(e)
  {
    const treeItem = e.target.closest('.tree-item');
    const fileItem = e.target.closest('.file-item');
    const item = treeItem || fileItem;
    if( ! item ) return;

    const { path, type } = item.dataset;
    const fsPath = item.dataset.fspath || path;

    if( type === 'folder' ) {
      if( treeItem ) this.toggleFolder(path);
      return;
    }

    document.querySelectorAll('.tree-item.active, .file-item.active').forEach(i => i.classList.remove('active'));
    item.classList.add('active');

    const parts = fsPath.split('/');
    parts.pop();
    this.app.currentPath = parts.join('/');

    this.app.editor.loadSnippet(fsPath);

    // Auto-close sidebar on mobile
    if( window.innerWidth < 992 ) {
      const sidebar = document.getElementById('sidebarNav');
      const offcanvas = bootstrap.Offcanvas.getInstance(sidebar);
      if( offcanvas ) offcanvas.hide();
    }
  }

  fileListKeyDown(e)
  {
    if( ! ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter',' '].includes(e.key) ) return;

    const active = document.activeElement;
    const current = active?.classList?.contains('tree-item')
      ? active
      : this.app._focusedTreeItem || null;

    const trackedPath = current?.dataset?.path;
    if( ! trackedPath ) return;

    const items = Array.from(document.querySelectorAll('#fileList .tree-item'));
    if( ! items.length ) return;

    const liveItem = items.find(i => i.dataset.path === trackedPath) || null;
    if( ! liveItem ) return;
    const idx = items.indexOf(liveItem);

    if( e.key === 'ArrowDown' ) {
      e.preventDefault();
      const next = idx < items.length - 1 ? items[idx + 1] : items[0];
      this.app._focusedTreeItem = next;
      next.focus();
    }
    else if( e.key === 'ArrowUp' ) {
      e.preventDefault();
      const prev = idx > 0 ? items[idx - 1] : items[items.length - 1];
      this.app._focusedTreeItem = prev;
      prev.focus();
    }
    else if( e.key === 'ArrowRight' ) {
      e.preventDefault();
      if( liveItem.dataset.type === 'folder' ) {
        const node = this.findNodeInTree(this.app.fileTree, trackedPath);
        if( node && ! node.isOpen ) this.toggleFolder(trackedPath).then(() => {
          const el = document.querySelector(`.tree-item[data-path="${trackedPath}"]`);
          if( el ) { this.app._focusedTreeItem = el; el.focus(); }
        });
      }
    }
    else if( e.key === 'ArrowLeft' ) {
      e.preventDefault();
      if( liveItem.dataset.type === 'folder' ) {
        const node = this.findNodeInTree(this.app.fileTree, trackedPath);
        if( node && node.isOpen ) this.toggleFolder(trackedPath).then(() => {
          const el = document.querySelector(`.tree-item[data-path="${trackedPath}"]`);
          if( el ) { this.app._focusedTreeItem = el; el.focus(); }
        });
      }
      else {
        const parts = trackedPath.split('/');
        parts.pop();
        const parentPath = parts.join('/');
        if( parentPath ) {
          const parent = document.querySelector(`.tree-item[data-path="${parentPath}"]`);
          if( parent ) { this.app._focusedTreeItem = parent; parent.focus(); }
        }
      }
    }
    else if( e.key === 'Enter' || e.key === ' ' ) {
      e.preventDefault();
      liveItem.click();
    }
  }
}
