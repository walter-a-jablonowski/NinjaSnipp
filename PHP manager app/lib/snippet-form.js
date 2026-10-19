// The fill-in form of a snippet: its composed content (see Renderer::compose) as an inline view
// with editable placeholders and a checkbox per MAYBE block, the maybe / vars tables of its
// usage, and the plain text the form results in.
//
// Used by the manager's preview (RenderController) and the Win app's fill view (win.php).
//
//   inline    element for the inline view
//   usage     element the tables are put in (tablesHtml), optional
//   menu      dropdown element for choice placeholders
//   onChange  called with the text after every change

class SnippetForm
{
  constructor({ inline, usage = null, menu = null, onChange = null })
  {
    this.inline   = inline;
    this.usage    = usage;
    this.menu     = menu;
    this.onChange = onChange;

    this.groups = new Map();     // placeholder name => [elements]
    this.text   = '';            // the result as plain text

    this._menuJustOpened = false;
    this._outsideHandler = null;
  }

  // Elements below a container, none when there is no container
  _all( container, selector )
  {
    return container ? [...container.querySelectorAll(selector)] : [];
  }

  render(composedText)
  {
    this.inline.innerHTML = this.buildInlineHtmlFromComposed(composedText);
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
    this.groups = new Map();
    const nodes = this._all(this.inline, '.ph');
    nodes.forEach(el => {
      const name = el.dataset.ph;
      if( name && name.trim() !== '' ) {
        if( ! this.groups.has(name) ) this.groups.set(name, []);
        this.groups.get(name).push(el);
      }
    });

    let groupIndex = 0;
    this.groups.forEach((group, name) => {
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
      const group = this.groups.get(name) || [];
      group.forEach(node => { node.textContent = value; });
      this.updateText();
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
        // After picking, focus stays on the element, so onFocus won't re-fire on the
        // next click. Open the menu explicitly so repeat clicks always work.
        this.openChoiceMenu(el);
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
        this.updateText();
      }
      this.closeChoiceMenu();
    };

    const onInput = (e) => {
      const el = e.currentTarget;
      if( el.classList.contains('ph') ) {
        el.dataset.edited = '1';
        const name = el.dataset.ph;
        const value = el.textContent;
        const group = this.groups.get(name) || [];
        group.forEach(node => { if( node !== el ) node.textContent = value; });
      }
      this.updateText();
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

    this._all(this.inline, '.ph-literal').forEach(el => {
      el.addEventListener('input', onInput);
      el.addEventListener('keydown', onKeyDown);
    });

    this._all(this.inline, '.maybe-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const maybeBlock = e.target.closest('.maybe-block');
        if( maybeBlock )
          this.setMaybeState(maybeBlock.dataset.maybe, e.target.checked);
      });
    });

    this.updateText();
  }

  // Sync state across every occurrence of a MAYBE area
  // The same name can appear in multiple inline blocks; all must stay in lockstep
  // with each other and with the maybe table row.
  setMaybeState( name, enabled )
  {
    const flag = enabled ? 'true' : 'false';

    this._all(this.inline, '.maybe-block').forEach(block => {
      if( block.dataset.maybe !== name ) return;
      block.dataset.enabled = flag;
      const cb = block.querySelector('.maybe-checkbox');
      if( cb && cb.checked !== enabled ) cb.checked = enabled;
    });

    this._all(this.usage, '.maybe-table-cb').forEach(tableCb => {
      if( tableCb.dataset.maybeName === name && tableCb.checked !== enabled )
        tableCb.checked = enabled;
    });

    this.updateText();
    this.updateVarRowVisibility();
  }

  // Sets a placeholder everywhere as if typed: all its inline elements and its var input
  setValue( name, value )
  {
    (this.groups.get(name) || []).forEach(node => {
      node.textContent    = value;
      node.dataset.edited = '1';
    });
    this._all(this.usage, '.var-input').forEach(input => {
      if( input.dataset.varName === name ) input.value = value;
    });
  }

  // Fills the form as if typed and clicked (the AI's form_fill): placeholder values, and
  // every MAYBE block on except the ones in maybeOff
  fill( values, maybeOff )
  {
    Object.entries(values).forEach(([name, value]) => this.setValue(name, value));

    const maybes = new Set( this._all(this.inline, '.maybe-block').map(block => block.dataset.maybe));
    maybes.forEach(name => this.setMaybeState(name, ! maybeOff.includes(name)));

    this.updateText();
  }

  openChoiceMenu(el)
  {
    this.closeChoiceMenu();
    const menu = this.menu;
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
    this._menuJustOpened = true;

    const buttons = menu.querySelectorAll('.dropdown-item');
    buttons.forEach((btn) => {
      btn.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        // Setting textContent doesn't fire an input event, so setValue() syncs the var input too
        this.setValue( name, e.target.getAttribute('data-value'));
        this.updateText();
        this.closeChoiceMenu();
      });
    });

    const clickOutside = (evt) => {
      if( this._menuJustOpened ) {
        this._menuJustOpened = false;
        return;
      }
      if( ! menu.contains(evt.target) ) {
        this.closeChoiceMenu();
      }
    };

    this._outsideHandler = clickOutside;
    document.addEventListener('click', clickOutside);

    setTimeout(() => {
      this._menuJustOpened = false;
    }, 50);
  }

  closeChoiceMenu()
  {
    const menu = this.menu;
    if( ! menu ) return;
    menu.classList.remove('show');
    menu.style.display = 'none';
    if( this._outsideHandler ) {
      document.removeEventListener('click', this._outsideHandler);
      this._outsideHandler = null;
    }
  }

  // --- Usage tables: a checkbox per MAYBE area, a value input per var ---

  _buildMissingIndicator(missing, kind)
  {
    if( ! missing.length ) return '';
    const title = `Missing in usage.${kind}: ${missing.join(', ')}`;
    return `<span class="usage-missing-indicator float-end text-warning" title="${escapeHtml(title)}"><i class="bi bi-exclamation-triangle-fill"></i></span>`;
  }

  // Indicator for an identifier defined in the usage table but never referenced in the snippet content
  _buildUnusedIndicator(used)
  {
    if( used ) return '';
    const title = 'Not used in snippet content';
    return `<span class="usage-unused-indicator text-warning" title="${escapeHtml(title)}"><i class="bi bi-exclamation-triangle-fill"></i></span>`;
  }

  // The maybe and vars tables of a usage (an object, see the file format), for the snippet content
  tablesHtml( usage, content )
  {
    if( ! usage || typeof usage !== 'object' ) return '';

    const contentMaybes = extractContentMaybes(content);
    const contentVars   = extractContentVars(content);
    let html = '';

    if( usage.maybe && typeof usage.maybe === 'object' ) {
      const defined = new Set(Object.keys(usage.maybe));
      const missing = [...contentMaybes].filter(n => ! defined.has(n));
      const indicator = this._buildMissingIndicator(missing, 'maybe');
      const rows = Object.entries(usage.maybe)
        .map(([k, v]) => {
          const unused = this._buildUnusedIndicator(contentMaybes.has(k));
          return `<tr><td><input type="checkbox" class="maybe-table-cb" data-maybe-name="${escapeHtml(k)}" checked></td><td><code>${escapeHtml(k)}</code>${unused}</td><td>${escapeHtml(v)}</td></tr>`;
        })
        .join('');
      html += `<div class="usage-meta usage-meta-vars"><table class="usage-vars-table"><thead><tr><th class="maybe-cb-th"></th><th>Maybe</th><th>Description${indicator}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }
    if( usage.vars && typeof usage.vars === 'object' ) {
      const defined = new Set(Object.keys(usage.vars));
      const missing = [...contentVars].filter(n => ! defined.has(n));
      const indicator = this._buildMissingIndicator(missing, 'vars');
      const rows = Object.entries(usage.vars)
        .map(([k, v]) => {
          const unused = this._buildUnusedIndicator(contentVars.has(k));
          return `<tr><td class="var-name-td"><code>${escapeHtml(k)}</code>${unused}</td><td class="var-desc-td">${escapeHtml(v)}</td><td><input type="text" class="form-control form-control-sm var-input" data-var-name="${escapeHtml(k)}" placeholder="…"></td></tr>`;
        })
        .join('');
      html += `<div class="usage-meta usage-meta-vars"><table class="usage-vars-table"><thead><tr><th>Var</th><th>Description</th><th class="var-input-th">Value${indicator}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }

    return html;
  }

  // After the tables were put in the usage element
  bindTables()
  {
    const inputs = this._all(this.usage, '.var-input');
    let colorIdx = 0;
    inputs.forEach(input => {
      const name = input.dataset.varName;
      const group = this.groups.get(name) || [];
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
        const group = this.groups.get(name) || [];
        group.forEach(node => {
          node.textContent = value;
          node.dataset.edited = '1';
        });
        this.updateText();
      });
    });

    // Table maybe checkboxes → sync all matching inline blocks (incl. duplicates) and table cbs
    // The inline→table direction is handled by the inline cb listener in bindInlinePlaceholderEvents.
    this._all(this.usage, '.maybe-table-cb').forEach(cb => {
      cb.addEventListener('change', (e) => {
        this.setMaybeState(e.target.dataset.maybeName, e.target.checked);
      });
    });

    // Inline placeholders → sync back to the var inputs (two-way)
    this._all(this.inline, '.ph').forEach(ph => {
      ph.addEventListener('input', (e) => {
        const name = e.target.dataset.ph;
        const value = (e.target.textContent || '').trim();
        inputs.forEach(input => {
          if( input.dataset.varName === name ) input.value = value;
        });
      });
    });

    this.updateVarRowVisibility();
  }

  updateVarRowVisibility()
  {
    // For each var row: hide if ALL its placeholders are inside disabled maybe-blocks
    // (at any level, an enabled inner block in a disabled outer one is hidden too)
    this._all(this.usage, '.var-input').forEach(input => {
      const name = input.dataset.varName;
      const phs  = this._all(this.inline, '.ph').filter(ph => ph.dataset.ph === name);
      const allHidden = phs.length > 0 && phs.every(ph => ph.closest('.maybe-block[data-enabled="false"]'));
      const row = input.closest('tr');
      if( row ) row.style.display = allHidden ? 'none' : '';
    });
  }

  // --- The result as plain text ---

  updateText()
  {
    const extractText = (node) => {
      if( node.nodeType === Node.TEXT_NODE ) {
        return node.nodeValue || '';
      }
      else if( node.nodeType === Node.ELEMENT_NODE ) {
        const el = node;

        // The composed text has a block's line break inside it (Renderer::processMaybeBlocks),
        // so a block is its content as it is: the text is the same as the PHP render() gives
        if( el.classList.contains('maybe-block') && el.dataset.enabled !== 'true' ) {
          return '';
        }

        if( el.classList.contains('maybe-header') || el.classList.contains('maybe-end') ) {
          return '';
        }

        if( el.classList.contains('ph') || el.classList.contains('ph-literal') ) {
          return el.textContent || '';
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
    this.inline.childNodes.forEach(node => {
      parts.push(extractText(node));
    });

    this.text = this.unwrap( parts.join(''));
    if( this.onChange ) this.onChange(this.text);
  }

  // Copy output: text blocks (split at blank lines) unwrapped, one blank line between them.
  // Mirrored by Renderer::unwrap(), tests/fixtures/unwrap.json runs against both.
  unwrap(text)
  {
    return text
      .split(/\n{2,}/)
      .map(block => this.unwrapBlock(block))
      .filter(block => block.length > 0)
      .join('\n\n');
  }

  // Joins soft wrapped lines of a text block, but keeps the line breaks of
  // structured lines (list items, headings, quotes, tables, code, indented lines)
  unwrapBlock( block )
  {
    const structuredRe = /^(?:[ \t]*(?:[-*+•]|\d+[.)])[ \t]|[ \t]*(?:#{1,6}[ \t]|>|\||```)|[ \t]+\S)/;

    // Squeeze inner runs of blanks, keep the indent (nested lists)
    const squeeze = (line) => {
      const indent = line.match(/^[ \t]*/)[0];
      return indent + line.slice(indent.length).replace(/[ \t]{2,}/g, ' ').trim();
    };

    const lines = block.split('\n').map(squeeze).filter(line => line.trim() !== '');   // squeeze keeps the indent of blank lines
    const out = [];

    lines.forEach(line => {
      const last = out.length > 0 ? out[out.length - 1] : null;
      if( last !== null && ! structuredRe.test(line) && ! structuredRe.test(last) )
        out[out.length - 1] = `${last} ${line}`;
      else
        out.push(line);
    });

    return out.join('\n');
  }
}
