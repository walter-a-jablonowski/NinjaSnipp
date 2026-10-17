// The AI sidebar (dev/ai_sidebar_plan.md): chat sessions, turns, the proposals of an
// answer with accept / reject, and the client tools (lists, opening a snippet, filling
// its form). The server only proposes; a change is made when the user accepts it here.
//
// A session as stored (ajax aiSessionSave): { id, title, provider, messages }, a message:
//   { role: 'user', content }
//   { role: 'assistant', content, proposals: [proposal + state, note?, error?], clientCalls }
// proposal.state: open | accepted | rejected | failed

class AiController
{
  static DIFF_CONTEXT = 2;     // unchanged lines shown around a change

  constructor(app)
  {
    this.app       = app;
    this.session   = AiController.blankSession();
    this.sessions  = null;    // the list, loaded when the sidebar is first opened
    this.request   = null;    // AbortController of the running turn
    this.el        = id => document.getElementById(id);
  }

  static blankSession()
  {
    return { id: null, title: '', provider: '', messages: [] };
  }

  bindEvents()
  {
    const input = this.el('aiInput');

    this.el('aiSendBtn')?.addEventListener('click', () => this.request ? this.stop() : this.send());
    this.el('aiNewSession')?.addEventListener('click', () => this.newSession());
    this.el('aiSessionsToggle')?.addEventListener('click', () => this.toggleSessions());
    this.el('aiSidebarClose')?.addEventListener('click', () => this.toggle(false));
    this.el('aiProvider')?.addEventListener('change', e => { this.session.provider = e.target.value; });

    input?.addEventListener('keydown', e => {
      if( e.key === 'Enter' && ! e.shiftKey && ! e.isComposing ) {
        e.preventDefault();
        if( ! this.request ) this.send();
      }
    });

    // One listener per container: rows come and go with every render
    const messages = this.el('aiMessages');
    messages?.addEventListener('click', e => this.onMessagesClick(e));
    messages?.addEventListener('keydown', e => {      // Enter in a note field rejects with it
      if( e.key === 'Enter' && e.target.closest('.ai-change-note') )
        e.target.closest('.ai-change-note').querySelector('[data-action]').click();
    });
    messages?.addEventListener('mouseover', e => this.pointAt(e.target.closest('[data-path]')));
    messages?.addEventListener('mouseout', e => { if( ! e.relatedTarget?.closest?.('[data-path]') ) this.pointAt(null); });
    this.el('aiSessions')?.addEventListener('click', e => this.onSessionsClick(e));
  }

  async toggle(open)
  {
    const sidebar = this.el('aiSidebar');
    if( ! sidebar ) return;

    const isOpen = open !== undefined ? open : ! sidebar.classList.contains('open');
    sidebar.classList.toggle('open', isOpen);

    if( isOpen && this.sessions === null )
      await this.loadSessions(true);
    if( isOpen )
      this.el('aiInput')?.focus();
  }

  // The data set changed: its sessions are others
  async onDataSetChanged()
  {
    if( this.request ) this.stop();
    this.session  = AiController.blankSession();
    this.sessions = null;
    this.renderConversation();

    if( this.el('aiSidebar')?.classList.contains('open') )
      await this.loadSessions(true);
  }

  // --- Sessions ---

  // openLatest: continue the newest session (first opening of the sidebar)
  async loadSessions( openLatest = false )
  {
    const res = await apiCall(this.app.currentDataPath, 'aiSessions');
    this.sessions = res.success ? res.sessions : [];

    if( openLatest && this.sessions.length )
      await this.openSession(this.sessions[0].id);
    else if( openLatest )
      this.renderConversation();       // nothing to continue: the empty chat with its hints
    else
      this.renderSessions();
  }

  async openSession(id)
  {
    const res = await apiCall(this.app.currentDataPath, 'aiSessionLoad', { id });
    if( ! res.success ) {
      showError('Failed to load the chat: ' + res.message);
      return;
    }

    this.session = { ...AiController.blankSession(), ...res.session };
    this.useProvider(this.session.provider);
    this.toggleSessions(false);
    this.renderConversation();
  }

  newSession()
  {
    if( this.request ) this.stop();
    this.session = AiController.blankSession();
    this.useProvider('');
    this.toggleSessions(false);
    this.renderConversation();
    this.el('aiInput')?.focus();
  }

  async deleteSession(id)
  {
    const res = await apiCall(this.app.currentDataPath, 'aiSessionDelete', { id });
    if( ! res.success ) {
      showError('Failed to delete the chat: ' + res.message);
      return;
    }

    if( this.session.id === id ) {
      this.session = AiController.blankSession();
      this.renderConversation();
    }
    await this.loadSessions();
  }

  async saveSession()
  {
    const session = this.session;
    const res = await apiCall(this.app.currentDataPath, 'aiSessionSave', { session });

    if( ! res.success ) {
      showError('Failed to save the chat: ' + res.message);
      return;
    }

    // Another session may be open by now; only this one gets its id
    session.id = res.session.id;
    if( this.sessions !== null ) await this.loadSessions();
  }

  // A session goes on with the provider it was held with (the select's default otherwise)
  useProvider(provider)
  {
    const select = this.el('aiProvider');
    if( ! select ) return;

    const known = [...select.options].some(o => o.value === provider);
    select.value = known ? provider : select.dataset.default;
    this.session.provider = select.value;
  }

  toggleSessions(show)
  {
    const list = this.el('aiSessions');
    if( ! list ) return;

    list.hidden = show !== undefined ? ! show : ! list.hidden;
    this.el('aiSessionsToggle')?.setAttribute('aria-expanded', String( ! list.hidden));
    if( ! list.hidden ) this.renderSessions();
  }

  renderSessions()
  {
    const list = this.el('aiSessions');
    if( ! list || list.hidden ) return;

    list.innerHTML = (this.sessions || []).length
      ? this.sessions.map(s => `
          <div class="ai-session${s.id === this.session.id ? ' active' : ''}" data-session="${escapeHtml(s.id)}">
            <span class="ai-session-title">${escapeHtml(s.title || 'Untitled')}</span>
            <span class="ai-session-time">${escapeHtml((s.updated || '').slice(0, 16))}</span>
            <button type="button" class="btn btn-sm ai-session-delete" title="Delete chat" aria-label="Delete chat"><i class="bi bi-trash"></i></button>
          </div>`).join('')
      : '<div class="ai-session-empty">No chats in this data set yet</div>';
  }

  onSessionsClick(e)
  {
    const row = e.target.closest('[data-session]');
    if( ! row ) return;

    if( e.target.closest('.ai-session-delete') )
      this.deleteSession(row.dataset.session);
    else
      this.openSession(row.dataset.session);
  }

  // --- Turns ---

  async send( text = null )
  {
    const input = this.el('aiInput');
    text = (text ?? input.value).trim();
    if( ! text ) return;

    input.value = '';
    this.session.messages.push({ role: 'user', content: text });
    if( ! this.session.title ) this.session.title = text.slice(0, 60);
    this.renderConversation();

    await this.runTurn();
  }

  async runTurn()
  {
    // The AI reads the files: a queued autosave has to be on disk first
    await this.app.editor.flushAutosave();

    const session = this.session;
    const editor  = this.app.editor;
    const open    = editor.currentSnippetPath();
    this.request  = new AbortController();
    this.setBusy(true);

    let res;
    try {
      const response = await fetch('ajax.php', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        signal:  this.request.signal,
        body:    JSON.stringify({
          action:   'aiChat',
          dataPath: this.app.currentDataPath,
          provider: session.provider,
          messages: AiController.modelMessages(session.messages),
          open:     open ? { path: open, basePath: this.app.currentBasePath } : null
        })
      });
      res = await response.json();
    }
    catch( e ) {
      res = { success: false, message: e.name === 'AbortError' ? 'Stopped' : 'The server did not answer properly' };
    }

    this.request = null;
    this.setBusy(false);

    // A session closed meanwhile does not get this answer
    if( session !== this.session ) return;

    if( ! res.success ) {
      this.failTurn(res.message);
      return;
    }

    const answer = {
      role:        'assistant',
      content:     res.reply,
      proposals:   (res.proposals || []).map(p => ({ ...p, state: 'open' })),
      clientCalls: res.clientCalls || []
    };
    session.messages.push(answer);
    this.renderConversation();

    for( const call of answer.clientCalls )
      await this.runClientCall(call);

    await this.saveSession();
  }

  stop()
  {
    this.request?.abort();
  }

  // The question goes back into the input, so nothing typed is lost; Retry sends it again
  failTurn(message)
  {
    const last = this.session.messages[this.session.messages.length - 1];
    if( last?.role === 'user' ) {
      this.session.messages.pop();
      this.el('aiInput').value = last.content;
    }

    this.renderConversation();
    this.el('aiMessages').insertAdjacentHTML('beforeend', `
      <div class="ai-msg ai-msg-error">
        <div class="ai-msg-bubble"><i class="bi bi-exclamation-triangle me-1"></i>${escapeHtml(message)}
          <button type="button" class="btn btn-sm btn-link p-0 ms-2" data-action="retry">Retry</button>
        </div>
      </div>`);
    this.scrollDown();
  }

  setBusy(busy)
  {
    const btn = this.el('aiSendBtn');
    if( btn ) {
      btn.querySelector('i').className = busy ? 'bi bi-stop-fill' : 'bi bi-send-fill';
      btn.title = busy ? 'Stop' : 'Send';
    }

    this.el('aiThinking')?.remove();
    if( busy ) {
      this.el('aiMessages').insertAdjacentHTML('beforeend',
        '<div class="ai-msg ai-msg-ai" id="aiThinking"><div class="ai-msg-bubble ai-thinking"><span></span><span></span><span></span></div></div>');
      this.scrollDown();
    }
  }

  // What the model gets of the conversation: the text of every turn. It does not see the
  // sidebar, so a user line starts with what became of the proposals and calls of the
  // answer before it (the tool rounds of a turn are not kept).
  static modelMessages(messages)
  {
    const out   = [];
    let   notes = [];

    for( const msg of messages ) {
      if( msg.role === 'assistant' ) {
        out.push({ role: 'assistant', content: msg.content || '' });
        notes = AiController.outcomeNotes(msg);
      }
      else if( msg.role === 'user' ) {
        const prefix = notes.length ? `[What happened to your last answer: ${notes.join('; ')}]\n\n` : '';
        out.push({ role: 'user', content: prefix + msg.content });
        notes = [];
      }
    }

    return out;
  }

  static outcomeNotes(answer)
  {
    const states = {
      open:     'not decided',
      accepted: 'accepted and applied',
      rejected: 'rejected',
      failed:   'accepted, but applying it failed'
    };

    const notes = (answer.proposals || []).map(p =>
      `"${p.label}" ${states[p.state] || p.state}` + (p.note ? `, the user's note: ${p.note}` : '') + (p.error ? ` (${p.error})` : '')
    );

    (answer.clientCalls || []).forEach(call => {
      if( call.tool === 'form_fill' )    notes.push(`the form of ${call.path} was filled`);
      if( call.tool === 'snippet_open' ) notes.push(`${call.path} was opened`);
    });

    return notes;
  }

  // --- Client tools ---

  async runClientCall(call)
  {
    if( call.tool === 'snippet_open' )
      await this.openItem(call.path, call.basePath);

    if( call.tool === 'form_fill' ) {
      await this.openItem(call.path, call.basePath);
      if( this.app.fieldViews.content !== 'rendered' ) {
        this.app.fieldViews.content = 'rendered';
        this.app.render.applyFieldViews();
      }
      this.app.render.showMobilePane('content');
      this.app.render.fillForm(call.values || {}, call.maybeOff || []);
    }
  }

  // Opens a snippet in the editor (a folder in the tree), its row revealed and marked
  async openItem( path, basePath = null )
  {
    await this.app.tree.reveal(path);
    const row = this.app.tree.rowFor(path, basePath);

    if( /\.(yml|md)$/.test(path) ) {
      document.querySelectorAll('.tree-item.active').forEach(item => item.classList.remove('active'));
      row?.classList.add('active');
      await this.app.editor.loadSnippet(path, basePath || null, row?.dataset.path || path);
    }
    else
      row?.scrollIntoView({ block: 'nearest' });
  }

  // --- Proposals ---

  async accept(proposal)
  {
    // An autosave still queued would write over the change right after
    await this.app.editor.flushAutosave();

    const res = await apiCall(this.app.currentDataPath, 'aiApply', { proposal: AiController.sent(proposal) });

    if( res.success ) {
      proposal.state = 'accepted';
      await this.afterChange(proposal, res.paths || []);
    }
    else {
      proposal.state = 'failed';
      proposal.error = res.message;
    }
  }

  // What goes back to the server: the proposal as it came, without the sidebar's state
  static sent(proposal)
  {
    const { state, note, error, ...sent } = proposal;
    return sent;
  }

  async decide( answer, ids, action, note = '' )
  {
    for( const proposal of answer.proposals.filter(p => ids.includes(p.id) && p.state === 'open') ) {
      if( action === 'accept' )
        await this.accept(proposal);
      else {
        proposal.state = 'rejected';
        if( note ) proposal.note = note;
      }
    }

    this.renderConversation(false);
    await this.saveSession();
  }

  // The tree and an open snippet follow what a change did on disk
  async afterChange( proposal, paths )
  {
    const editor     = this.app.editor;
    const open       = editor.currentSnippetPath();
    const sameSource = ! this.app.currentBasePath || this.baseOf(proposal.source) === this.app.currentBasePath;
    let   reload     = false;

    if( open && sameSource ) {
      const [from, to] = paths;

      if( ['item_rename', 'item_move'].includes(proposal.tool) && (open === from || open.startsWith(from + '/')) ) {
        editor.followRename(from, to, open === from ? 'file' : 'folder');
        reload = true;
      }
      else if( proposal.tool === 'snippet_delete' && open === proposal.path ) {
        this.app.currentSnippet = null;
        editor.clearEditForm();
      }
      else
        reload = paths.includes(open);
    }

    await this.app.loadFiles();
    if( reload )
      await editor.loadSnippet(editor.currentSnippetPath(), this.app.currentBasePath, this.app.currentTreePath);
  }

  // Source label (as the server names sources) => its folder
  baseOf(label)
  {
    return Object.entries(this.app.baseFolderLabels || {}).find(([, l]) => l === label)?.[0] || null;
  }

  // Marks the tree row a sidebar entry points at (or the folder above it that is shown)
  pointAt(el)
  {
    document.querySelectorAll('#fileList .ai-target').forEach(row => row.classList.remove('ai-target'));
    if( ! el ) return;

    this.app.tree.visibleRowFor(el.dataset.path, this.baseOf(el.dataset.source) )?.classList.add('ai-target');
  }

  onMessagesClick(e)
  {
    const target = e.target.closest('[data-action]');
    if( ! target ) return;
    e.preventDefault();          // the item links are <a href="#">

    const msgEl  = target.closest('[data-msg]');
    const answer = msgEl ? this.session.messages[+msgEl.dataset.msg] : null;
    const change = target.closest('[data-change]');
    const id     = change?.dataset.change;
    const action = target.dataset.action;

    if( action === 'retry' ) {
      e.target.closest('.ai-msg')?.remove();
      this.send();
    }
    else if( action === 'copy' )
      this.copy(answer.content, target);
    else if( action === 'open' )
      this.openItem(target.dataset.path, this.baseOf(target.dataset.source));
    else if( action === 'diff' ) {
      const diff = change.querySelector('.ai-change-diff');
      diff.hidden = ! diff.hidden;
    }
    else if( action === 'accept' )
      this.decide(answer, [id], 'accept');
    else if( action === 'reject' )
      this.decide(answer, [id], 'reject');
    else if( action === 'note' ) {
      change.querySelector('.ai-change-note').hidden = false;
      change.querySelector('.ai-change-note input').focus();
    }
    else if( action === 'reject-note' )
      this.decide(answer, [id], 'reject', change.querySelector('.ai-change-note input').value.trim());
    else if( action === 'accept-all' || action === 'reject-all' )
      this.decide(answer, answer.proposals.map(p => p.id), action === 'accept-all' ? 'accept' : 'reject');
    else if( action === 'propose-again' )
      this.send('Please propose these changes again, following my notes.');
  }

  async copy( text, button )
  {
    try {
      await navigator.clipboard.writeText(text);
      button.querySelector('i').className = 'bi bi-check2';
      setTimeout(() => { button.querySelector('i').className = 'bi bi-clipboard'; }, 1200);
    }
    catch( e ) {
      showError('Copy failed');
    }
  }

  // --- Rendering ---

  renderConversation( scroll = true )
  {
    const box = this.el('aiMessages');
    if( ! box ) return;

    const messages = this.session.messages;
    box.innerHTML = messages.length
      ? messages.map((msg, i) => this.messageHtml(msg, i, i === messages.length - 1)).join('')
      : this.el('aiEmptyTpl').innerHTML;

    this.renderSessions();
    if( scroll ) this.scrollDown();
  }

  messageHtml( msg, index, isLast )
  {
    if( msg.role === 'user' )
      return `<div class="ai-msg ai-msg-user"><div class="ai-msg-bubble">${escapeHtml(msg.content)}</div></div>`;

    const bubble = msg.content
      ? `<div class="ai-msg-bubble ai-markdown">${AiController.sanitize( parseMd(msg.content))}
           <button type="button" class="btn btn-sm ai-copy" data-action="copy" title="Copy (markdown)" aria-label="Copy"><i class="bi bi-clipboard"></i></button>
         </div>`
      : '';

    return `<div class="ai-msg ai-msg-ai" data-msg="${index}">
        ${bubble}
        ${(msg.clientCalls || []).map(call => this.clientCallHtml(call)).join('')}
        ${this.proposalsHtml(msg, isLast)}
      </div>`;
  }

  clientCallHtml(call)
  {
    if( call.tool === 'show_items' )
      return `<div class="ai-items">
          ${call.title ? `<div class="ai-items-title">${escapeHtml(call.title)}</div>` : ''}
          ${call.items.map(item => `
            <div class="ai-item${item.exists ? '' : ' ai-item-gone'}">
              ${item.exists ? this.itemLinkHtml(item.path, item.source, item.type === 'folder' ? 'bi-folder2' : 'bi-file-earmark-text') : `<i class="bi bi-file-earmark-x"></i> ${escapeHtml(item.path)}`}
              ${item.note ? `<span class="ai-item-note">${escapeHtml(item.note)}</span>` : ''}
            </div>`).join('')}
        </div>`;

    const what = call.tool === 'form_fill' ? 'Filled the form of' : 'Opened';
    return `<div class="ai-note"><i class="bi bi-ui-checks me-1"></i>${what} ${this.itemLinkHtml(call.path, call.source)}</div>`;
  }

  itemLinkHtml( path, source, icon = null )
  {
    const name = path.split('/').pop().replace(/\.(yml|md)$/, '').replace(/^\d{2}[ _.\-]+/, '');
    return `<a href="#" class="ai-item-link" data-action="open" data-path="${escapeHtml(path)}" data-source="${escapeHtml(source || '')}" title="${escapeHtml(path)}">`
         + (icon ? `<i class="bi ${icon} me-1"></i>` : '') + `${escapeHtml(name)}</a>`;
  }

  proposalsHtml( answer, isLast )
  {
    const proposals = answer.proposals || [];
    if( ! proposals.length ) return '';

    const open   = proposals.filter(p => p.state === 'open').length;
    const noted  = proposals.some(p => p.note);
    const header = open > 1
      ? `<button type="button" class="btn btn-sm btn-outline-success" data-action="accept-all"><i class="bi bi-check-all"></i> Accept all</button>
         <button type="button" class="btn btn-sm btn-outline-secondary" data-action="reject-all"><i class="bi bi-x-lg"></i> Reject all</button>`
      : '';
    const again = ! open && noted && isLast
      ? '<button type="button" class="btn btn-sm btn-outline-primary mt-1" data-action="propose-again"><i class="bi bi-arrow-repeat"></i> Propose again</button>'
      : '';

    return `<div class="ai-changes">
        <div class="ai-changes-head"><span>${proposals.length} change${proposals.length > 1 ? 's' : ''}${open ? ` · ${open} open` : ''}</span>${header}</div>
        ${proposals.map(p => this.proposalHtml(p)).join('')}
        ${again}
      </div>`;
  }

  proposalHtml(p)
  {
    const icons = { open: 'bi-circle', accepted: 'bi-check-circle-fill', rejected: 'bi-x-circle', failed: 'bi-exclamation-circle-fill' };
    const label = escapeHtml(p.label).replace(/\*([^*]+)\*/g, '<em>$1</em>');
    const multi = Object.keys(this.app.baseFolderLabels || {}).length > 1;
    const hasDiff = (p.preview || []).length > 0;

    const result = p.state === 'rejected' && p.note ? `<div class="ai-change-result">Rejected: ${escapeHtml(p.note)}</div>`
                 : p.state === 'failed'             ? `<div class="ai-change-result">Failed: ${escapeHtml(p.error || '')}</div>`
                 : '';

    const actions = p.state === 'open'
      ? `<div class="ai-change-actions">
           <button type="button" class="btn btn-sm btn-success" data-action="accept"><i class="bi bi-check-lg"></i> Accept</button>
           <button type="button" class="btn btn-sm btn-outline-secondary" data-action="reject"><i class="bi bi-x-lg"></i> Reject</button>
           <button type="button" class="btn btn-sm btn-link" data-action="note">Reject with comment…</button>
         </div>
         <div class="ai-change-note" hidden>
           <input type="text" class="form-control form-control-sm" placeholder="What should be different?">
           <button type="button" class="btn btn-sm btn-outline-secondary" data-action="reject-note">Reject</button>
         </div>`
      : '';

    return `<div class="ai-change" data-change="${escapeHtml(p.id)}" data-state="${p.state}">
        <div class="ai-change-head" data-path="${escapeHtml(p.path)}" data-source="${escapeHtml(p.source || '')}">
          <i class="bi ${icons[p.state] || 'bi-circle'} ai-change-state"></i>
          <span class="ai-change-label" title="${escapeHtml(p.path)}">${label}</span>
          ${multi && p.source ? `<span class="ai-change-source">${escapeHtml(p.source)}</span>` : ''}
          ${hasDiff ? '<button type="button" class="btn btn-sm ai-change-diff-btn" data-action="diff" title="Show the change"><i class="bi bi-file-diff"></i></button>' : ''}
        </div>
        ${(p.warnings || []).map(w => `<div class="ai-change-warn"><i class="bi bi-exclamation-triangle me-1"></i>${escapeHtml(w)}</div>`).join('')}
        ${hasDiff ? `<div class="ai-change-diff" hidden>${p.preview.map(f => this.fieldDiffHtml(f)).join('')}</div>` : ''}
        ${result}
        ${actions}
      </div>`;
  }

  fieldDiffHtml(field)
  {
    const lines = AiController.diffHunks( lineDiff(field.before || '', field.after || ''), AiController.DIFF_CONTEXT);
    const sign  = { same: ' ', del: '-', add: '+' };

    return `<div class="ai-diff-field">${escapeHtml(field.field)}</div>
      <div class="ai-diff">${lines.map(l => l.type === 'gap'
        ? '<div class="ai-diff-gap">⋯</div>'
        : `<div class="ai-diff-${l.type}">${sign[l.type]} ${escapeHtml(l.text) || '&nbsp;'}</div>`).join('')}</div>`;
  }

  // The changed lines of a diff with $context unchanged lines around them; a skipped
  // stretch becomes one { type: 'gap' }
  static diffHunks( diff, context )
  {
    const keep = diff.map(() => false);
    diff.forEach((line, i) => {
      if( line.type === 'same' ) return;
      for( let k = Math.max(0, i - context); k <= Math.min(diff.length - 1, i + context); k++ ) keep[k] = true;
    });

    const out = [];
    diff.forEach((line, i) => {
      if( keep[i] )
        out.push(line);
      else if( out.length === 0 || out[out.length - 1].type !== 'gap' )
        out.push({ type: 'gap' });
    });

    return out;
  }

  // The model's markdown may hold HTML: no scripts, no event handlers, no javascript: links
  static sanitize(html)
  {
    const box = document.createElement('div');
    box.innerHTML = html;

    box.querySelectorAll('script, style, iframe, object, embed, form, link, meta').forEach(el => el.remove());
    box.querySelectorAll('*').forEach(el => {
      [...el.attributes].forEach(attr => {
        if( /^on/i.test(attr.name) || (/^(href|src)$/i.test(attr.name) && /^\s*javascript:/i.test(attr.value)) )
          el.removeAttribute(attr.name);
      });
      if( el.tagName === 'A' ) {
        el.target = '_blank';
        el.rel    = 'noopener';
      }
    });

    return box.innerHTML;
  }

  scrollDown()
  {
    const box = this.el('aiMessages');
    if( box ) box.scrollTop = box.scrollHeight;
  }
}
