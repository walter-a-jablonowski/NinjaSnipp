// Source view of the usage column: short, sc and one control per usage field.
// head and text are markdown textareas, maybe and vars are name / description lists
// edited row by row. Usage keys without a control are kept and written back unchanged.
class UsageFormController
{
  constructor(app)
  {
    this.app   = app;
    this.form  = document.getElementById('usageForm');
    this.lists = {
      maybe: document.getElementById('usageMaybeList'),
      vars:  document.getElementById('usageVarsList')
    };
    this.extra = {};

    this.bindEvents();
  }

  fill(snippet)
  {
    // A plain string is prose usage (supported by the renderer), it becomes the text
    const usage = snippet.usage;
    const isMap = !! usage && typeof usage === 'object' && ! Array.isArray(usage);
    const { head, maybe, vars, text, ...extra } = isMap ? usage : { text: typeof usage === 'string' ? usage : '' };

    this.extra = extra;

    document.getElementById('snippetShort').value = snippet.short || '';
    document.getElementById('snippetSc').value    = snippet.sc    || '';
    document.getElementById('usageHead').value    = head ?? '';
    document.getElementById('usageText').value    = text ?? '';

    this.fillList( this.lists.maybe, maybe);
    this.fillList( this.lists.vars, vars);
    this.updateMissing();
    this.resize();
  }

  clear()
  {
    this.fill({ usage: '' });
  }

  // Values as they are saved. Not trimmed: the trailing newline belongs to the `|` block.
  read()
  {
    const usage = {};
    const head  = document.getElementById('usageHead').value;
    const text  = document.getElementById('usageText').value;

    if( head.trim() ) usage.head = head;

    Object.entries(this.lists).forEach(([list, listEl]) => {
      const entries = this.readList(listEl);
      if( Object.keys(entries).length ) usage[list] = entries;
    });

    if( text.trim() ) usage.text = text;
    Object.assign( usage, this.extra);

    return {
      short: document.getElementById('snippetShort').value.trim(),
      sc:    document.getElementById('snippetSc').value.trim(),
      usage: Object.keys(usage).length ? usage : ''
    };
  }

  // Textareas grow with their text, the form scrolls as a whole. Needs the form visible
  // (a hidden textarea has no scrollHeight), so the view switch calls it too.
  resize()
  {
    if( this.form.offsetParent === null ) return;
    this.form.querySelectorAll('.usage-autogrow').forEach(ta => this.autoGrow(ta));
  }

  autoGrow(ta)
  {
    ta.style.height = 'auto';
    ta.style.height = (ta.scrollHeight + 2) + 'px';   // + border
  }

  // --- Name / description lists ---

  // entries: { name: description }, a plain list of names is accepted too
  fillList( listEl, entries )
  {
    listEl.replaceChildren();

    if( Array.isArray(entries) )
      entries = Object.fromEntries( entries.map(name => [name, '']));

    if( entries && typeof entries === 'object' )
      Object.entries(entries).forEach(([name, desc]) => this.addRow( listEl, name, desc));

    this.markDuplicates(listEl);
  }

  readList(listEl)
  {
    const entries = {};
    listEl.querySelectorAll('.usage-list-row').forEach(row => {
      const name = row.querySelector('.usage-list-name').value.trim();
      if( name ) entries[name] = row.querySelector('.usage-list-desc').value.trim();
    });
    return entries;
  }

  // after: insert behind this row (default: at the end)
  addRow( listEl, name = '', desc = '', after = null )
  {
    const row = document.getElementById('usageListRowTpl').content.firstElementChild.cloneNode(true);
    row.querySelector('.usage-list-name').value = name;
    row.querySelector('.usage-list-desc').value = desc ?? '';
    listEl.insertBefore( row, after ? after.nextSibling : null);
    return row;
  }

  removeRow(row)
  {
    const listEl = row.parentElement;
    const prev   = row.previousElementSibling;
    row.remove();
    prev?.querySelector('.usage-list-desc').focus();
    this.onListChanged(listEl);
  }

  onListChanged(listEl)
  {
    this.markDuplicates(listEl);
    this.updateMissing();
    this.app.editor.onEditFieldChanged();   // input events alone miss removed rows
  }

  // A duplicate name would silently overwrite the entry above it on save
  markDuplicates(listEl)
  {
    const seen = new Set();
    listEl.querySelectorAll('.usage-list-name').forEach(input => {
      const name = input.value.trim();
      const dup  = name !== '' && seen.has(name);
      input.classList.toggle('is-invalid', dup);
      input.title = dup ? 'Duplicate name: replaces the entry above when saved' : '';
      seen.add(name);
    });
  }

  // Names used in the snippet content but not listed yet
  missingNames(list)
  {
    const content = document.getElementById('snippetContent')?.value || '';
    const used    = list === 'maybe' ? extractContentMaybes(content) : extractContentVars(content);
    const defined = new Set( Object.keys( this.readList(this.lists[list])));
    return [...used].filter(name => ! defined.has(name));
  }

  // One click adds what the content uses but the list lacks
  updateMissing()
  {
    this.form.querySelectorAll('.usage-missing-btn').forEach(btn => {
      const missing = this.missingNames(btn.dataset.list);
      btn.style.display = missing.length ? '' : 'none';
      btn.title = `Used in content, click to add: ${missing.join(', ')}`;
      btn.querySelector('.usage-missing-text').textContent = `${missing.length} missing`;
    });
  }

  bindEvents()
  {
    this.form.addEventListener('input', (e) => {
      if( e.target.classList.contains('usage-autogrow') )
        this.autoGrow(e.target);
      else if( e.target.classList.contains('usage-list-name') ) {
        this.markDuplicates( e.target.closest('.usage-list'));
        this.updateMissing();
      }
    });

    this.form.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if( ! btn ) return;

      if( btn.classList.contains('usage-add-btn') )
        this.addRow( this.lists[btn.dataset.list]).querySelector('.usage-list-name').focus();
      else if( btn.classList.contains('usage-missing-btn') )
      {
        const listEl = this.lists[btn.dataset.list];
        this.missingNames(btn.dataset.list).forEach(name => this.addRow( listEl, name));
        this.onListChanged(listEl);
        listEl.lastElementChild?.querySelector('.usage-list-desc').focus();
      }
      else if( btn.classList.contains('usage-list-remove') )
        this.removeRow( btn.closest('.usage-list-row'));
    });

    // Enter: next entry, Backspace in an empty entry: remove it
    this.form.addEventListener('keydown', (e) => {
      const row = e.target.closest('.usage-list-row');
      if( ! row ) return;

      const name = row.querySelector('.usage-list-name');
      const desc = row.querySelector('.usage-list-desc');

      if( e.key === 'Enter' ) {
        e.preventDefault();
        this.addRow( row.parentElement, '', '', row).querySelector('.usage-list-name').focus();
      }
      else if( e.key === 'Backspace' && e.target === name && ! name.value && ! desc.value ) {
        e.preventDefault();
        this.removeRow(row);
      }
    });

    // The missing hints follow the content while it is edited
    document.getElementById('snippetContent')?.addEventListener('input', () => this.updateMissing());
  }
}
