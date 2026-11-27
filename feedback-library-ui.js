import { bindingContext, bindingCatalog, composedFeedback, sortedEntries, matchEntry,
    presetKey, entryId, normalizeEntry, moveEntry, reorderEntry } from './feedback-library.js';

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};
const contextLabel = context => `预设：${context.preset?.name || '未选择'}　·　角色：${context.character?.name || '未选择'}`;

const escapeHtml = text => String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Render inline Markdown while preserving prompt tags like <content> and highlighting {{user}} macros. */
function renderInlineMarkdown(escaped) {
    const stash = [];
    const hold = html => `\u0000${stash.push(html) - 1}\u0000`;
    let out = escaped;
    out = out.replace(/`([^`\n]+)`/g, (_, code) => hold(`<code>${code}</code>`));
    out = out.replace(/\{\{([^{}\n]+)\}\}/g, (_, macro) => hold(`<span class="ar-md-macro">{{${macro}}}</span>`));
    out = out.replace(/(&lt;\/?[A-Za-z][\w:-]*(?:\s[^&<>\n]*)?\/?&gt;)/g, (_, tag) => hold(`<span class="ar-md-tag">${tag}</span>`));
    out = out.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) =>
        hold(`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`));
    // Support bold even when wrapping Chinese punctuation like **反例：**
    out = out.replace(/\*\*([^\n*]+?)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/__([^\n_]+?)__/g, '<strong>$1</strong>');
    out = out.replace(/~~([^\n~]+?)~~/g, '<del>$1</del>');
    out = out.replace(/(^|[^\w*])\*([^\n*]+?)\*(?!\*)/g, '$1<em>$2</em>');
    return out.replace(/\u0000(\d+)\u0000/g, (_, index) => stash[Number(index)] ?? '');
}

/** Render a Markdown block/document into clean semantic HTML. */
function renderMarkdown(source) {
    const raw = String(source ?? '').replace(/\r\n?/g, '\n');
    if (!raw.trim()) return '<p class="ar-md-empty">点击此处开始输入…</p>';
    const lines = raw.split('\n');
    const html = [];
    let i = 0;

    const isBlockBoundary = line => {
        const trimmed = line.trim();
        return !trimmed
            || /^```/.test(trimmed)
            || /^#{1,6}\s+/.test(trimmed)
            || /^(?:---+|\*\*\*+|___+)$/.test(trimmed)
            || /^>\s?/.test(trimmed)
            || /^\s*[-*+]\s+/.test(line)
            || /^\s*\d+\.\s+/.test(line);
    };

    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();
        if (!trimmed) { i++; continue; }

        const fence = trimmed.match(/^```([\w-]*)\s*$/);
        if (fence) {
            i++;
            const codeLines = [];
            while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
                codeLines.push(lines[i]);
                i++;
            }
            if (i < lines.length) i++;
            const lang = fence[1] ? ` data-lang="${escapeHtml(fence[1])}"` : '';
            html.push(`<pre class="ar-md-codeblock"${lang}><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
            continue;
        }

        if (/^(?:---+|\*\*\*+|___+)$/.test(trimmed)) {
            html.push('<hr>');
            i++;
            continue;
        }

        const heading = trimmed.match(/^(#{1,6})\s+(.+?)\s*#*$/);
        if (heading) {
            const level = heading[1].length;
            html.push(`<h${level}>${renderInlineMarkdown(escapeHtml(heading[2]))}</h${level}>`);
            i++;
            continue;
        }

        if (/^>\s?/.test(trimmed)) {
            const quoteLines = [];
            while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
                quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
                i++;
            }
            html.push(`<blockquote>${renderMarkdown(quoteLines.join('\n'))}</blockquote>`);
            continue;
        }

        const listMatch = line.match(/^(\s*)(?:([-*+])|(\d+)\.)\s+(.*)$/);
        if (listMatch) {
            const stack = [];
            const closeTo = targetIndent => {
                while (stack.length > 0 && stack[stack.length - 1].indent > targetIndent) {
                    html.push(`</li></${stack.pop().tag}>`);
                }
            };
            while (i < lines.length) {
                const match = lines[i].match(/^(\s*)(?:([-*+])|(\d+)\.)\s+(.*)$/);
                if (!match) break;
                const indent = match[1].replace(/\t/g, '  ').length;
                const tag = match[3] ? 'ol' : 'ul';
                const startAttr = tag === 'ol' && match[3] !== '1' ? ` start="${Number(match[3])}"` : '';
                const text = renderInlineMarkdown(escapeHtml(match[4]));
                if (!stack.length || indent > stack[stack.length - 1].indent) {
                    html.push(`<${tag}${startAttr}><li>${text}`);
                    stack.push({ indent, tag });
                } else {
                    closeTo(indent);
                    const top = stack[stack.length - 1];
                    if (top && top.tag === tag) {
                        html.push(`</li><li>${text}`);
                    } else if (top) {
                        html.push(`</li></${stack.pop().tag}><${tag}${startAttr}><li>${text}`);
                        stack.push({ indent, tag });
                    } else {
                        html.push(`<${tag}${startAttr}><li>${text}`);
                        stack.push({ indent, tag });
                    }
                }
                i++;
            }
            while (stack.length) html.push(`</li></${stack.pop().tag}>`);
            continue;
        }

        const para = [];
        while (i < lines.length && !isBlockBoundary(lines[i])) {
            para.push(renderInlineMarkdown(escapeHtml(lines[i].trimEnd())));
            i++;
        }
        if (para.length) html.push(`<p>${para.join('<br>')}</p>`);
        else i++;
    }
    return html.join('');
}

/**
 * Losslessly split a Markdown document into editable blocks while preserving
 * the exact separator (`sep`) after every block so joinBlocks(splitBlocks(s)) === s.
 */
function splitMarkdownBlocks(source) {
    const raw = String(source ?? '').replace(/\r\n?/g, '\n');
    if (!raw) return [{ raw: '', sep: '' }];
    const lines = raw.split('\n');
    const blocks = [];
    let i = 0;

    const lineKind = line => {
        const trimmed = line.trim();
        if (!trimmed) return 'blank';
        if (/^```/.test(trimmed)) return 'fence';
        if (/^#{1,6}\s+/.test(trimmed)) return 'heading';
        if (/^(?:---+|\*\*\*+|___+)$/.test(trimmed)) return 'hr';
        if (/^>\s?/.test(trimmed)) return 'quote';
        if (/^\s*(?:[-*+]|\d+\.)\s+/.test(line)) return 'list';
        return 'para';
    };

    // Preserve any leading blank lines inside the first block's raw text.
    const leadingBlanks = [];
    while (i < lines.length && lineKind(lines[i]) === 'blank') {
        leadingBlanks.push(lines[i]);
        i++;
    }
    if (i >= lines.length) return [{ raw, sep: '' }];

    while (i < lines.length) {
        const startLines = leadingBlanks.length ? leadingBlanks.splice(0) : [];
        const kind = lineKind(lines[i]);
        if (kind === 'fence') {
            startLines.push(lines[i++]);
            while (i < lines.length) {
                startLines.push(lines[i]);
                if (/^```\s*$/.test(lines[i].trim())) { i++; break; }
                i++;
            }
        } else if (kind === 'heading' || kind === 'hr') {
            startLines.push(lines[i++]);
        } else if (kind === 'quote') {
            while (i < lines.length && lineKind(lines[i]) === 'quote') startLines.push(lines[i++]);
        } else if (kind === 'list') {
            while (i < lines.length && lineKind(lines[i]) === 'list') startLines.push(lines[i++]);
        } else {
            while (i < lines.length && lineKind(lines[i]) === 'para') startLines.push(lines[i++]);
        }

        // Capture exact separator up to the next non-blank line (or EOF).
        let sep = '';
        if (i < lines.length) {
            const blanks = [];
            while (i < lines.length && lineKind(lines[i]) === 'blank') {
                blanks.push(lines[i++]);
            }
            if (i < lines.length) {
                sep = '\n' + blanks.map(b => `${b}\n`).join('');
            } else if (blanks.length) {
                sep = '\n' + blanks.join('\n');
            }
        }
        blocks.push({ raw: startLines.join('\n'), sep });
    }
    return blocks;
}

const joinMarkdownBlocks = blocks => blocks.map(block => `${block.raw}${block.sep}`).join('');

function autoSizeTextarea(textarea) {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.max(30, textarea.scrollHeight)}px`;
}

export function createFeedbackLibraryUI({ getSettings, createMenu, onChange, onOpen }) {
    const summaries = new Set();
    const menu = createMenu();
    let dialog, selected, query = '', filter = 'all', lastDeleted;
    let listSignature, bindingsSignature, disposed = false, mobileView = 'list';
    let sourceMode = false;
    let blocks = [];
    let editingBlockIndex = -1;
    let renderedDocKey = '';

    const isMobile = () => globalThis.matchMedia?.('(max-width: 700px)').matches ?? false;

    function updateCount(text) {
        const countNode = dialog?.querySelector('[data-content-count]');
        if (countNode) countNode.textContent = `${String(text ?? '').length} 字`;
    }

    function commitBlocksToEntry() {
        const entry = current();
        if (!entry) return;
        const nextText = joinMarkdownBlocks(blocks);
        if (entry.content !== nextText) {
            entry.content = nextText;
            renderedDocKey = `${entry.id}\u0000${entry.content}`;
            updateCount(entry.content);
            persist();
        }
    }

    function renderBlockEditor(forceRebuild = false) {
        if (!dialog) return;
        const entry = current();
        const surface = dialog.querySelector('[data-md-surface]');
        const sourceBox = dialog.querySelector('[data-content]');
        const sourceBtn = dialog.querySelector('[data-source-toggle]');
        if (!surface || !sourceBox) return;

        if (sourceBtn) {
            sourceBtn.setAttribute('aria-pressed', String(sourceMode));
            sourceBtn.title = sourceMode ? '返回实时 Markdown 排版编辑' : '切换到整篇纯文本源码（方便全选复制）';
        }
        surface.hidden = sourceMode;
        sourceBox.hidden = !sourceMode;

        const text = entry?.content ?? '';
        updateCount(text);
        if (sourceMode) {
            if (document.activeElement !== sourceBox) sourceBox.value = text;
            return;
        }

        const key = `${entry?.id ?? ''}\u0000${text}`;
        if (!forceRebuild && key === renderedDocKey && editingBlockIndex < 0) return;
        if (forceRebuild || key !== renderedDocKey) {
            blocks = splitMarkdownBlocks(text);
            renderedDocKey = key;
        }

        const prevScroll = surface.scrollTop;
        const frag = document.createDocumentFragment();
        blocks.forEach((block, index) => {
            const item = el('div', 'ar-live-block');
            item.dataset.blockIndex = String(index);
            if (index === editingBlockIndex) {
                item.classList.add('is-editing');
                const ta = el('textarea', 'text_pole ar-live-textarea');
                ta.value = block.raw;
                ta.rows = 1;
                ta.spellcheck = false;
                ta.placeholder = index === 0 && blocks.length === 1 ? '写下希望这一版如何修改…（支持 Markdown 标题、加粗、引用与列表）' : '输入 Markdown 内容…';
                ta.addEventListener('input', () => {
                    blocks[index].raw = ta.value;
                    autoSizeTextarea(ta);
                    commitBlocksToEntry();
                });
                ta.addEventListener('keydown', event => {
                    if (event.isComposing) return;
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        ta.blur();
                        return;
                    }
                    if (event.key === 'ArrowUp' && ta.selectionStart === 0 && ta.selectionEnd === 0 && index > 0) {
                        event.preventDefault();
                        openBlockForEdit(index - 1, 'end');
                        return;
                    }
                    if (event.key === 'ArrowDown' && ta.selectionStart === ta.value.length && ta.selectionEnd === ta.value.length && index < blocks.length - 1) {
                        event.preventDefault();
                        openBlockForEdit(index + 1, 'start');
                        return;
                    }
                    if (event.key === 'Backspace' && ta.selectionStart === 0 && ta.selectionEnd === 0 && index > 0) {
                        event.preventDefault();
                        const prevLen = blocks[index - 1].raw.length;
                        blocks[index - 1].raw = blocks[index - 1].raw + blocks[index].raw;
                        blocks[index - 1].sep = blocks[index].sep;
                        blocks.splice(index, 1);
                        editingBlockIndex = index - 1;
                        commitBlocksToEntry();
                        renderBlockEditor(false);
                        focusActiveBlock(prevLen);
                    }
                });
                ta.addEventListener('blur', () => {
                    // Defer slightly so clicking another block opens it cleanly without double-flashing.
                    setTimeout(() => {
                        if (!dialog || editingBlockIndex !== index) return;
                        if (document.activeElement && dialog.querySelector('.ar-live-textarea') === document.activeElement) return;
                        editingBlockIndex = -1;
                        // Re-split in case user typed blank lines / pasted multiple blocks.
                        renderBlockEditor(true);
                    }, 120);
                });
                item.append(ta);
            } else {
                const view = el('div', 'ar-live-view');
                view.innerHTML = renderMarkdown(block.raw);
                view.addEventListener('click', event => {
                    if (event.target.closest('a')) return;
                    if (globalThis.getSelection?.()?.toString()) return;
                    openBlockForEdit(index, 'end');
                });
                item.append(view);
            }
            frag.append(item);
        });

        // Clickable tail area to append a new block naturally like Notion/Typora.
        const tail = el('button', 'ar-live-tail');
        tail.type = 'button';
        tail.textContent = blocks.length === 1 && !blocks[0].raw.trim() ? '' : '点击此处继续输入新段落…';
        tail.addEventListener('click', () => {
            if (!blocks.length || blocks[blocks.length - 1].raw.trim()) {
                if (blocks.length && !blocks[blocks.length - 1].sep) {
                    blocks[blocks.length - 1].sep = '\n\n';
                }
                blocks.push({ raw: '', sep: '' });
            }
            openBlockForEdit(blocks.length - 1, 'end');
        });
        frag.append(tail);

        surface.replaceChildren(frag);
        surface.scrollTop = prevScroll;
        const activeTa = surface.querySelector('.ar-live-textarea');
        if (activeTa) autoSizeTextarea(activeTa);
    }

    function focusActiveBlock(caret = 'end') {
        const ta = dialog?.querySelector('.ar-live-textarea');
        if (!ta) return;
        autoSizeTextarea(ta);
        ta.focus({ preventScroll: true });
        const pos = typeof caret === 'number' ? caret : caret === 'start' ? 0 : ta.value.length;
        ta.setSelectionRange(pos, pos);
        ta.scrollIntoView({ block: 'nearest' });
    }

    function openBlockForEdit(index, caret = 'end') {
        if (!dialog || sourceMode) return;
        // Re-split current text first if switching from another edited block that may have gained blank lines.
        const entry = current();
        if (entry && editingBlockIndex >= 0 && editingBlockIndex !== index) {
            const rawJoined = joinMarkdownBlocks(blocks);
            if (rawJoined !== entry.content) {
                entry.content = rawJoined;
                persist();
            }
        }
        editingBlockIndex = Math.max(0, Math.min(index, blocks.length - 1));
        renderBlockEditor(false);
        focusActiveBlock(caret);
    }

    function setMobileView(view) {
        mobileView = view === 'editor' ? 'editor' : 'list';
        if (!dialog) return;
        dialog.dataset.mobileView = mobileView;
        if (mobileView === 'editor') {
            const editorWrap = dialog.querySelector('.auto-rewrite-library-editor-wrap');
            if (editorWrap) editorWrap.scrollTop = 0;
            if (isMobile()) {
                const options = dialog.querySelector('.auto-rewrite-entry-options');
                if (options) options.open = false;
            }
        }
    }
    const entries = () => getSettings().feedbackEntries;
    const current = () => entries().find(entry => entry.id === selected);
    const persist = () => { onChange(); sync(); };

    function summary() {
        const root = el('section', 'auto-rewrite-library-summary');
        root.dataset.feedbackLibrary = '';
        root.innerHTML = `<div class="auto-rewrite-library-summary-heading"><div><i class="fa-solid fa-book-bookmark" aria-hidden="true"></i><b>修改意见仓库</b><span class="auto-rewrite-library-count" data-count></span></div><button type="button" class="auto-rewrite-library-manage"><i class="fa-solid fa-sliders" aria-hidden="true"></i>打开仓库</button></div>
            <div class="auto-rewrite-library-active" data-active></div>
            <details class="auto-rewrite-library-preview"><summary>预览修改意见</summary><p class="auto-rewrite-library-context" data-context></p><pre data-preview></pre></details>`;
        root.querySelector('button').addEventListener('click', () => open());
        summaries.add(root);
        updateSummary(root, composedFeedback(getSettings()));
        return root;
    }

    function updateSummary(root, composition) {
        const signature = JSON.stringify([contextLabel(composition.context), composition.entries.map(entry => [entry.id, entry.name, entry.order])]);
        if (root.dataset.signature !== signature) {
            root.dataset.signature = signature;
            root.querySelector('[data-count]').textContent = `${composition.entries.length} 条生效`;
            root.querySelector('[data-context]').textContent = contextLabel(composition.context);
            const active = root.querySelector('[data-active]');
            active.replaceChildren(...composition.entries.map(entry => {
                const button = el('button', 'auto-rewrite-library-active-chip');
                button.type = 'button';
                button.textContent = entry.name || '未命名条目';
                button.addEventListener('click', () => open(entry.id));
                return button;
            }));
            if (!composition.entries.length) active.append(el('p', 'auto-rewrite-library-empty-inline', '暂无生效条目，请启用常驻条目或设置预设、角色绑定。'));
        }
        const preview = root.querySelector('[data-preview]');
        if (preview.textContent !== composition.text) preview.textContent = composition.text || '当前组合为空';
    }

    function select(id) {
        menu.close(); selected = id; bindingsSignature = null; editingBlockIndex = -1; renderedDocKey = '';
        if (isMobile()) setMobileView('editor');
        sync();
    }

    function add() {
        const entry = normalizeEntry({ name: '新修改意见', order: 3, always: true });
        entries().push(entry); selected = entry.id; query = ''; filter = 'all'; editingBlockIndex = -1; renderedDocKey = '';
        if (dialog) dialog.querySelector('[data-search]').value = '';
        setMobileView('editor');
        persist();
        dialog?.querySelector('[data-name]')?.focus();
    }

    function remove() {
        const entry = current();
        if (!entry) return;
        const index = entries().indexOf(entry);
        lastDeleted = { entry, index };
        entries().splice(index, 1);
        selected = sortedEntries(getSettings())[0]?.id;
        editingBlockIndex = -1; renderedDocKey = '';
        if (isMobile()) setMobileView('list');
        persist();
    }

    function undo() {
        if (!lastDeleted) return;
        entries().splice(Math.min(lastDeleted.index, entries().length), 0, lastDeleted.entry);
        selected = lastDeleted.entry.id; lastDeleted = null; editingBlockIndex = -1; renderedDocKey = ''; persist();
    }

    function bind(kind, value) {
        const entry = current();
        if (!entry || !value) return;
        entry.always = false;
        const key = kind === 'presets' ? presetKey : item => item.avatar;
        if (!entry[kind].some(item => key(item) === key(value))) entry[kind].push(kind === 'presets'
            ? { api: value.api, name: value.name } : { avatar: value.avatar, name: value.name });
        persist();
    }

    function chooseBinding(kind, anchor) {
        const entry = current();
        if (!entry) return;
        const catalog = bindingCatalog();
        const choices = kind === 'presets' ? catalog.presets : catalog.characters;
        const key = kind === 'presets' ? presetKey : item => item.avatar;
        const available = choices.filter(item => !entry[kind].some(bound => key(bound) === key(item)));
        if (!available.length) { globalThis.toastr?.info('没有更多可绑定项，也可先载入目标预设或角色，再绑定当前项。'); return; }
        menu.open({ anchor, items: available.map(item => ({ value: key(item), label: item.name,
            tag: kind === 'presets' ? item.label : '', sub: kind === 'characters' ? item.avatar : '' })), value: '',
        onPick: value => { const item = available.find(candidate => key(candidate) === value); if (item) bind(kind, item); } });
    }

    function exportLibrary() {
        const data = { type: 'sillytavern-auto-rewrite-feedback', version: 1, entries: entries() };
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        const link = el('a'); link.href = url; link.download = 'rewrite-feedback-library.json';
        document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    async function importLibrary(file) {
        if (!file) return;
        try {
            if (file.size > 10 * 1024 * 1024) throw new Error('文件超过 10 MiB，请拆分后导入。');
            const data = JSON.parse(await file.text());
            if (data?.type !== 'sillytavern-auto-rewrite-feedback' || data.version !== 1 || !Array.isArray(data.entries)
                || !data.entries.every(entry => entry && typeof entry.name === 'string' && typeof entry.content === 'string')) {
                throw new Error('请选择此插件导出的修改意见仓库 JSON 文件。');
            }
            if (disposed) return;
            const added = data.entries.map(entry => normalizeEntry({ ...entry, id: entryId() }));
            entries().push(...added); selected = added[0]?.id ?? selected;
            query = ''; filter = 'all'; editingBlockIndex = -1; renderedDocKey = '';
            if (dialog) dialog.querySelector('[data-search]').value = '';
            persist(); globalThis.toastr?.success(`已追加导入 ${added.length} 条修改意见。`);
        } catch (error) { globalThis.toastr?.error(error.message); }
    }

    /** Pointer-based vertical drag reordering for sidebar rows (desktop & touch). */
    function setupListDrag(shell) {
        const list = shell.querySelector('[data-list]');
        let drag = null;
        let suppressClickUntil = 0;

        const clearIndicators = () => {
            for (const row of list.querySelectorAll('.auto-rewrite-library-row')) {
                row.classList.remove('is-drop-before', 'is-drop-after');
            }
        };

        const cleanupDrag = () => {
            if (!drag) return;
            if (drag.scrollFrame) cancelAnimationFrame(drag.scrollFrame);
            drag.row?.classList.remove('is-dragging');
            drag.ghost?.remove();
            list.classList.remove('is-reordering');
            clearIndicators();
            window.removeEventListener('pointermove', onPointerMove, true);
            window.removeEventListener('pointerup', onPointerUp, true);
            window.removeEventListener('pointercancel', onPointerCancel, true);
            drag = null;
        };

        const updateDropTarget = clientY => {
            clearIndicators();
            const rows = [...list.querySelectorAll('.auto-rewrite-library-row')]
                .filter(row => row.dataset.entryId && row.dataset.entryId !== drag.entryId);
            if (!rows.length) { drag.targetId = null; drag.position = null; return; }
            let targetRow = rows[rows.length - 1];
            let position = 'after';
            for (const row of rows) {
                const rect = row.getBoundingClientRect();
                const mid = rect.top + rect.height / 2;
                if (clientY < mid) {
                    targetRow = row;
                    position = 'before';
                    break;
                }
            }
            drag.targetId = targetRow.dataset.entryId;
            drag.position = position;
            targetRow.classList.add(position === 'before' ? 'is-drop-before' : 'is-drop-after');
        };

        const tickAutoScroll = () => {
            if (!drag?.active) return;
            const rect = list.getBoundingClientRect();
            const edge = 36;
            let delta = 0;
            if (drag.lastY < rect.top + edge) delta = -Math.max(3, Math.round((rect.top + edge - drag.lastY) / 4));
            else if (drag.lastY > rect.bottom - edge) delta = Math.max(3, Math.round((drag.lastY - (rect.bottom - edge)) / 4));
            if (delta !== 0) {
                list.scrollTop += delta;
                updateDropTarget(drag.lastY);
            }
            drag.scrollFrame = requestAnimationFrame(tickAutoScroll);
        };

        const startActiveDrag = event => {
            drag.active = true;
            const rect = drag.row.getBoundingClientRect();
            const shellRect = shell.getBoundingClientRect();
            drag.baseLeft = shellRect.left + shell.clientLeft;
            drag.baseTop = shellRect.top + shell.clientTop;
            drag.offsetY = event.clientY - rect.top;
            const ghost = drag.row.cloneNode(true);
            ghost.classList.remove('is-drop-before', 'is-drop-after');
            ghost.classList.add('auto-rewrite-drag-ghost');
            ghost.style.width = `${rect.width}px`;
            ghost.style.left = `${rect.left - drag.baseLeft}px`;
            ghost.style.top = `${rect.top - drag.baseTop}px`;
            shell.append(ghost);
            drag.ghost = ghost;
            drag.row.classList.add('is-dragging');
            list.classList.add('is-reordering');
            drag.scrollFrame = requestAnimationFrame(tickAutoScroll);
        };

        const onPointerMove = event => {
            if (!drag || event.pointerId !== drag.pointerId) return;
            drag.lastY = event.clientY;
            if (!drag.active) {
                if (Math.abs(event.clientY - drag.startY) < 6 && Math.abs(event.clientX - drag.startX) < 6) return;
                if (event.pointerType === 'touch' && !drag.fromHandle) { cleanupDrag(); return; }
                startActiveDrag(event);
            }
            event.preventDefault();
            if (drag.ghost) drag.ghost.style.top = `${event.clientY - drag.offsetY - drag.baseTop}px`;
            updateDropTarget(event.clientY);
        };

        const onPointerUp = event => {
            if (!drag || event.pointerId !== drag.pointerId) return;
            const { active, entryId: dragId, targetId, position } = drag;
            cleanupDrag();
            if (!active) return;
            suppressClickUntil = Date.now() + 250;
            if (dragId && targetId && position) {
                if (reorderEntry(getSettings(), dragId, targetId, position)) {
                    persist();
                }
            }
        };

        const onPointerCancel = event => {
            if (!drag || event.pointerId !== drag.pointerId) return;
            cleanupDrag();
        };

        list.addEventListener('pointerdown', event => {
            if (event.button !== 0 && event.pointerType === 'mouse') return;
            const row = event.target.closest('.auto-rewrite-library-row[data-entry-id]');
            if (!row) return;
            if (event.target.closest('.auto-rewrite-quick-toggle')) return;
            const fromHandle = Boolean(event.target.closest('.auto-rewrite-drag-handle'));
            if (event.pointerType === 'touch' && !fromHandle) return;
            if (list.querySelectorAll('.auto-rewrite-library-row[data-entry-id]').length < 2) return;
            if (fromHandle) event.preventDefault();
            drag = {
                pointerId: event.pointerId,
                row,
                entryId: row.dataset.entryId,
                fromHandle,
                startX: event.clientX,
                startY: event.clientY,
                lastY: event.clientY,
                offsetY: 0,
                active: false,
                ghost: null,
                targetId: null,
                position: null,
                scrollFrame: 0,
            };
            window.addEventListener('pointermove', onPointerMove, true);
            window.addEventListener('pointerup', onPointerUp, true);
            window.addEventListener('pointercancel', onPointerCancel, true);
        });

        list.addEventListener('click', event => {
            if (Date.now() < suppressClickUntil) {
                event.preventDefault();
                event.stopPropagation();
            }
        }, true);

        return cleanupDrag;
    }

    function open(id) {
        if (disposed) return;
        if (id) { selected = id; query = ''; filter = 'all'; }
        if (dialog) {
            if (id) {
                dialog.querySelector('[data-search]').value = '';
                if (isMobile()) setMobileView('editor');
            }
            editingBlockIndex = -1; renderedDocKey = '';
            sync(); dialog.focus(); return;
        }
        onOpen?.();
        selected = entries().some(entry => entry.id === selected) ? selected : sortedEntries(getSettings())[0]?.id;
        mobileView = id && selected ? 'editor' : 'list';
        listSignature = null; bindingsSignature = null; editingBlockIndex = -1; renderedDocKey = '';
        const shell = el('dialog', 'auto-rewrite-dialog auto-rewrite-library-dialog');
        shell.dataset.mobileView = mobileView;
        shell.setAttribute('aria-label', '修改意见仓库');
        shell.innerHTML = `<header class="auto-rewrite-library-heading"><div class="auto-rewrite-library-heading-main"><button type="button" class="auto-rewrite-library-back" data-mobile-back aria-label="返回条目列表"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i><span>列表</span></button><h3 class="auto-rewrite-library-title-list">修改意见仓库</h3><h3 class="auto-rewrite-library-title-editor">编辑条目</h3></div><div class="auto-rewrite-library-heading-actions"><button type="button" data-import title="追加导入条目" aria-label="导入仓库"><i class="fa-solid fa-file-import" aria-hidden="true"></i></button><button type="button" data-export title="导出全部条目" aria-label="导出仓库"><i class="fa-solid fa-file-export" aria-hidden="true"></i></button><button type="button" class="is-primary" data-add><i class="fa-solid fa-plus" aria-hidden="true"></i>新建</button><button type="button" data-close aria-label="关闭仓库"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div></header>
            <div class="auto-rewrite-library-layout"><aside class="auto-rewrite-library-sidebar"><div class="auto-rewrite-library-search"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><input type="search" data-search placeholder="搜索名称或内容" aria-label="搜索修改意见"></div><div class="auto-rewrite-library-filters"><button type="button" data-filter="all">全部条目</button><button type="button" data-filter="active">当前生效</button></div><div class="auto-rewrite-library-list" data-list></div><p class="auto-rewrite-library-sort-note">按住条目或左侧把手可上下拖动排序</p></aside>
            <main class="auto-rewrite-library-editor-wrap"><div class="auto-rewrite-library-empty" data-empty><i class="fa-solid fa-book-open" aria-hidden="true"></i><b>保存一套可复用的修改意见</b><span>创建条目，再设置常驻或预设、角色绑定。</span><button type="button" data-create-first>新建条目</button></div><div class="auto-rewrite-library-editor" data-editor>
            <div class="auto-rewrite-library-entry-heading"><input class="text_pole" type="text" data-name placeholder="条目名称" aria-label="条目名称"><label class="auto-rewrite-quick-toggle"><input type="checkbox" data-enabled><span>启用</span></label></div>
            <div class="auto-rewrite-library-content-box">
              <div class="auto-rewrite-content-toolbar">
                <span class="auto-rewrite-content-title">修改意见<small class="auto-rewrite-content-count" data-content-count>0 字</small><small class="auto-rewrite-content-tip">点击任意段落直接编辑</small></span>
                <button type="button" class="auto-rewrite-source-toggle" data-source-toggle aria-pressed="false" title="切换到整篇纯文本源码（方便全选复制）"><i class="fa-solid fa-code" aria-hidden="true"></i><span>源码</span></button>
              </div>
              <div class="ar-live-surface" data-md-surface></div>
              <textarea class="text_pole auto-rewrite-source-input" data-content rows="9" placeholder="写下希望这一版如何修改…" spellcheck="false" aria-label="修改意见源码" hidden></textarea>
            </div>
            <details open class="auto-rewrite-entry-options"><summary class="auto-rewrite-disclosure"><b>条目设置</b><span data-scope-label></span></summary>            <div class="auto-rewrite-library-entry-tools"><label>顺序<input class="text_pole" type="number" min="-9999" max="9999" step="1" data-order aria-label="注入顺序"></label><div><button type="button" data-up title="上移条目" aria-label="上移条目"><i class="fa-solid fa-arrow-up" aria-hidden="true"></i></button><button type="button" data-down title="下移条目" aria-label="下移条目"><i class="fa-solid fa-arrow-down" aria-hidden="true"></i></button><button type="button" data-duplicate title="复制条目" aria-label="复制条目"><i class="fa-regular fa-copy" aria-hidden="true"></i></button><button type="button" data-delete title="删除条目，可撤销" aria-label="删除条目"><i class="fa-regular fa-trash-can" aria-hidden="true"></i></button></div></div>
            <div class="auto-rewrite-library-scope" role="group" aria-label="生效范围"><button type="button" data-scope="always"><i class="fa-solid fa-thumbtack" aria-hidden="true"></i>常驻</button><button type="button" data-scope="bound"><i class="fa-solid fa-link" aria-hidden="true"></i>绑定预设 / 角色</button></div>
            <section class="auto-rewrite-library-bindings" data-bindings><p data-context></p><div class="auto-rewrite-library-binding-group"><div><b>预设绑定</b><span><button type="button" data-current-preset>绑定当前预设</button><button type="button" data-add-preset aria-haspopup="listbox" aria-expanded="false" title="选择更多预设" aria-label="添加预设绑定"><i class="fa-solid fa-plus" aria-hidden="true"></i></button></span></div><div class="auto-rewrite-library-binding-chips" data-presets></div></div><div class="auto-rewrite-library-binding-group"><div><b>角色绑定</b><span><button type="button" data-current-character>绑定当前角色</button><button type="button" data-add-character aria-haspopup="listbox" aria-expanded="false" title="选择更多角色" aria-label="添加角色绑定"><i class="fa-solid fa-plus" aria-hidden="true"></i></button></span></div><div class="auto-rewrite-library-binding-chips" data-characters></div></div><div class="auto-rewrite-library-match"><button type="button" data-match="any">任一绑定匹配</button><button type="button" data-match="all">预设与角色同时匹配</button></div><p data-match-help></p></section>
</details></div></main></div>
            <footer class="auto-rewrite-library-footer"><div class="auto-rewrite-library-undo" data-undo-bar hidden><span data-undo-text></span><button type="button" data-undo>撤销删除</button></div><details class="auto-rewrite-library-preview"><summary><span>当前组合预览</span><small data-composed-count></small></summary><pre data-composed></pre></details></footer><input type="file" data-file accept=".json,application/json" hidden>`;
        dialog = shell;
        const cleanupDrag = setupListDrag(shell);
        const button = (selector, handler) => shell.querySelector(selector).addEventListener('click', handler);
        button('[data-close]', () => shell.close()); button('[data-add]', add); button('[data-create-first]', add);
        button('[data-mobile-back]', () => { menu.close(); setMobileView('list'); sync(); });
        button('[data-delete]', remove); button('[data-undo]', undo); button('[data-export]', exportLibrary);
        button('[data-import]', () => shell.querySelector('[data-file]').click());
        button('[data-source-toggle]', () => {
            sourceMode = !sourceMode;
            editingBlockIndex = -1;
            renderedDocKey = '';
            renderBlockEditor(true);
            if (sourceMode) shell.querySelector('[data-content]')?.focus();
        });
        shell.querySelector('[data-file]').addEventListener('change', event => { void importLibrary(event.target.files?.[0]); event.target.value = ''; });
        button('[data-up]', () => { if (current()) { moveEntry(getSettings(), selected, -1); persist(); } });
        button('[data-down]', () => { if (current()) { moveEntry(getSettings(), selected, 1); persist(); } });
        button('[data-duplicate]', () => {
            const entry = current(); if (!entry) return;
            const copy = normalizeEntry({ ...structuredClone(entry), id: entryId(), name: `${entry.name || '未命名条目'} · 副本`, enabled: false });
            entries().splice(entries().indexOf(entry) + 1, 0, copy); selected = copy.id; editingBlockIndex = -1; renderedDocKey = ''; persist();
        });
        button('[data-current-preset]', () => bind('presets', bindingContext().preset));
        button('[data-current-character]', () => bind('characters', bindingContext().character));
        button('[data-add-preset]', event => chooseBinding('presets', event.currentTarget));
        button('[data-add-character]', event => chooseBinding('characters', event.currentTarget));
        for (const node of shell.querySelectorAll('[data-scope]')) node.addEventListener('click', () => { const entry = current(); if (entry) { entry.always = node.dataset.scope === 'always'; persist(); } });
        for (const node of shell.querySelectorAll('[data-match]')) node.addEventListener('click', () => { const entry = current(); if (entry) { entry.match = node.dataset.match; persist(); } });
        for (const key of ['name', 'content', 'order', 'enabled']) shell.querySelector(`[data-${key}]`).addEventListener(key === 'enabled' ? 'change' : 'input', event => {
            const entry = current(); if (!entry) return;
            if (key === 'order') {
                const value = event.target.valueAsNumber;
                if (!Number.isFinite(value)) return;
                entry.order = Math.max(-9999, Math.min(9999, Math.trunc(value)));
            } else entry[key] = key === 'enabled' ? event.target.checked : event.target.value;
            if (key === 'content') {
                renderedDocKey = '';
                updateCount(entry.content);
            }
            persist();
        });
        shell.querySelector('[data-search]').value = query;
        shell.querySelector('[data-search]').addEventListener('input', event => { query = event.target.value; sync(); });
        for (const node of shell.querySelectorAll('[data-filter]')) node.addEventListener('click', () => { filter = node.dataset.filter; sync(); });
        let backdropPressed = false;
        const outside = event => {
            if (event.target !== shell) return false;
            const rect = shell.getBoundingClientRect();
            return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
        };
        shell.addEventListener('pointerdown', event => { backdropPressed = event.button === 0 && outside(event); });
        shell.addEventListener('pointercancel', () => { backdropPressed = false; });
        shell.addEventListener('click', event => { const close = backdropPressed && outside(event); backdropPressed = false; if (close) shell.close(); });
        shell.addEventListener('cancel', event => {
            if (menu.isOpen()) { event.preventDefault(); menu.close(); return; }
            if (editingBlockIndex >= 0) {
                event.preventDefault();
                editingBlockIndex = -1;
                renderBlockEditor(true);
            }
        });
        shell.addEventListener('close', () => { cleanupDrag(); menu.close(); shell.remove(); if (dialog === shell) dialog = null; });
        if (isMobile()) {
            const options = shell.querySelector('.auto-rewrite-entry-options');
            if (options) options.open = false;
        }
        document.body.append(shell); sync(); shell.showModal();
    }

    function renderList(composition) {
        const ordered = sortedEntries(getSettings());
        const token = JSON.stringify([selected, query, filter, composition.context, ordered.map(entry =>
            [entry.id, entry.name, entry.order, matchEntry(entry, composition.context), entry.enabled, entry.always, query ? entry.content : ''])]);
        if (token === listSignature) return;
        listSignature = token;
        const list = dialog.querySelector('[data-list]'), oldScroll = list.scrollTop;
        const q = query.trim().toLocaleLowerCase();
        const visible = ordered.filter(entry => (!q || `${entry.name}\n${entry.content}`.toLocaleLowerCase().includes(q))
            && (filter !== 'active' || matchEntry(entry, composition.context).active));
        list.replaceChildren(...visible.map(entry => {
            const state = matchEntry(entry, composition.context);
            const row = el('div', 'auto-rewrite-library-row');
            row.dataset.entryId = entry.id;
            row.dataset.selected = String(entry.id === selected);
            const handle = el('span', 'auto-rewrite-drag-handle');
            handle.title = '按住上下拖动排序';
            handle.setAttribute('aria-hidden', 'true');
            handle.innerHTML = '<i class="fa-solid fa-grip-vertical"></i>';
            const pick = el('button', 'auto-rewrite-library-row-pick'); pick.type = 'button';
            pick.setAttribute('aria-current', entry.id === selected ? 'true' : 'false');
            pick.append(el('span', 'auto-rewrite-library-order', String(entry.order)));
            const text = el('span', 'auto-rewrite-library-row-text');
            const title = el('b', '', entry.name || '未命名条目'); title.title = entry.name;
            const status = el('small', state.active ? 'is-active' : '', state.reason);
            text.append(title, status); pick.append(text); pick.addEventListener('click', () => select(entry.id));
            const toggle = el('label', 'auto-rewrite-quick-toggle');
            const checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.checked = entry.enabled;
            checkbox.setAttribute('aria-label', `启用${entry.name || '条目'}`);
            checkbox.addEventListener('change', () => { entry.enabled = checkbox.checked; persist(); });
            toggle.append(checkbox);
            const chevron = el('i', 'fa-solid fa-chevron-right auto-rewrite-library-row-chevron');
            chevron.setAttribute('aria-hidden', 'true');
            chevron.addEventListener('click', () => select(entry.id));
            row.append(handle, pick, toggle, chevron); return row;
        }));
        if (!visible.length) list.append(el('p', 'auto-rewrite-library-list-empty', q ? '没有找到匹配的条目' : filter === 'active' ? '当前没有生效条目' : '仓库还是空的，点击“新建”添加。'));
        list.scrollTop = oldScroll;
    }

    function renderBindings(entry) {
        const token = JSON.stringify([entry.id, entry.always, entry.presets, entry.characters]);
        if (token === bindingsSignature) return;
        bindingsSignature = token;
        for (const kind of ['presets', 'characters']) {
            const root = dialog.querySelector(`[data-${kind}]`);
            root.replaceChildren(...entry[kind].map((binding, index) => {
                const chip = el('button', 'auto-rewrite-library-binding-chip'); chip.type = 'button';
                chip.title = `${binding.name} · 点击解除绑定`;
                chip.append(el('span', '', binding.name), el('i', 'fa-solid fa-xmark'));
                chip.querySelector('i').setAttribute('aria-hidden', 'true');
                chip.setAttribute('aria-label', `解除绑定：${binding.name}`);
                chip.addEventListener('click', () => { entry[kind].splice(index, 1); persist(); });
                return chip;
            }));
            if (!entry[kind].length) root.append(el('span', 'auto-rewrite-library-unbound', kind === 'presets' ? '尚未绑定预设' : '尚未绑定角色'));
        }
    }

    function sync() {
        if (disposed) return;
        const composition = composedFeedback(getSettings());
        for (const root of summaries) {
            if (!root.isConnected) { summaries.delete(root); continue; }
            updateSummary(root, composition);
        }
        if (!dialog) return;
        const entryNow = current();
        if (!entryNow && mobileView === 'editor') mobileView = 'list';
        dialog.dataset.mobileView = mobileView;
        dialog.querySelector('[data-context]').textContent = contextLabel(composition.context);
        for (const node of dialog.querySelectorAll('[data-filter]')) node.setAttribute('aria-pressed', String(node.dataset.filter === filter));
        renderList(composition);
        const entry = current();
        dialog.querySelector('[data-empty]').hidden = Boolean(entry);
        dialog.querySelector('[data-editor]').hidden = !entry;
        if (entry) {
            for (const key of ['name', 'order']) {
                const field = dialog.querySelector(`[data-${key}]`);
                if (document.activeElement !== field) field.value = entry[key];
            }
            renderBlockEditor(false);
            dialog.querySelector('[data-enabled]').checked = entry.enabled;
            dialog.querySelector('[data-scope-label]').textContent = entry.always ? '常驻' : '绑定预设 / 角色';
            for (const node of dialog.querySelectorAll('[data-scope]')) node.setAttribute('aria-pressed', String((node.dataset.scope === 'always') === entry.always));
            dialog.querySelector('[data-bindings]').hidden = entry.always;
            dialog.querySelector('[data-current-preset]').disabled = !composition.context.preset;
            dialog.querySelector('[data-current-character]').disabled = !composition.context.character;
            for (const node of dialog.querySelectorAll('[data-match]')) node.setAttribute('aria-pressed', String(node.dataset.match === entry.match));
            dialog.querySelector('[data-match-help]').textContent = entry.match === 'all'
                ? '两类都设置绑定时，预设与角色须同时匹配；只绑定一类时按该类匹配。' : '预设或角色命中任意一个绑定即可生效。';
            const ordered = sortedEntries(getSettings()), position = ordered.indexOf(entry);
            dialog.querySelector('[data-up]').disabled = position <= 0;
            dialog.querySelector('[data-down]').disabled = position >= ordered.length - 1;
            renderBindings(entry);
        }
        dialog.querySelector('[data-undo-bar]').hidden = !lastDeleted;
        if (lastDeleted) dialog.querySelector('[data-undo-text]').textContent = `已删除“${lastDeleted.entry.name || '未命名条目'}”`;
        dialog.querySelector('[data-composed-count]').textContent = `${composition.entries.length} 条生效 · ${composition.text.length} 字`;
        const preview = dialog.querySelector('[data-composed]');
        if (preview.textContent !== composition.text) preview.textContent = composition.text || '当前没有生效内容';
    }

    return { summary, open, sync, dispose() {
        disposed = true; menu.destroy(); dialog?.close(); summaries.clear();
    } };
}
