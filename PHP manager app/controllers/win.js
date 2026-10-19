// The Win app's popup (win.php): picks a snippet, fills it in, and hands the text to the Win app,
// which inserts it where the user was typing. Messages through window.chrome.webview:
//
//   from the Win app   {action: 'pick', sc?}         the picker; with sc only the snippets that have it
//                                                    (a typed shortcut several snippets have)
//                      {action: 'fill', snippet}     the fill view for an entry of winSnippets
//   to the Win app     {action: 'insert', text}
//                      {action: 'cancel'}
//
// In a normal browser there is no Win app: the picker shows at start and the text is copied.

class WinController
{
  constructor()
  {
    this.host       = window.chrome?.webview ?? null;
    this.snippets   = [];      // entries of winSnippets (SnippetIndex)
    this.stamp      = null;    // of the snippets we have, the server only sends them again when changed
    this.rows       = [];      // the entries the picker shows
    this.selected   = 0;       // index in rows
    this.scFilter   = null;    // the picker shows only the snippets with this sc
    this.fromPicker = false;   // the fill view was opened from the picker (Back goes there)
    this.edited     = false;   // the result was edited by hand

    this.el = {};
    ['pickView', 'pickFilter', 'pickDataSet', 'pickNote', 'pickList', 'fillView', 'fillBack', 'fillName', 'fillSc',
     'fillDataSet', 'fillShort', 'fillTabs', 'renderUsage', 'fillEdited', 'fillReset', 'fillText', 'fillCancel',
     'fillInsert', 'phChoiceMenu'].forEach(id => this.el[id] = document.getElementById(id));

    this.form = new SnippetForm({
      inline:   document.getElementById('inlineSnippet'),
      usage:    this.el.renderUsage,
      menu:     this.el.phChoiceMenu,
      onChange: text => {
        if( ! this.edited ) this.el.fillText.value = text;
      }
    });

    // The data set filter is a convenience of this viewer only
    try {
      const dataSet = localStorage.getItem('ninjaWin.dataSet') || '';
      if( [...this.el.pickDataSet.options].some(option => option.value === dataSet) )
        this.el.pickDataSet.value = dataSet;
    }
    catch( e ) {
      // no storage, all data sets
    }

    this.el.fillInsert.textContent = this.host ? 'Insert' : 'Copy';
    this.bindEvents();

    if( this.host )
      this.host.addEventListener('message', e => this.onHostMessage(e.data));
    else
      this.pick();
  }

  bindEvents()
  {
    this.el.pickFilter.addEventListener('input', () => {
      this.selected = 0;
      this.renderList();
    });

    this.el.pickDataSet.addEventListener('change', () => {
      try {
        localStorage.setItem('ninjaWin.dataSet', this.el.pickDataSet.value);
      }
      catch( e ) {
        // not remembered
      }
      this.selected = 0;
      this.renderList();
      this.el.pickFilter.focus();
    });

    this.el.pickFilter.addEventListener('keydown', e => {
      if( e.key === 'ArrowDown' || e.key === 'ArrowUp' ) {
        e.preventDefault();
        this.select( this.selected + (e.key === 'ArrowDown' ? 1 : -1));
      }
      else if( e.key === 'Enter' ) {
        e.preventDefault();
        if( this.rows[this.selected] ) this.choose(this.rows[this.selected]);
      }
    });

    this.el.pickList.addEventListener('click', e => {
      const row = e.target.closest('.win-row');
      if( row ) this.choose( this.rows[Number(row.dataset.idx)]);
    });

    this.el.fillTabs.addEventListener('click', e => {
      const tab = e.target.closest('[data-tab]');
      if( tab ) this.showTab(tab.dataset.tab);
    });

    this.el.fillBack.addEventListener('click', () => this.pick(this.scFilter));
    this.el.fillCancel.addEventListener('click', () => this.cancel());
    this.el.fillInsert.addEventListener('click', () => this.insert(this.el.fillText.value));

    this.el.fillText.addEventListener('input', () => this.setEdited(true));
    this.el.fillReset.addEventListener('click', e => {
      e.preventDefault();
      this.setEdited(false);
    });

    document.addEventListener('keydown', e => {
      if( e.key === 'Escape' ) {
        e.preventDefault();
        if( this.el.phChoiceMenu.classList.contains('show') )
          this.form.closeChoiceMenu();
        else
          this.cancel();
      }
      else if( e.key === 'Enter' && e.ctrlKey && ! this.el.fillView.hidden ) {
        e.preventDefault();
        this.insert(this.el.fillText.value);
      }
    });
  }

  onHostMessage(message)
  {
    if( message?.action === 'pick' )
      this.pick(message.sc || null);
    else if( message?.action === 'fill' && message.snippet )
      this.fill(message.snippet);
  }

  show(view)
  {
    this.form.closeChoiceMenu();
    this.el.pickView.hidden = view !== 'pick';
    this.el.fillView.hidden = view !== 'fill';
  }

  // --- Picker ---

  async pick( sc = null )
  {
    this.scFilter = sc;
    this.selected = 0;
    this.el.pickFilter.value = '';
    this.el.pickDataSet.disabled = sc !== null;   // the snippets with the sc in any data set
    this.el.pickNote.hidden = sc === null;
    this.el.pickNote.textContent = sc !== null ? `Several snippets have the shortcut ${sc}` : '';

    this.show('pick');
    this.el.pickFilter.focus();

    await this.loadSnippets();
    this.renderList();
  }

  async loadSnippets()
  {
    const result = await apiCall('', 'winSnippets', { stamp: this.stamp });
    if( ! result.success ) {
      showError(result.message || 'Snippets could not be loaded');
      return;
    }
    if( result.unchanged ) return;

    // The data sets in the select come with the page: reload it when they changed
    const rendered = [...this.el.pickDataSet.options].map(option => option.value).filter(value => value !== '');
    if( rendered.join('\n') !== result.dataSets.join('\n') ) {
      location.reload();
      return;
    }

    this.snippets = result.snippets;
    this.stamp    = result.stamp;
  }

  // The entries for the filter: every word must be in the name, folder, sc or short;
  // sc and name matches first (like Search::score in the manager)
  filtered()
  {
    const dataSet = this.el.pickDataSet.value;
    const query   = this.el.pickFilter.value.trim().toLowerCase();
    const words   = query.split(/\s+/).filter(Boolean);

    const score = (entry) => {
      const sc   = entry.sc.toLowerCase();
      const name = entry.name.toLowerCase();
      return (sc === query ? 100 : sc.startsWith(query) ? 50 : 0)
           + (name === query ? 80 : name.startsWith(query) ? 40 : name.includes(query) ? 20 : 0);
    };

    return this.snippets
      .filter(entry => this.scFilter !== null ? entry.sc === this.scFilter : ( ! dataSet || entry.dataSets.includes(dataSet)))
      .filter(entry => {
        const text = `${entry.name} ${entry.folder} ${entry.sc} ${entry.short}`.toLowerCase();
        return words.every(word => text.includes(word));
      })
      .map(entry => ({ entry, score: query ? score(entry) : 0 }))
      .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
      .map(item => item.entry);
  }

  renderList()
  {
    this.rows = this.filtered();
    this.selected = Math.min(this.selected, Math.max(this.rows.length - 1, 0));

    // Data set chips only where they tell something
    const chips = this.scFilter !== null || (this.el.pickDataSet.value === '' && this.el.pickDataSet.options.length > 2);

    this.el.pickList.innerHTML = this.rows.length === 0
      ? '<div class="win-empty">No snippets found</div>'
      : this.rows.map((entry, idx) => `
        <div class="win-row${idx === this.selected ? ' active' : ''}" role="option" data-idx="${idx}" aria-selected="${idx === this.selected}">
          <div class="win-row-main">
            <span class="win-row-name">${escapeHtml(entry.name)}</span>
            ${entry.sc ? `<code class="win-row-sc">${escapeHtml(entry.sc)}</code>` : ''}
            ${entry.form ? '<i class="bi bi-input-cursor-text win-row-form" title="Has a form"></i>' : ''}
            ${chips ? entry.dataSets.map(label => `<span class="win-chip">${escapeHtml(label)}</span>`).join('') : ''}
          </div>
          <div class="win-row-sub">${escapeHtml([entry.folder, entry.short].filter(Boolean).join(' · '))}</div>
        </div>`).join('');
  }

  select(idx)
  {
    if( this.rows.length === 0 ) return;
    this.selected = (idx + this.rows.length) % this.rows.length;

    this.el.pickList.querySelectorAll('.win-row').forEach(row => {
      const active = Number(row.dataset.idx) === this.selected;
      row.classList.toggle('active', active);
      row.setAttribute('aria-selected', active);
      if( active ) row.scrollIntoView({ block: 'nearest' });
    });
  }

  choose(entry)
  {
    if( entry.form )
      this.fill(entry, true);
    else
      this.insert(entry.text);
  }

  // --- Fill view ---

  async fill( entry, fromPicker = false )
  {
    this.fromPicker = fromPicker;
    const dataSet = entry.dataSets[0];

    const loaded = await apiCall(dataSet, 'loadSnippet', { path: entry.path, basePath: entry.basePath });
    if( ! loaded.success ) {
      showError(loaded.message || 'Snippet missing');
      return;
    }
    const snippet  = loaded.snippet;
    const composed = await apiCall(dataSet, 'composeContent', { snippet });
    if( ! composed.success ) {
      showError(composed.message || 'Snippet could not be composed');
      return;
    }

    this.el.fillName.textContent    = entry.name;
    this.el.fillSc.textContent      = entry.sc;
    this.el.fillSc.hidden           = ! entry.sc;
    this.el.fillDataSet.textContent = entry.dataSets.join(', ');
    this.el.fillShort.textContent   = entry.short;
    this.el.fillShort.hidden        = ! entry.short;
    this.el.fillBack.hidden         = ! fromPicker;

    this.setEdited(false);
    this.form.render(composed.composed || '');      // sets the result through onChange
    this.el.renderUsage.innerHTML = this.form.tablesHtml(snippet.usage, snippet.content || '');
    this.form.bindTables();

    // Without documented vars or MAYBE blocks the form is empty: the snippet only
    const hasForm = this.el.renderUsage.innerHTML !== '';
    this.el.fillTabs.querySelector('[data-tab="form"]').parentElement.hidden = ! hasForm;
    this.showTab(hasForm ? 'form' : 'snippet');

    this.show('fill');
    const first = hasForm
      ? this.el.renderUsage.querySelector('.var-input') || this.el.renderUsage.querySelector('.maybe-table-cb')
      : document.querySelector('#inlineSnippet .ph');
    (first || this.el.fillInsert).focus();
  }

  showTab(tab)
  {
    this.form.closeChoiceMenu();

    this.el.fillTabs.querySelectorAll('[data-tab]').forEach(button => {
      const active = button.dataset.tab === tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active);
    });
    this.el.fillView.querySelectorAll('[data-pane]').forEach(pane => pane.hidden = pane.dataset.pane !== tab);
  }

  // The result edited by hand wins over the form until reset
  setEdited(edited)
  {
    this.edited = edited;
    this.el.fillEdited.hidden = ! edited;
    this.el.fillTabs.querySelector('[data-tab="result"]').classList.toggle('win-tab-edited', edited);   // seen from the other tabs too
    if( ! edited ) this.el.fillText.value = this.form.text;
  }

  // --- Done ---

  async insert(text)
  {
    if( this.host ) {
      this.host.postMessage({ action: 'insert', text });
      return;
    }

    try {
      await copyToClipboard(text);
      showSuccess('Copied to clipboard');
    }
    catch( e ) {
      showError('Failed to copy: ' + (e?.message || 'Unknown error'));
    }
  }

  cancel()
  {
    this.form.closeChoiceMenu();

    if( this.host )
      this.host.postMessage({ action: 'cancel' });
    else if( ! this.el.fillView.hidden )
      this.pick(this.scFilter);
  }
}
