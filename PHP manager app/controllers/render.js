class RenderController
{
  constructor(app)
  {
    this.app = app;
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

    const activeTab = document.querySelector('#contentTabs .nav-link.active');
    const isEdit    = activeTab && activeTab.id === 'edit-tab';
    const isYaml    = this.app.currentSnippet._type === 'yml';
    const off       = this.app._lineWrapOff;

    let ids;
    if( isYaml && isEdit )        ids = ['snippetContent', 'snippetUsage', 'usagePreview'];
    else if( isYaml && ! isEdit ) ids = ['renderUsage', 'inlineSnippet'];
    else if( isEdit )             ids = ['snippetContent'];
    else                          ids = ['markdownPreview'];

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

    const renderRow    = document.getElementById('renderRow');
    const mdPreview    = document.getElementById('markdownPreview');
    if( renderRow )  renderRow.style.display  = '';
    if( mdPreview )  mdPreview.style.display  = 'none';

    const snippet = { ...this.app.currentSnippet, content: snippetContent.value };
    const result = await apiCall(this.app.currentDataPath, 'composeContent', { snippet });
    if( result.success ) {
      this.renderInlineSnippet(result.composed || '');
      this.renderUsageInPreview();
      if( renderRow ) {
        const usage = this.app.currentSnippet?.usage;
        const hasUsage = usage && (typeof usage === 'string' ? usage.trim() : (usage.text || Object.keys(usage).length));
        const mobileUsageFirst = window.innerWidth < 768 && hasUsage;
        renderRow.classList.toggle('render-usage-active', !!mobileUsageFirst);
        renderRow.classList.toggle('render-snippet-active', !mobileUsageFirst);
      }
      const renderToggleBtn = document.getElementById('renderViewToggleBtn');
      if( renderToggleBtn ) {
        const icon = renderToggleBtn.querySelector('i');
        if( icon ) icon.className = 'bi bi-card-text';
      }
      this.updateRenderedOutput();
      this.app.resizeInlineSnippet();
      this.applyLineWrap();
    }
  }

  renderMarkdownPreview()
  {
    const renderRow = document.getElementById('renderRow');
    const mdPreview = document.getElementById('markdownPreview');
    if( ! mdPreview ) return;

    if( renderRow ) renderRow.style.display = 'none';
    mdPreview.style.display = '';

    const content = document.getElementById('snippetContent')?.value || '';
    mdPreview.innerHTML = parseMd(content);
    this.app.resizeInlineSnippet(); // routes to MD resize path
  }

  renderInlineSnippet(composedText)
  {
    const container = document.getElementById('inlineSnippet');
    if( ! container ) return;
    const html = this.buildInlineHtmlFromComposed(composedText);
    container.innerHTML = html;
    this.bindInlinePlaceholderEvents();
  }

  buildInlineHtmlFromComposed(text)
  {
    // First pass: convert MAYBE to HTML structure
    const maybeStack = [];
    const maybeR2 = /<<<MAYBE:START:([^>]+)>>>|<<<MAYBE:END>>>/g;
    let processedText = text.replace(maybeR2, (match, name) => {
      if( match.startsWith('<<<MAYBE:START:') ) {
        maybeStack.push(name);
        return `<<<MAYBE-DIV-START:${name}>>>`;
      }
      else {
        maybeStack.pop();
        return '<<<MAYBE-DIV-END>>>';
      }
    });

    const regex = /\{\{\s*([^}]*)\s*\}\}/g;
    let lastIndex = 0;
    let match;
    let out = '';
    const incStack = [];

    const emitLiteralWithInc = (literal, idxTag) => {
      if( ! literal ) return;
      const maybeR = /(<<<INC:START:([^>]+)>>>|<<<INC:END>>>|<<<MAYBE-DIV-START:([^>]+)>>>|<<<MAYBE-DIV-END>>>)/g;
      let pos = 0;
      let m;
      while( (m = maybeR.exec(literal)) ) {
        const before = literal.slice(pos, m.index);
        if( before ) {
          out += `<span class="ph-literal" contenteditable="true" tabindex="-1" data-chunk="${idxTag}">${escapeHtml(before)}</span>`;
        }
        const token = m[1];
        if( token.startsWith('<<<INC:START:') ) {
          const name = m[2] || '';
          out += `<span class="inc-block" data-inc="${escapeHtml(name)}">`;
          incStack.push({type: 'inc', name});
        }
        else if( token === '<<<INC:END>>>' ) {
          if( incStack.length > 0 && incStack[incStack.length - 1].type === 'inc' ) {
            incStack.pop();
            out += `</span>`;
          }
        }
        else if( token.startsWith('<<<MAYBE-DIV-START:') ) {
          const name = m[3] || '';
          out += `<div class="maybe-block" data-maybe="${escapeHtml(name)}" data-enabled="true">`;
          out += `<div class="maybe-header">`;
          out += `<input type="checkbox" class="maybe-checkbox" checked> `;
          out += `<span class="maybe-label">${escapeHtml(name)}</span>`;
          out += `</div>`;
          out += `<div class="maybe-content">`;
          incStack.push({type: 'maybe', name});
        }
        else if( token === '<<<MAYBE-DIV-END>>>' ) {
          if( incStack.length > 0 && incStack[incStack.length - 1].type === 'maybe' ) {
            incStack.pop();
            out += `</div>`; // close maybe-content
            out += `<div class="maybe-end"></div>`;
            out += `</div>`; // close maybe-block
          }
        }
        pos = maybeR.lastIndex;
      }
      const tail = literal.slice(pos);
      if( tail ) {
        out += `<span class="ph-literal" contenteditable="true" tabindex="-1" data-chunk="${idxTag}-tail">${escapeHtml(tail)}</span>`;
      }
    };

    while( (match = regex.exec(processedText)) ) {
      const before = processedText.slice(lastIndex, match.index);
      if( before ) emitLiteralWithInc(before, String(lastIndex));

      const raw   = match[1];
      const token = raw.trim();

      if( /^include:\s*["'][^"']+["']$/i.test(token) ) {
        out += escapeHtml(match[0]);
        lastIndex = regex.lastIndex;
        continue;
      }

      const simpleRe = /^[A-Za-z0-9_.-]+$/;
      const withDefaultRe = /^([A-Za-z0-9_.-]+)=(.+)$/;

      const m = token.match(withDefaultRe);
      if( m ) {
        const name = m[1];
        const def = m[2];
        if( def.includes('|') ) {
          const choices = def.split('|').map(s => s.trim());
          const defChoice = choices[0] || '';
          const dataChoices = escapeHtml(JSON.stringify(choices));
          out += `<span class="ph ph-choice" tabindex="0" data-ph="${escapeHtml(name)}" data-default="${escapeHtml(defChoice)}" data-choices='${dataChoices}'>${escapeHtml(defChoice)}</span>`;
        }
        else {
          const defVal = def;
          out += `<span class="ph ph-text" contenteditable="true" tabindex="0" data-ph="${escapeHtml(name)}" data-default="${escapeHtml(defVal)}">${escapeHtml(defVal)}</span>`;
        }
      }
      else if( simpleRe.test(token) ) {
        const name = token;
        out += `<span class="ph ph-text" contenteditable="true" tabindex="0" data-ph="${escapeHtml(name)}" data-default="" data-ph-label="${escapeHtml(name)}"></span>`;
      }
      else {
        out += `<span class="ph-literal" contenteditable="true" tabindex="-1">${escapeHtml(match[0])}</span>`;
      }
      lastIndex = regex.lastIndex;
    }

    const tail = processedText.slice(lastIndex);
    if( tail ) emitLiteralWithInc(tail, 'tail');

    while( incStack.length > 0 ) {
      incStack.pop();
      out += `</span>`;
    }

    return out;
  }

  bindInlinePlaceholderEvents()
  {
    this.app.placeholderGroups = new Map();
    const nodes = document.querySelectorAll('#inlineSnippet .ph');
    nodes.forEach(el => {
      const name = el.dataset.ph;
      if( name && name.trim() !== '' ) {
        if( ! this.app.placeholderGroups.has(name) ) this.app.placeholderGroups.set(name, []);
        this.app.placeholderGroups.get(name).push(el);
      }
    });

    let groupIndex = 0;
    this.app.placeholderGroups.forEach((group, name) => {
      if( group.length > 1 ) {
        let sharedDefault = '';
        for( const el of group ) {
          const defaultVal = el.dataset.default || '';
          if( defaultVal !== '' ) {
            sharedDefault = defaultVal;
            break;
          }
        }
        group.forEach(el => {
          el.dataset.default = sharedDefault;
          const currentText = (el.textContent || '').trim();
          if( currentText === '' || currentText === '…' || el.hasAttribute('data-ph-label') ) {
            el.textContent = sharedDefault;
          }
        });
      }

      // Every unique placeholder name gets a distinct color (same name = same color)
      const colorClass = `ph-group-${groupIndex % 8}`;
      group.forEach(el => {
        el.classList.remove('ph-group-0', 'ph-group-1', 'ph-group-2', 'ph-group-3',
                           'ph-group-4', 'ph-group-5', 'ph-group-6', 'ph-group-7');
        el.classList.add(colorClass);
      });
      groupIndex++;
    });

    const setGroupValue = (name, value) => {
      const group = this.app.placeholderGroups.get(name) || [];
      group.forEach(node => { node.textContent = value; });
      this.updateRenderedOutput();
    };

    const onFocus = (e) => {
      const el = e.currentTarget;
      const currentValue = (el.textContent || '').trim();
      const defaultValue = el.dataset.default || '';
      if( currentValue === defaultValue || currentValue === '' ) {
        el.dataset.edited = '0';
      }
      if( el.classList.contains('ph-choice') ) {
        this.openChoiceMenu(el);
      }
    };

    const onClick = (e) => {
      const el = e.currentTarget;
      if( el.classList.contains('ph-choice') ) {
        e.stopPropagation();
        e.preventDefault();
        el.focus();
      }
    };

    const onBlur = (e) => {
      const el = e.currentTarget;
      if( el.classList.contains('ph') ) {
        const name = el.dataset.ph;
        const edited = el.dataset.edited === '1';
        const defVal = el.dataset.default || '';
        let value = (el.textContent || '').trim();
        if( ! edited || value === '' ) value = defVal;
        setGroupValue(name, value);
      }
      else if( el.classList.contains('ph-literal') ) {
        this.updateRenderedOutput();
      }
      this.closeChoiceMenu();
    };

    const onInput = (e) => {
      const el = e.currentTarget;
      if( el.classList.contains('ph') ) {
        el.dataset.edited = '1';
        const name = el.dataset.ph;
        const value = el.textContent;
        const group = this.app.placeholderGroups.get(name) || [];
        group.forEach(node => { if( node !== el ) node.textContent = value; });
      }
      this.updateRenderedOutput();
    };

    const onKeyDown = (e) => {
      const el = e.currentTarget;
      if( el.classList.contains('ph-choice') ) {
        if( e.key === 'Enter' || e.key === ' ' ) {
          this.openChoiceMenu(el);
          e.preventDefault();
        }
      }
    };

    nodes.forEach(el => {
      const name = el.dataset.ph;
      if( name && name.trim() !== '' ) {
        el.addEventListener('focus', onFocus);
        el.addEventListener('blur', onBlur);
        el.addEventListener('keydown', onKeyDown);
        if( el.classList.contains('ph-text') ) el.addEventListener('input', onInput);
        if( el.classList.contains('ph-choice') ) el.addEventListener('click', onClick);
      }
      else {
        el.removeAttribute('tabindex');
      }
    });

    const literalNodes = document.querySelectorAll('#inlineSnippet .ph-literal');
    literalNodes.forEach(el => {
      el.addEventListener('input', onInput);
      el.addEventListener('keydown', onKeyDown);
    });

    const maybeCheckboxes = document.querySelectorAll('#inlineSnippet .maybe-checkbox');
    maybeCheckboxes.forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const maybeBlock = e.target.closest('.maybe-block');
        if( maybeBlock ) {
          const enabled = e.target.checked;
          maybeBlock.dataset.enabled = enabled ? 'true' : 'false';
          this.updateRenderedOutput();
        }
      });
    });
  }

  openChoiceMenu(el)
  {
    this.closeChoiceMenu();
    const menu = document.getElementById('phChoiceMenu');
    if( ! menu ) return;
    const choices = JSON.parse(el.dataset.choices || '[]');
    const name = el.dataset.ph;
    const rect = el.getBoundingClientRect();
    menu.innerHTML = choices.map(ch => `<button type="button" class="dropdown-item" data-value="${escapeHtml(ch)}">${escapeHtml(ch)}</button>`).join('');
    menu.style.display = 'block';
    menu.style.position = 'absolute';
    menu.style.left = (rect.left + window.scrollX) + 'px';
    menu.style.top = (rect.bottom + window.scrollY) + 'px';
    menu.style.zIndex = '1070';
    menu.classList.add('show');
    this.app._menuJustOpened = true;

    const buttons = menu.querySelectorAll('.dropdown-item');
    buttons.forEach((btn) => {
      btn.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const val = e.target.getAttribute('data-value');
        const group = this.app.placeholderGroups.get(name) || [];
        group.forEach(node => {
          node.textContent = val;
          node.dataset.edited = '1';
        });
        this.updateRenderedOutput();
        this.closeChoiceMenu();
      });
    });

    const clickOutside = (evt) => {
      if( this.app._menuJustOpened ) {
        this.app._menuJustOpened = false;
        return;
      }
      if( ! menu.contains(evt.target) && ! evt.target.closest('#phChoiceMenu') ) {
        this.closeChoiceMenu();
      }
    };

    this.app._choiceOutsideHandler = clickOutside;
    document.addEventListener('click', clickOutside);

    setTimeout(() => {
      this.app._menuJustOpened = false;
    }, 50);
  }

  closeChoiceMenu()
  {
    const menu = document.getElementById('phChoiceMenu');
    if( ! menu ) return;
    menu.classList.remove('show');
    menu.style.display = 'none';
    if( this.app._choiceOutsideHandler ) {
      document.removeEventListener('click', this.app._choiceOutsideHandler);
      this.app._choiceOutsideHandler = null;
    }
  }

  _buildUsageMetaHtml()
  {
    const s = this.app.currentSnippet;
    if( ! s ) return '';
    const parts = [];
    if( s.id ) {
      const scHtml = s.sc ? `<code class="usage-meta-sc">${s.sc}</code>` : '';
      parts.push(`<div class="usage-meta-id"><span class="usage-meta-label">ID</span> <code>${s.id}</code>${scHtml}</div>`);
    }
    if( s.short ) parts.push(`<div class="usage-meta-short">${s.short}</div>`);
    return parts.length ? `<div class="usage-meta">${parts.join('')}</div>` : '';
  }

  _buildUsageHtml(withInputs = false)
  {
    const s = this.app.currentSnippet;
    const usage = s?.usage ?? null;
    let html = this._buildUsageMetaHtml();

    if( usage && typeof usage === 'object' ) {
      if( usage.head )      html += `<div class="usage-head">${parseMd(usage.head)}</div>`;
      if( usage.maybe && typeof usage.maybe === 'object' ) {
        const cbTh = withInputs ? '<th class="maybe-cb-th"></th>' : '';
        const rows = Object.entries(usage.maybe)
          .map(([k, v]) => {
            const cbTd = withInputs
              ? `<td><input type="checkbox" class="maybe-table-cb" data-maybe-name="${escapeHtml(k)}" checked></td>`
              : '';
            return `<tr>${cbTd}<td><code>${k}</code></td><td>${v ?? ''}</td></tr>`;
          })
          .join('');
        html += `<div class="usage-meta usage-meta-vars"><table class="usage-vars-table"><thead><tr>${cbTh}<th>Maybe</th><th>Description</th></tr></thead><tbody>${rows}</tbody></table></div>`;
      }
      if( usage.vars && typeof usage.vars === 'object' ) {
        const thExtra = withInputs ? '<th class="var-input-th">Value</th>' : '';
        const rows = Object.entries(usage.vars)
          .map(([k, v]) => {
            const inputTd = withInputs
              ? `<td><input type="text" class="form-control form-control-sm var-input" data-var-name="${escapeHtml(k)}" placeholder="…"></td>`
              : '';
            return `<tr><td class="var-name-td"><code>${k}</code></td><td class="var-desc-td">${v ?? ''}</td>${inputTd}</tr>`;
          })
          .join('');
        html += `<div class="usage-meta usage-meta-vars"><table class="usage-vars-table"><thead><tr><th>Var</th><th>Description</th>${thExtra}</tr></thead><tbody>${rows}</tbody></table></div>`;
      }
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
      const colorStyle = color ? ` style="color:${color}"` : '';
      return `<li class="nav-item" role="presentation">
        <button class="nav-link usage-tab-btn${i === 0 ? ' active' : ''}" data-bs-toggle="tab"
          data-bs-target="#ut-${uid}-${i}" type="button" role="tab"${colorStyle}>${name}</button>
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

  toggleUsagePreview()
  {
    const textarea = document.getElementById('snippetUsage');
    const preview  = document.getElementById('usagePreview');
    if( ! textarea || ! preview ) return;

    const editFieldsRow = document.getElementById('editFieldsRow');
    if( editFieldsRow?.classList.contains('mobile-content-active') ) {
      editFieldsRow.classList.add('mobile-usage-active');
      editFieldsRow.classList.remove('mobile-content-active');
      document.getElementById('usageFieldPill')?.classList.add('active');
      document.getElementById('contentFieldPill')?.classList.remove('active');
    }

    const isActive = preview.style.display !== 'none';
    if( isActive ) {
      preview.style.display = 'none';
      textarea.style.display = '';
      this._setUsagePreviewIcon('bi-eye');
    }
    else {
      preview.innerHTML = this._buildUsageHtml();
      preview.style.display = '';
      textarea.style.display = 'none';
      this._setUsagePreviewIcon('bi-eye-slash');
    }
  }

  resetUsagePreview()
  {
    const textarea = document.getElementById('snippetUsage');
    const preview  = document.getElementById('usagePreview');
    if( textarea ) textarea.style.display = '';
    if( preview ) preview.style.display = 'none';
    this._setUsagePreviewIcon('bi-eye');
  }

  showUsagePreview()
  {
    const textarea = document.getElementById('snippetUsage');
    const preview  = document.getElementById('usagePreview');
    if( ! textarea || ! preview ) return;
    preview.innerHTML = this._buildUsageHtml();
    preview.style.display = '';
    textarea.style.display = 'none';
    this._setUsagePreviewIcon('bi-eye-slash');
  }

  _setUsagePreviewIcon(iconClass)
  {
    ['usagePreviewBtn', 'usagePreviewBtnMobile'].forEach(id => {
      const btn = document.getElementById(id);
      if( btn ) btn.querySelector('i').className = `bi ${iconClass}`;
    });
  }

  renderUsageInPreview()
  {
    const el = document.getElementById('renderUsage');
    if( ! el ) return;
    el.innerHTML = this._buildUsageHtml(true);
    this.bindVarInputEvents();
  }

  bindVarInputEvents()
  {
    const inputs = document.querySelectorAll('#renderUsage .var-input');
    let colorIdx = 0;
    inputs.forEach(input => {
      const name = input.dataset.varName;
      const group = this.app.placeholderGroups?.get(name) || [];
      let assignedGroup = -1;
      for( let i = 0; i < 8; i++ ) {
        if( group[0]?.classList.contains(`ph-group-${i}`) ) {
          assignedGroup = i;
          break;
        }
      }
      input.dataset.phGroup = assignedGroup !== -1 ? assignedGroup : (colorIdx++ % 8);
      input.addEventListener('input', (e) => {
        const name = e.target.dataset.varName;
        const value = e.target.value;
        const group = this.app.placeholderGroups?.get(name) || [];
        group.forEach(node => {
          node.textContent = value;
          node.dataset.edited = '1';
        });
        this.updateRenderedOutput();
      });
    });

    // Table maybe checkboxes → sync inline snippet block
    const maybeCbs = document.querySelectorAll('#renderUsage .maybe-table-cb');
    maybeCbs.forEach(cb => {
      cb.addEventListener('change', (e) => {
        const name = e.target.dataset.maybeName;
        const enabled = e.target.checked;
        let block = null;
        document.querySelectorAll('#inlineSnippet .maybe-block').forEach(b => {
          if( b.dataset.maybe === name ) block = b;
        });
        if( block ) {
          block.dataset.enabled = enabled ? 'true' : 'false';
          const inlineCb = block.querySelector('.maybe-checkbox');
          if( inlineCb ) inlineCb.checked = enabled;
          this.updateRenderedOutput();
        }
      });
    });

    // Inline maybe checkboxes → sync back to table checkboxes (two-way)
    const inlineCbs = document.querySelectorAll('#inlineSnippet .maybe-checkbox');
    inlineCbs.forEach(inlineCb => {
      inlineCb.addEventListener('change', (e) => {
        const block = e.target.closest('.maybe-block');
        if( ! block ) return;
        const name = block.dataset.maybe;
        maybeCbs.forEach(tableCb => {
          if( tableCb.dataset.maybeName === name ) tableCb.checked = e.target.checked;
        });
      });
    });
  }

  toggleRenderView()
  {
    const row = document.getElementById('renderRow');
    const btn = document.getElementById('renderViewToggleBtn');
    if( ! row || ! btn ) return;

    const showingUsage = row.classList.contains('render-usage-active');
    if( showingUsage ) {
      row.classList.remove('render-usage-active');
      row.classList.add('render-snippet-active');
      btn.querySelector('i').className = 'bi bi-card-text';
    }
    else {
      row.classList.remove('render-snippet-active');
      row.classList.add('render-usage-active');
      btn.querySelector('i').className = 'bi bi-braces';
    }
  }

  getCurrentPlaceholderValues()
  {
    const values = {};
    this.app.placeholderGroups.forEach((nodes, name) => {
      const el = nodes[0];
      const txt = (el.textContent || '').trim();
      values[name] = txt !== '' ? txt : (el.dataset.default || '');
    });
    return values;
  }

  async updateRenderedOutput()
  {
    if( ! this.app.currentSnippet ) return;
    const container = document.getElementById('inlineSnippet');
    if( ! container ) return;

    const extractText = (node) => {
      if( node.nodeType === Node.TEXT_NODE ) {
        return node.nodeValue || '';
      }
      else if( node.nodeType === Node.ELEMENT_NODE ) {
        const el = node;

        if( el.classList.contains('maybe-block') ) {
          const enabled = el.dataset.enabled === 'true';
          if( ! enabled ) return '';
          const content = el.querySelector('.maybe-content');
          if( content ) {
            let text = '';
            content.childNodes.forEach(child => {
              text += extractText(child);
            });
            return ' ' + text + ' ';
          }
          return '';
        }

        if( el.classList.contains('maybe-header') || el.classList.contains('maybe-end') ) {
          return '';
        }

        if( el.classList.contains('ph') || el.classList.contains('ph-literal') ) {
          return el.textContent || '';
        }

        if( el.classList.contains('inc-block') || el.classList.contains('maybe-content') ) {
          let text = '';
          el.childNodes.forEach(child => {
            text += extractText(child);
          });
          return text;
        }

        let text = '';
        el.childNodes.forEach(child => {
          text += extractText(child);
        });
        return text;
      }
      return '';
    };

    let parts = [];
    container.childNodes.forEach(node => {
      parts.push(extractText(node));
    });

    const rawText = parts.join('');
    this.app.renderedText = rawText
      .split(/\n{2,}/)
      .map(block => block.replace(/\n/g, ' ').replace(/ {2,}/g, ' ').trim())
      .filter(block => block.length > 0)
      .join('\n\n');

    const copyRenderedBtn = document.getElementById('copyRenderedBtn');
    if( copyRenderedBtn ) copyRenderedBtn.disabled = this.app.renderedText.length === 0;
  }

  async copyRenderedContent()
  {
    await this.updateRenderedOutput();
    if( ! this.app.renderedText ) return;

    const text = this.app.renderedText;
    let copied = false;

    try {
      if( navigator.clipboard && typeof navigator.clipboard.writeText === 'function' && (window.isSecureContext || location.hostname === 'localhost') ) {
        await navigator.clipboard.writeText(text);
        copied = true;
      }
    }
    catch( e1 ) {
      // fall through to fallback
    }

    if( ! copied ) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        ta.style.left = '-1000px';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if( ! ok ) throw new Error('execCommand(copy) returned false');
        copied = true;
      }
      catch( e2 ) {
        showError('Failed to copy content: ' + (e2?.message || 'Unknown error'));
        return;
      }
    }

    if( copied ) showSuccess('Content copied to clipboard');
  }
}
