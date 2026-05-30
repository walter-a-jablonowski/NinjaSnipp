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
    const themeMode = document.documentElement.getAttribute('data-theme') || 'light';
    const res = await apiCall(this.app.currentDataPath, 'getFolderColors', { themeMode });
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
      basePath: file.basePath || null,
      mergedBases: file.mergedBases || null,
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

  _getSourceLabel(basePath)
  {
    if( ! basePath ) return null;
    const labels = this.app.baseFolderLabels || {};
    return labels[basePath] || null;
  }

  // Strips a leading two-digit ordinal prefix (e.g. "11 Common" -> "Common") for display only.
  // The real name (with prefix) is kept in path/fsPath so server-side sorting is unaffected.
  _displayName(name)
  {
    return name.replace(/^\d{2}[ _.\-]+/, '');
  }

  renderTreeNode(node)
  {
    const { type, _depth, path, fsPath, name, isOpen, extension, isIncluded, color, colorName, basePath, mergedBases } = node;
    const isFolder   = type === 'folder';
    const isMerged   = isFolder && mergedBases && mergedBases.length > 1;
    const indentPx   = 6 + _depth * 14;
    const realFsPath = fsPath || path;
    const displayName = this._displayName(name);

    const icon = isFolder
      ? (isMerged ? (isOpen ? 'bi-folder-symlink' : 'bi-folder-symlink') : (isOpen ? 'bi-folder2-open' : 'bi-folder'))
      : (extension === 'yml' ? 'bi-file-code' : 'bi-file-text-fill');

    const toggleEl = isFolder
      ? `<i class="bi ${isOpen ? 'bi-chevron-down' : 'bi-chevron-right'} tree-toggle"></i>`
      : `<span class="tree-toggle-spacer"></span>`;

    const includedIcon = isIncluded
      ? '<i class="bi bi-link-45deg text-primary ms-1" title="Included"></i>'
      : '';

    const palette = this._folderColors || {};
    const effectiveColor = colorName && palette[colorName] ? palette[colorName] : color;
    const styleVal = effectiveColor
      ? `padding-left: ${indentPx}px; background-color: ${effectiveColor};`
      : `padding-left: ${indentPx}px;`;

    const colorSwatches = ! isIncluded
      ? this._buildColorSwatchesHtml(colorName)
      : '';

    let sourceLabelHtml = '';
    if( ! isIncluded ) {
      if( isMerged ) {
        const labels = mergedBases.map(base => {
          const label = (this.app.baseFolderLabels || {})[base] || base.split('/').pop();
          return `<i class="bi bi-folder2 me-1"></i>${label}`;
        }).join('&nbsp;&amp;&nbsp;');
        sourceLabelHtml = `<li><span class="dropdown-item small text-muted pe-none source-label">${labels}</span></li>
           <li><hr class="dropdown-divider"></li>`;
      }
      else {
        const sourceLabel = this._getSourceLabel(basePath);
        if( sourceLabel )
          sourceLabelHtml = `<li><span class="dropdown-item small text-muted pe-none source-label"><i class="bi bi-folder2 me-1"></i>${sourceLabel}</span></li>
             <li><hr class="dropdown-divider"></li>`;
      }
    }

    let explorerItem = '';
    if( typeof APP_SPECIAL !== 'undefined' && APP_SPECIAL ) {
      if( isMerged ) {
        explorerItem = `<li><span class="dropdown-item small text-muted pe-none">Open in Explorer</span></li>` +
          mergedBases.map(base => {
            const label = (this.app.baseFolderLabels || {})[base] || base.split('/').pop();
            return `<li><a class="dropdown-item small ps-4" href="#" data-action="open-in-explorer" data-base-path="${base}">${label}</a></li>`;
          }).join('');
      }
      else {
        explorerItem = `<li><a class="dropdown-item small" href="#" data-action="open-in-explorer">Open in Explorer</a></li>`;
      }
    }

    const mergedBasesAttr = isMerged ? ` data-merged-bases='${JSON.stringify(mergedBases)}'` : '';

    let menuItems;
    if( isIncluded ) {
      menuItems = isFolder
        ? `<li><a class="dropdown-item small" href="#" data-action="new-snippet">New Snippet</a></li>
           <li><a class="dropdown-item small" href="#" data-action="new-folder">New Folder</a></li>
           ${explorerItem ? explorerItem : ''}`
        : `<li><span class="dropdown-item small text-muted disabled">Included file</span></li>
           ${explorerItem}`;
    }
    else {
      menuItems = isFolder
        ? `${sourceLabelHtml}
           <li><a class="dropdown-item small" href="#" data-action="new-snippet">New Snippet</a></li>
           <li><a class="dropdown-item small" href="#" data-action="new-folder">New Folder</a></li>
           <li><hr class="dropdown-divider"></li>
           ${colorSwatches}
           <li><hr class="dropdown-divider"></li>
           <li><a class="dropdown-item small" href="#" data-action="rename">Rename</a></li>
           ${explorerItem ? explorerItem : ''}
           <li><hr class="dropdown-divider"></li>
           <li><a class="dropdown-item small text-danger" href="#" data-action="delete">Delete</a></li>`
        : `${sourceLabelHtml}
           ${colorSwatches}
           <li><hr class="dropdown-divider"></li>
           <li><a class="dropdown-item small" href="#" data-action="rename">Rename</a></li>
           ${explorerItem ? explorerItem + '<li><hr class="dropdown-divider"></li>' : ''}
           <li><a class="dropdown-item small text-danger" href="#" data-action="delete">Delete</a></li>`;
    }

    return `<div class="tree-item${isFolder ? ' tree-folder' : ' tree-file'}${isIncluded ? ' tree-included' : ''}${isMerged ? ' tree-merged' : ''}" ` +
      `data-path="${path}" data-fspath="${realFsPath}" data-type="${type}" data-extension="${extension || ''}"${mergedBasesAttr} ` +
      `draggable="${isIncluded ? 'false' : 'true'}" ` +
      `tabindex="0" title="${displayName}" style="${styleVal}">` +
      `<div class="d-flex align-items-center">` +
        toggleEl +
        `<i class="bi ${icon} file-icon"></i>` +
        `<span class="tree-name flex-grow-1">${displayName}${includedIcon}</span>` +
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

  _getMergedBases(item)
  {
    const raw = item.getAttribute('data-merged-bases');
    if( ! raw ) return null;
    try { return JSON.parse(raw); } catch(e) { return null; }
  }

  handleFileListDropdownClick(e)
  {
    const actionEl = e.target.closest('[data-action]');
    if( ! actionEl ) return;
    const action = actionEl.getAttribute('data-action');
    const item   = actionEl.closest('.tree-item');
    if( ! item ) return;
    const path        = item.getAttribute('data-path');
    const fsPath      = item.getAttribute('data-fspath') || path;
    const type        = item.getAttribute('data-type');
    const ext         = item.getAttribute('data-extension') || '';
    const mergedBases = this._getMergedBases(item);

    if( action === 'rename' ) {
      const parts    = path.split('/');
      const filename = parts.pop();
      const parent   = parts.join('/');
      let base = filename;
      if( type === 'file' && ext ) {
        const dExt = '.' + ext;
        if( base.toLowerCase().endsWith(dExt) ) base = base.slice(0, -dExt.length);
      }
      this.app._renameContext = { oldPath: path, parent, type, ext, mergedBases };
      const input = document.getElementById('renameNameInput');
      if( input ) input.value = base;
      showModal('renameItemModal');
    }
    else if( action === 'set-color' ) {
      e.stopPropagation();
      const color = actionEl.getAttribute('data-color') || null;
      const dropdownEl = item.querySelector('.tree-menu-btn');
      if( dropdownEl ) {
        const dd = bootstrap.Dropdown.getInstance(dropdownEl);
        if( dd ) dd.hide();
      }
      if( type === 'folder' ) {
        if( mergedBases && mergedBases.length > 1 ) {
          Promise.all(mergedBases.map(base =>
            apiCall(this.app.currentDataPath, 'setFolderColor', { folderPath: path, color: color || null, targetBase: base })
          )).then(() => {
            const node = this.findNodeInTree(this.app.fileTree, path);
            if( node ) {
              node.colorName = color || null;
              const palette = this._folderColors || {};
              node.color = color ? (palette[color] || null) : null;
            }
            this.renderTree();
          });
        }
        else {
          this._applyFolderColor(path, color || null);
        }
      }
      else {
        this._applyFileColor(fsPath, path, color || null);
      }
    }
    else if( action === 'new-snippet' ) {
      this.app.currentPath        = fsPath;
      this.app.currentMergedBases = mergedBases || null;
      if( fsPath ) this.app.expandedFolders.add(path);
      showModal('newSnippetModal');
    }
    else if( action === 'new-folder' ) {
      this.app.currentPath        = fsPath;
      this.app.currentMergedBases = mergedBases || null;
      if( fsPath ) this.app.expandedFolders.add(path);
      showModal('newFolderModal');
    }
    else if( action === 'delete' ) {
      const nameParts = path.split('/');
      const fullName  = nameParts.pop();
      const baseName  = ext ? fullName.replace(new RegExp('\\.' + ext + '$', 'i'), '') : fullName;
      this.app._deleteContext = { path, name: baseName, type, mergedBases };
      const nameEl = document.getElementById('deleteSnippetName');
      if( nameEl ) nameEl.textContent = baseName;
      showModal('deleteSnippetModal');
    }
    else if( action === 'open-in-explorer' ) {
      const basePath = actionEl.getAttribute('data-base-path');
      const payload  = { path: fsPath, itemType: type };
      if( basePath ) payload.fullPath = basePath + '/' + fsPath;
      apiCall(this.app.currentDataPath, 'openInExplorer', payload);
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

  // --- Drag & drop reordering (same level only) ---

  _parentPathOf(path)
  {
    const parts = path.split('/');
    parts.pop();
    return parts.join('/');
  }

  // Returns the sibling node array for a given parent path ('' = root level)
  _siblingsOf(parentPath)
  {
    if( ! parentPath ) return this.app.fileTree;
    const parent = this.findNodeInTree(this.app.fileTree, parentPath);
    return parent && parent.children ? parent.children : null;
  }

  _clearDropMarkers()
  {
    document.querySelectorAll('.tree-item.drag-over-top, .tree-item.drag-over-bottom')
      .forEach(el => el.classList.remove('drag-over-top', 'drag-over-bottom'));
  }

  handleDragStart(e)
  {
    const item = e.target.closest('.tree-item');
    if( ! item || item.getAttribute('draggable') !== 'true' ) return;
    this._dragPath = item.dataset.path;
    item.classList.add('dragging');
    if( e.dataTransfer ) {
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', this._dragPath); } catch(_) {}
    }
  }

  handleDragOver(e)
  {
    if( ! this._dragPath ) return;
    const item = e.target.closest('.tree-item');
    if( ! item || item.dataset.path === this._dragPath ) return;

    // Only allow reordering within the same parent level
    if( this._parentPathOf(item.dataset.path) !== this._parentPathOf(this._dragPath) ) {
      if( e.dataTransfer ) e.dataTransfer.dropEffect = 'none';
      this._clearDropMarkers();
      this._dropTarget = null;
      return;
    }

    e.preventDefault();
    if( e.dataTransfer ) e.dataTransfer.dropEffect = 'move';

    const rect   = item.getBoundingClientRect();
    const after  = e.clientY > rect.top + rect.height / 2;
    this._clearDropMarkers();
    item.classList.add(after ? 'drag-over-bottom' : 'drag-over-top');
    this._dropTarget = { path: item.dataset.path, position: after ? 'after' : 'before' };
  }

  handleDragLeave(e)
  {
    const item = e.target.closest('.tree-item');
    if( item ) item.classList.remove('drag-over-top', 'drag-over-bottom');
  }

  handleDragEnd()
  {
    this._clearDropMarkers();
    document.querySelectorAll('.tree-item.dragging').forEach(el => el.classList.remove('dragging'));
    this._dragPath   = null;
    this._dropTarget = null;
  }

  async handleDrop(e)
  {
    const dragPath = this._dragPath;
    const target   = this._dropTarget;
    this._clearDropMarkers();
    if( ! dragPath || ! target || dragPath === target.path ) { this.handleDragEnd(); return; }

    const parentPath = this._parentPathOf(dragPath);
    if( parentPath !== this._parentPathOf(target.path) ) { this.handleDragEnd(); return; }
    e.preventDefault();

    await this._applyReorder(parentPath, dragPath, target.path, target.position);
    this.handleDragEnd();
  }

  // Computes the new sibling order, renumbers ordinal prefixes, and persists via batchRename.
  // Only items that already have a 2-digit prefix (or the dragged item) get renamed; unprefixed
  // bystanders are left untouched (they sort after the numbered ones).
  async _applyReorder(parentPath, draggedPath, targetPath, position)
  {
    const siblings = this._siblingsOf(parentPath);
    if( ! siblings ) return;

    const dragged = siblings.find(n => n.path === draggedPath);
    if( ! dragged || dragged.isIncluded ) return;

    const order = siblings.filter(n => n.path !== draggedPath);
    const ti    = order.findIndex(n => n.path === targetPath);
    const insertAt = ti < 0 ? order.length : (position === 'after' ? ti + 1 : ti);
    order.splice(insertAt, 0, dragged);

    const prefixRe   = /^\d{2}[ _.\-]/;
    const stripRe    = /^\d{2}[ _.\-]+/;
    const fsNameOf   = n => n.type === 'folder' ? n.name : `${n.name}.${n.extension}`;

    const ops            = [];
    const folderRenames  = {};   // oldVirtual -> newVirtual (for expanded-folder/current-path remap)
    let   draggedNewPath = null;

    order.forEach((node, i) => {
      if( node.isIncluded ) return;
      const fsName = fsNameOf(node);
      if( ! prefixRe.test(fsName) && node !== dragged ) return;   // leave unprefixed bystanders

      const prefix    = String(i + 1).padStart(2, '0');
      const baseName  = fsName.replace(stripRe, '');
      const newFsName = `${prefix} ${baseName}`;

      // newFsName is the on-disk name and also the last segment of the virtual path
      // (file paths include the extension, folder paths don't)
      const newVirtual = (parentPath ? parentPath + '/' : '') + newFsName;
      if( node === dragged ) draggedNewPath = newVirtual;

      if( newFsName === fsName ) return;

      const bases = (node.type === 'folder' && node.mergedBases && node.mergedBases.length)
        ? node.mergedBases
        : [node.basePath];

      bases.forEach(b => { if( b ) ops.push({ base: b, oldName: fsName, newName: newFsName, type: node.type }); });

      if( node.type === 'folder' ) {
        const oldVirtual = (parentPath ? parentPath + '/' : '') + node.name;
        folderRenames[oldVirtual] = (parentPath ? parentPath + '/' : '') + newFsName;
      }
    });

    if( ! ops.length ) return;

    const res = await apiCall(this.app.currentDataPath, 'batchRename', { subPath: parentPath, ops });
    if( ! (res && res.success) ) {
      showError('Failed to reorder: ' + (res?.message || 'Unknown error'));
      return;
    }

    // Keep expansion + selection sensible after on-disk names changed
    this._remapPaths(folderRenames);
    if( parentPath ) this.app.expandedFolders.add(parentPath);
    await this.app.loadFiles();

    if( dragged.type === 'file' && draggedNewPath ) {
      const el = document.querySelector(`.tree-item[data-path="${draggedNewPath}"]`);
      if( el ) {
        document.querySelectorAll('.tree-item.active, .file-item.active').forEach(n => n.classList.remove('active'));
        el.classList.add('active');
      }
    }
  }

  // Rewrites stored virtual paths (expanded folders + current path) after folders were renumbered
  _remapPaths(folderRenames)
  {
    const keys = Object.keys(folderRenames);
    if( ! keys.length ) return;

    const remap = (p) => {
      for( const oldV of keys ) {
        if( p === oldV ) return folderRenames[oldV];
        if( p.startsWith(oldV + '/') ) return folderRenames[oldV] + p.slice(oldV.length);
      }
      return p;
    };

    const next = new Set();
    this.app.expandedFolders.forEach(p => next.add(remap(p)));
    this.app.expandedFolders = next;

    if( this.app.currentPath ) this.app.currentPath = remap(this.app.currentPath);
  }
}
