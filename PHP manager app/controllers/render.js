class RenderController
{
  constructor(app)
  {
    this.app = app;
    this._composedFrom = null; // { snippet, content } the rendered columns were built from

    // The rendered content column: placeholders, MAYBE blocks and the copy output
    this.form = new SnippetForm({
      inline:   document.getElementById('inlineSnippet'),
      usage:    document.getElementById('renderUsage'),
      menu:     document.getElementById('phChoiceMenu'),
      onChange: text => {
        const copyRenderedBtn = document.getElementById('copyRenderedBtn');
        if( copyRenderedBtn ) copyRenderedBtn.disabled = text.length === 0;
      }
    });
  }

  // --- Column views: each column shows either its rendered version or its source ---

  applyFieldViews()
  {
    const snippet = this.app.currentSnippet;
    if( ! snippet ) return;

    const isYaml          = snippet._type === 'yml';
    const usageRendered   = this.app.fieldViews.usage   === 'rendered';
    const contentRendered = this.app.fieldViews.content === 'rendered';

    const visible = {
      usageForm:       ! usageRendered,   // short + sc are only shown here, the rendered view has them in its header
      renderUsage:     usageRendered,
      snippetContent:  ! contentRendered,
      inlineSnippet:   isYaml && contentRendered,
      markdownPreview: ! isYaml && contentRendered,
      copyRenderedBtn: isYaml && contentRendered   // copies what the rendered snippet shows
    };
    Object.entries(visible).forEach(([id, show]) => {
      const el = document.getElementById(id);
      if( el ) el.style.display = show ? '' : 'none';
    });

    this._setViewButton('usageViewBtn', usageRendered);
    this._setViewButton('contentViewBtn', contentRendered);

    // Heights are measured from the top of the visible element
    this.app.usageForm.resize();
    this.app.resizeMdTextarea();
    this.app.resizeInlineSnippet();
  }

  _setViewButton( id, rendered )
  {
    const btn = document.getElementById(id);
    if( ! btn ) return;
    const title = rendered ? 'Show source' : 'Show rendered';
    btn.querySelector('i').className = rendered ? 'bi bi-code-slash' : 'bi bi-eye';
    btn.title = title;
    btn.setAttribute('aria-label', title);
  }

  setFieldView( field, view )
  {
    if( ! this.app.currentSnippet ) return;
    this.app.fieldViews[field] = view;
    this.applyFieldViews();

    // Composing resets entered placeholder values, so only do it when the source was
    // edited since the last render (markdown has no such state and always re-renders)
    const from    = this._composedFrom;
    const content = document.getElementById('snippetContent')?.value;
    const stale   = ! from || from.snippet !== this.app.currentSnippet || from.content !== content;
    if( view === 'rendered' && stale ) this.composeAndRenderInline();
  }

  toggleFieldView(field)
  {
    this.setFieldView( field, this.app.fieldViews[field] === 'rendered' ? 'source' : 'rendered');
  }

  // Mobile: one column at a time (desktop shows both, the classes only matter < md)
  showMobilePane(pane)
  {
    const form = document.getElementById('editForm');
    if( ! form ) return;
    form.classList.toggle('mobile-usage-active', pane === 'usage');
    form.classList.toggle('mobile-content-active', pane !== 'usage');
    form.querySelectorAll('.field-pills [data-pane]').forEach(pill =>
      pill.classList.toggle('active', pill.dataset.pane === pane)
    );
    this.app.resizeMdTextarea();
    this.app.resizeInlineSnippet();
  }

  toggleLineWrap()
  {
    if( ! this.app.currentSnippet ) return;
    this.app._lineWrapOff = ! this.app._lineWrapOff;
    this.applyLineWrap();
  }

  applyLineWrap()
  {
    if( ! this.app.currentSnippet ) return;

    const off = this.app._lineWrapOff;

    // Source and rendered views alike (hidden ones keep the setting for when they are shown)
    const ids = ['usageHead', 'usageText', 'renderUsage', 'snippetContent', 'inlineSnippet', 'markdownPreview'];

    ids.forEach(id => {
      const el = document.getElementById(id);
      if( ! el ) return;
      if( el.tagName === 'TEXTAREA' )
        el.style.whiteSpace = off ? 'nowrap' : '';
      else if( id === 'inlineSnippet' ) {
        el.style.whiteSpace = off ? 'pre' : '';     // preserve \n in text nodes
        el.style.wordWrap   = off ? 'normal' : '';  // CSS has word-wrap:break-word which would override pre
      }
      else
        el.style.whiteSpace = off ? 'nowrap' : '';
      el.style.overflowX = off ? 'auto' : '';
    });
  }

  async composeAndRenderInline()
  {
    if( ! this.app.currentSnippet ) return;

    if( this.app.currentSnippet._type !== 'yml' ) {
      this.renderMarkdownPreview();
      return;
    }

    const snippetContent = document.getElementById('snippetContent');
    const inlineContainer = document.getElementById('inlineSnippet');
    if( ! snippetContent || ! inlineContainer ) return;

    const source  = this.app.currentSnippet;
    const snippet = { ...source, content: snippetContent.value };
    const result = await apiCall(this.app.currentDataPath, 'composeContent', { snippet });
    if( result.success ) {
      this._composedFrom = { snippet: source, content: snippet.content };
      this.form.render(result.composed || '');
      document.getElementById('renderUsage').innerHTML = this._buildUsageHtml();
      this.form.bindTables();
      this.app.resizeInlineSnippet();
      this.applyLineWrap();
    }
  }

  renderMarkdownPreview()
  {
    const mdPreview = document.getElementById('markdownPreview');
    if( ! mdPreview ) return;

    const content = document.getElementById('snippetContent')?.value || '';
    mdPreview.innerHTML = parseMd(content);
    this.app.resizeInlineSnippet(); // routes to MD resize path
  }

  _buildUsageMetaHtml()
  {
    const s = this.app.currentSnippet;
    if( ! s ) return '';
    const parts = [];
    if( s.id ) {
      const scHtml = s.sc ? `<code class="usage-meta-sc">${escapeHtml(s.sc)}</code>` : '';
      parts.push(`<div class="usage-meta-id"><span class="usage-meta-label">ID</span> <code>${escapeHtml(s.id)}</code>${scHtml}</div>`);
    }
    if( s.short ) parts.push(`<div class="usage-meta-short">${escapeHtml(s.short)}</div>`);
    return parts.length ? `<div class="usage-meta">${parts.join('')}</div>` : '';
  }

  _getCurrentContent()
  {
    const ta = document.getElementById('snippetContent');
    if( ta && typeof ta.value === 'string' ) return ta.value;
    return this.app.currentSnippet?.content || '';
  }

  // Rendered usage with a value input per var and a checkbox per MAYBE area
  _buildUsageHtml()
  {
    const s = this.app.currentSnippet;
    const usage = s?.usage ?? null;
    let html = this._buildUsageMetaHtml();

    if( usage && typeof usage === 'object' ) {
      if( usage.head ) html += `<div class="usage-head">${parseMd(usage.head)}</div>`;
      html += this.form.tablesHtml( usage, this._getCurrentContent());
      if( usage.text )
        html += this._buildUsageTextHtml(usage.text);
    }
    else if( typeof usage === 'string' && usage ) {
      html += parseMd(usage);
    }

    return html;
  }

  // Splits text on -- TabName ----- markers and renders Bootstrap tabs if any are found
  // Supports optional color: -- TabName (color: red) --------
  _buildUsageTextHtml(text)
  {
    const splitRe  = /^--\s+.+?\s*-+\s*$/m;
    const markerRe = /^--\s+(.+?)\s*-+\s*$/gm;
    const sections = text.split(splitRe);
    const tabs     = [...text.matchAll(markerRe)].map(m => this._parseTabMarker(m[1]));

    if( tabs.length === 0 )
      return this._renderTextSection(text);

    // Content before the first marker becomes an implicit first tab
    const hasPreContent = sections[0].trim().length > 0;
    const allSections   = hasPreContent ? sections : sections.slice(1);
    const allTabs       = hasPreContent ? [{ name: 'Main', color: null }, ...tabs] : tabs;

    const uid = Math.random().toString(36).slice(2, 7);

    const navItems = allTabs.map(({ name, color }, i) => {
      const colorStyle = color ? ` style="color:${escapeHtml(color)}"` : '';
      return `<li class="nav-item" role="presentation">
        <button class="nav-link usage-tab-btn${i === 0 ? ' active' : ''}" data-bs-toggle="tab"
          data-bs-target="#ut-${uid}-${i}" type="button" role="tab"${colorStyle}>${escapeHtml(name)}</button>
      </li>`;
    }).join('');

    const panes = allSections.map((content, i) =>
      `<div class="tab-pane fade${i === 0 ? ' show active' : ''}" id="ut-${uid}-${i}" role="tabpanel">
        ${this._renderTextSection(content)}
      </div>`
    ).join('');

    return `<ul class="nav usage-tabs mb-2" role="tablist">${navItems}</ul>
      <div class="tab-content">${panes}</div>`;
  }

  _parseTabMarker(raw)
  {
    const colorMatch = raw.trim().match(/^(.+?)\s*\(color:\s*([^)]+)\)\s*$/);
    if( colorMatch )
      return { name: colorMatch[1].trim(), color: colorMatch[2].trim() };
    return { name: raw.trim(), color: null };
  }

  // Renders a text block, splitting on <secondary> for grey section
  _renderTextSection(text)
  {
    const parts = text.split('<secondary>');
    let html = parseMd(parts[0]);
    if( parts.length > 1 )
      html += `<div class="usage-secondary">${parseMd(parts[1])}</div>`;
    return html;
  }

  async copyRenderedContent()
  {
    this.form.updateText();
    if( ! this.form.text ) return;

    try {
      await copyToClipboard(this.form.text);
      showSuccess('Content copied to clipboard');
    }
    catch( e ) {
      showError('Failed to copy content: ' + (e?.message || 'Unknown error'));
    }
  }
}
