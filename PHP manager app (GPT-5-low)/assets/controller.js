(() => {
  const state = {
    dataPaths: window.__DATA_PATHS__ || ['data'],
    currentDataPath: window.__CURRENT_PATH__ || 'data',
    currentDir: '', // relative within current data path
    currentFile: null, // { path, type }
    currentSnippet: null
  };

  const els = {
    dataPathSelect: document.getElementById('dataPathSelect'),
    fileBreadcrumb: document.getElementById('fileBreadcrumb'),
    fileList: document.getElementById('fileList'),
    recentList: document.getElementById('recentList'),
    resultsList: document.getElementById('resultsList'),
    searchInput: document.getElementById('searchInput'),
    searchBtn: document.getElementById('searchBtn'),

    // right side
    currentFileLabel: document.getElementById('currentFileLabel'),
    renderedContent: document.getElementById('renderedContent'),
    copyBtn: document.getElementById('copyBtn'),

    // form
    filePath: document.getElementById('filePath'),
    fileType: document.getElementById('fileType'),
    ymlFields: document.getElementById('ymlFields'),
    mdFields: document.getElementById('mdFields'),
    snippetNameEdit: document.getElementById('snippetNameEdit'),
    snippetSh: document.getElementById('snippetSh'),
    snippetUsage: document.getElementById('snippetUsage'),
    snippetContent: document.getElementById('snippetContent'),
    mdFileName: document.getElementById('mdFileName'),
    mdContent: document.getElementById('mdContent'),

    // actions
    newSnippetBtn: document.getElementById('newSnippetBtn'),
    newNoteBtn: document.getElementById('newNoteBtn'),
    saveBtn: document.getElementById('saveSnippetBtn'),
    duplicateBtn: document.getElementById('duplicateSnippetBtn'),
    deleteBtn: document.getElementById('deleteSnippetBtn')
  };

  function api(action, body = {}) {
    return fetch('ajax.php?action=' + encodeURIComponent(action), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(r => r.json()).then(j => {
      if (!j.ok && j.error) throw new Error(j.error);
      return j;
    });
  }

  // Init
  function init() {
    // fill data path select
    els.dataPathSelect.innerHTML = '';
    state.dataPaths.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p; opt.textContent = p;
      if (p === state.currentDataPath) opt.selected = true;
      els.dataPathSelect.appendChild(opt);
    });
    els.dataPathSelect.addEventListener('change', () => {
      state.currentDataPath = els.dataPathSelect.value;
      state.currentDir = '';
      loadDir();
      loadRecent();
    });

    els.newSnippetBtn.addEventListener('click', () => newSnippet());
    els.newNoteBtn.addEventListener('click', () => newNote());
    els.saveBtn.addEventListener('click', () => saveCurrent());
    els.duplicateBtn.addEventListener('click', () => duplicateCurrent());
    els.deleteBtn.addEventListener('click', () => deleteCurrent());

    els.searchBtn.addEventListener('click', doSearch);
    els.searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

    els.copyBtn.addEventListener('click', copyRendered);

    loadDir();
    loadRecent();
  }

  function breadcrumb() {
    const parts = state.currentDir ? state.currentDir.split('/') : [];
    const items = ['<a href="#" data-idx="-1">/</a>'];
    let path = '';
    parts.forEach((p, idx) => {
      path = path ? (path + '/' + p) : p;
      items.push(`<a href="#" data-idx="${idx}">${p}</a>`);
    });
    els.fileBreadcrumb.innerHTML = items.join(' / ');
    els.fileBreadcrumb.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        const idx = parseInt(a.dataset.idx, 10);
        if (idx < 0) state.currentDir = '';
        else state.currentDir = parts.slice(0, idx + 1).join('/');
        loadDir();
      });
    });
  }

  function loadDir() {
    breadcrumb();
    api('list', { dataPath: state.currentDataPath, sub: state.currentDir }).then(j => {
      renderFileList(j);
    }).catch(err => alert(err.message));
  }

  function renderFileList(data) {
    els.fileList.innerHTML = '';

    // folders first
    (data.folders || []).forEach(f => {
      const a = document.createElement('a');
      a.href = '#';
      a.className = 'list-group-item list-group-item-action d-flex justify-content-between align-items-center';
      a.innerHTML = `<span>📁 ${f.name}</span><span class="small text-muted">open</span>`;
      a.addEventListener('click', e => { e.preventDefault(); state.currentDir = f.path; loadDir(); });
      els.fileList.appendChild(a);
    });

    (data.files || []).forEach(f => {
      const a = document.createElement('a');
      a.href = '#';
      a.className = 'list-group-item list-group-item-action';
      a.textContent = f.name;
      a.addEventListener('click', e => { e.preventDefault(); openFile(f.path); });
      els.fileList.appendChild(a);
    });
  }

  function loadRecent() {
    api('recent', { dataPath: state.currentDataPath }).then(j => {
      els.recentList.innerHTML = '';
      (j.items || []).forEach(it => {
        const a = document.createElement('a');
        a.href = '#'; a.className = 'list-group-item list-group-item-action';
        a.textContent = it.file + (it.dataPath && it.dataPath !== state.currentDataPath ? ` (${it.dataPath})` : '');
        a.addEventListener('click', e => { e.preventDefault(); state.currentDataPath = it.dataPath || state.currentDataPath; selectDataPath(state.currentDataPath); openFile(it.file); });
        els.recentList.appendChild(a);
      });
    }).catch(() => {});
  }

  function selectDataPath(p) {
    Array.from(els.dataPathSelect.options).forEach(opt => { opt.selected = (opt.value === p); });
  }

  function openFile(relPath) {
    api('read', { dataPath: state.currentDataPath, file: relPath }).then(j => {
      state.currentFile = { path: j.file, type: j.type };
      els.currentFileLabel.textContent = `${state.currentDataPath}/${j.file}`;
      els.filePath.value = j.file;
      els.fileType.value = j.type;

      if (j.type === 'md') {
        els.ymlFields.classList.add('d-none');
        els.mdFields.classList.remove('d-none');
        els.mdFileName.value = j.file;
        els.mdContent.value = j.content || '';
      } else {
        els.mdFields.classList.add('d-none');
        els.ymlFields.classList.remove('d-none');
        els.snippetNameEdit.value = j.name || '';
        els.snippetSh.value = j.sh || '';
        els.snippetUsage.value = j.usage || '';
        els.snippetContent.value = j.content || '';
      }

      renderCurrent();

      // switch to edit tab
      const tab = new bootstrap.Tab(document.getElementById('edit-tab'));
      tab.show();
    }).catch(err => alert(err.message));
  }

  function renderCurrent() {
    if (!state.currentFile) { els.renderedContent.innerHTML = ''; return; }
    const payload = { dataPath: state.currentDataPath };
    if (els.fileType.value === 'md') {
      payload.snippet = { type: 'md', content: els.mdContent.value || '' };
    } else {
      payload.snippet = {
        type: 'yml',
        content: els.snippetContent.value || ''
      };
    }
    api('render', payload).then(j => {
      els.renderedContent.innerHTML = j.html || '';
      wirePlaceholders();
    }).catch(() => {});
  }

  function wirePlaceholders() {
    els.renderedContent.querySelectorAll('.ph').forEach(el => {
      el.addEventListener('keydown', e => {
        if (e.key === 'Tab') { e.preventDefault(); // accept default
          const next = el.nextElementSibling || els.renderedContent.querySelector('.ph');
          if (next) next.focus();
        }
      });
    });
  }

  function saveCurrent() {
    if (!els.fileType.value) return;

    if (els.fileType.value === 'md') {
      api('save', {
        dataPath: state.currentDataPath,
        type: 'md',
        file: els.filePath.value,
        name: els.mdFileName.value.replace(/\.md$/i, ''),
        content: els.mdContent.value
      }).then(j => {
        openFile(j.file);
        loadDir();
      }).catch(err => alert(err.message));
      return;
    }

    api('save', {
      dataPath: state.currentDataPath,
      type: 'yml',
      file: els.filePath.value,
      name: els.snippetNameEdit.value,
      sh: els.snippetSh.value,
      usage: els.snippetUsage.value,
      content: els.snippetContent.value
    }).then(j => {
      openFile(j.file);
      loadDir();
    }).catch(err => alert(err.message));
  }

  function newSnippet() {
    state.currentFile = { path: '', type: 'yml' };
    els.currentFileLabel.textContent = 'New snippet';
    els.filePath.value = '';
    els.fileType.value = 'yml';
    els.snippetNameEdit.value = '';
    els.snippetSh.value = '';
    els.snippetUsage.value = '';
    els.snippetContent.value = '';

    els.mdFields.classList.add('d-none');
    els.ymlFields.classList.remove('d-none');

    const tab = new bootstrap.Tab(document.getElementById('edit-tab'));
    tab.show();
    renderCurrent();
  }

  function newNote() {
    state.currentFile = { path: '', type: 'md' };
    els.currentFileLabel.textContent = 'New note';
    els.filePath.value = '';
    els.fileType.value = 'md';
    els.mdFileName.value = 'note.md';
    els.mdContent.value = '';

    els.ymlFields.classList.add('d-none');
    els.mdFields.classList.remove('d-none');

    const tab = new bootstrap.Tab(document.getElementById('edit-tab'));
    tab.show();
    renderCurrent();
  }

  function duplicateCurrent() {
    if (!state.currentFile || !state.currentFile.path) return;
    api('duplicate', { dataPath: state.currentDataPath, file: state.currentFile.path }).then(j => {
      openFile(j.file);
      loadDir();
    }).catch(err => alert(err.message));
  }

  function deleteCurrent() {
    if (!state.currentFile || !state.currentFile.path) return;
    if (!confirm('Delete this file?')) return;
    api('delete', { dataPath: state.currentDataPath, file: state.currentFile.path }).then(() => {
      state.currentFile = null;
      els.currentFileLabel.textContent = 'No file loaded';
      els.renderedContent.innerHTML = '';
      els.filePath.value = '';
      loadDir();
    }).catch(err => alert(err.message));
  }

  function doSearch() {
    const q = (els.searchInput.value || '').trim();
    if (!q) return;
    api('search', { dataPath: state.currentDataPath, q }).then(j => {
      els.resultsList.innerHTML = '';
      (j.items || []).forEach(it => {
        const a = document.createElement('a');
        a.href = '#'; a.className = 'list-group-item list-group-item-action';
        a.textContent = `${it.name} — ${it.path}`;
        a.addEventListener('click', e => { e.preventDefault(); openFile(it.path); });
        els.resultsList.appendChild(a);
      });
      const tab = new bootstrap.Tab(document.getElementById('results-tab'));
      tab.show();
    }).catch(err => alert(err.message));
  }

  function copyRendered() {
    const text = els.renderedContent.innerText;
    navigator.clipboard.writeText(text).then(() => {
      els.copyBtn.textContent = 'Copied!';
      setTimeout(() => els.copyBtn.textContent = 'Copy', 1200);
    });
  }

  // re-render on edit changes
  ['input', 'change', 'keyup'].forEach(ev => {
    ['snippetContent', 'mdContent'].forEach(id => {
      const el = els[id]; if (!el) return;
      el.addEventListener(ev, () => {
        if (state.currentFile) renderCurrent();
      });
    });
  });

  document.addEventListener('DOMContentLoaded', init);
})();
