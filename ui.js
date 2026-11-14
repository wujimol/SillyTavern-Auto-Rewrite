function duration(ms) {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    return seconds < 60 ? `${seconds}秒` : `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
}

function createFloatingMenu() {
    const menu = document.createElement('div');
    menu.className = 'auto-rewrite-menu';
    menu.setAttribute('popover', 'manual');
    menu.setAttribute('role', 'listbox');
    menu.hidden = true;
    menu.innerHTML = `<div class="auto-rewrite-menu-search" hidden><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><input type="search" placeholder="输入关键字筛选…" autocomplete="off" spellcheck="false" aria-label="筛选列表"></div><div class="auto-rewrite-menu-list"></div><p class="auto-rewrite-menu-empty" hidden>没有匹配项</p>`;
    const searchWrap = menu.querySelector('.auto-rewrite-menu-search');
    const searchInput = menu.querySelector('.auto-rewrite-menu-search input');
    const list = menu.querySelector('.auto-rewrite-menu-list');
    const empty = menu.querySelector('.auto-rewrite-menu-empty');

    let state = null;
    let closeTimer = null;

    const finishClose = () => {
        if ('hidePopover' in menu && menu.matches(':popover-open')) {
            try { menu.hidePopover(); } catch {}
        }
        menu.hidden = true;
        menu.classList.remove('is-closing');
        menu.remove();
    };

    const close = immediate => {
        if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
        if (!state) { finishClose(); return; }
        const prevAnchor = state.anchor;
        state = null;
        prevAnchor.setAttribute('aria-expanded', 'false');
        if (immediate) { finishClose(); return; }
        menu.classList.add('is-closing');
        closeTimer = setTimeout(() => { closeTimer = null; if (!state) finishClose(); }, 130);
    };

    const position = box => {
        const rect = box.getBoundingClientRect();
        const pad = 12;
        const width = Math.min(Math.max(rect.width, 230), window.innerWidth - pad * 2);
        const left = Math.max(pad, Math.min(rect.left, window.innerWidth - width - pad));
        const below = window.innerHeight - rect.bottom - pad - 6;
        const above = rect.top - pad - 6;
        const placeAbove = below < 185 && above > below;
        const maxHeight = Math.max(136, Math.min(296, placeAbove ? above : below));
        menu.style.width = `${Math.round(width)}px`;
        menu.style.left = `${Math.round(left)}px`;
        list.style.maxHeight = `${Math.round(maxHeight - (searchWrap.hidden ? 12 : 52))}px`;
        if (placeAbove) {
            menu.style.top = 'auto';
            menu.style.bottom = `${Math.round(window.innerHeight - rect.top + 6)}px`;
            menu.dataset.side = 'top';
        } else {
            menu.style.bottom = 'auto';
            menu.style.top = `${Math.round(rect.bottom + 6)}px`;
            menu.dataset.side = 'bottom';
        }
    };

    const setHighlight = (btn, ensureVisible = false) => {
        for (const el of list.querySelectorAll('.auto-rewrite-menu-item.is-active')) el.classList.remove('is-active');
        if (!btn) return;
        btn.classList.add('is-active');
        if (!ensureVisible) return;
        const top = btn.offsetTop - list.offsetTop;
        const bottom = top + btn.offsetHeight;
        if (top < list.scrollTop) list.scrollTop = top - 4;
        else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight + 4;
    };

    const pickItem = value => {
        const pick = state?.onPick;
        close();
        pick?.(value);
    };

    const renderItems = (query = '') => {
        if (!state) return;
        const q = query.trim().toLowerCase();
        const filtered = q
            ? state.items.filter(item => `${item.label} ${item.tag || ''} ${item.sub || ''}`.toLowerCase().includes(q))
            : state.items;
        list.replaceChildren(...filtered.map(item => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'auto-rewrite-menu-item';
            btn.setAttribute('role', 'option');
            btn.dataset.value = item.value;
            const active = item.value === state.value;
            btn.setAttribute('aria-selected', String(active));
            if (item.disabled) btn.disabled = true;

            const check = document.createElement('i');
            check.className = 'fa-solid fa-check auto-rewrite-menu-check';
            check.setAttribute('aria-hidden', 'true');
            const main = document.createElement('span');
            main.className = 'auto-rewrite-menu-text';
            const title = document.createElement('span');
            title.className = 'auto-rewrite-menu-label';
            title.textContent = item.label;
            main.append(title);
            if (item.sub && item.sub !== item.label) {
                const sub = document.createElement('small');
                sub.className = 'auto-rewrite-menu-sub';
                sub.textContent = item.sub;
                main.append(sub);
            }
            btn.append(check, main);
            if (item.tag) {
                const tag = document.createElement('span');
                tag.className = 'auto-rewrite-menu-tag';
                tag.textContent = item.tag;
                btn.append(tag);
            }
            btn.addEventListener('pointerenter', () => setHighlight(btn, false));
            btn.addEventListener('click', () => pickItem(item.value));
            return btn;
        }));
        empty.hidden = filtered.length > 0;
        const initial = list.querySelector('[aria-selected="true"]') ?? list.querySelector('.auto-rewrite-menu-item:not(:disabled)');
        setHighlight(initial);
    };

    searchInput.addEventListener('input', () => renderItems(searchInput.value));

    const open = ({ anchor, box = anchor, items, value, onPick }) => {
        if (state?.anchor === anchor) { close(); return; }
        close(true);
        if (!items.length) return;
        state = { anchor, box, items, value, onPick };
        anchor.setAttribute('aria-expanded', 'true');
        const host = anchor.closest('dialog') ?? document.body;
        host.append(menu);
        menu.classList.remove('is-closing');
        searchWrap.hidden = items.length < 7;
        searchInput.value = '';
        renderItems('');
        menu.hidden = false;
        if ('showPopover' in menu) {
            try { menu.showPopover(); } catch {}
        }
        position(box);
        const selected = list.querySelector('[aria-selected="true"]');
        if (selected) list.scrollTop = Math.max(0, selected.offsetTop - list.offsetTop - list.clientHeight / 2 + selected.offsetHeight / 2);
        if (!searchWrap.hidden && window.innerWidth > 640) searchInput.focus({ preventScroll: true });
    };

    const handlePointerDown = event => {
        if (!state) return;
        const target = event.target;
        if (target instanceof Node && (menu.contains(target) || state.anchor.contains(target))) return;
        close();
    };
    const handleKeyDown = event => {
        if (!state) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            const anchor = state.anchor;
            close();
            anchor.focus({ preventScroll: true });
            return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const opts = [...list.querySelectorAll('.auto-rewrite-menu-item:not(:disabled)')];
            if (!opts.length) return;
            const idx = opts.findIndex(el => el.classList.contains('is-active'));
            const step = event.key === 'ArrowDown' ? 1 : -1;
            const next = idx === -1 ? (step > 0 ? 0 : opts.length - 1) : (idx + step + opts.length) % opts.length;
            setHighlight(opts[next], true);
            return;
        }
        if (event.key === 'Enter' && (event.target === searchInput || menu.contains(event.target))) {
            const active = list.querySelector('.auto-rewrite-menu-item.is-active:not(:disabled)');
            if (!active) return;
            event.preventDefault();
            event.stopPropagation();
            pickItem(active.dataset.value ?? '');
        }
    };
    const handleViewportChange = event => {
        if (!state) return;
        if (event?.type === 'scroll' && event.target instanceof Node && menu.contains(event.target)) return;
        close(true);
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('resize', handleViewportChange);
    document.addEventListener('scroll', handleViewportChange, true);

    return {
        open,
        close: () => close(false),
        isOpen: () => Boolean(state),
        isOpenFor: anchor => state?.anchor === anchor,
        destroy() {
            close(true);
            document.removeEventListener('pointerdown', handlePointerDown, true);
            document.removeEventListener('keydown', handleKeyDown, true);
            window.removeEventListener('resize', handleViewportChange);
            document.removeEventListener('scroll', handleViewportChange, true);
        },
    };
}

function setDropdownButton(btn, items, value) {
    const matched = items.find(i => i.value === value) ?? items[0];
    btn.querySelector('[data-btn-label]').textContent = matched?.label || '';
    const tagEl = btn.querySelector('[data-btn-tag]');
    const tag = matched?.tag || '';
    tagEl.hidden = !tag;
    tagEl.textContent = tag;
    btn.dataset.items = JSON.stringify(items);
    btn.dataset.value = value;
}

export function createRewriteUI({ getSettings, getView, getRouting, onRoute, onRefreshModels, onMainProfile, onMainModel, onRefreshMainModels, onAuto, onFeedback, onRewrite, onJump, onMutation }) {
    let panel, bar, footer, nativePager, pagerSlot, dialog, observer, frame, poll, clock, shown;
    let dock, dockViewport, dockObserver, dockPadding;
    let disposed = false;
    const forms = new Set();
    const requests = new Map();
    let formSequence = 0;
    const menu = createFloatingMenu();
    const refresh = () => {
        if (disposed || frame) return;
        frame = requestAnimationFrame(() => { frame = null; render(); });
    };
    const abortForm = (root, role) => {
        const prefix = `${root.dataset.formId}:${role ? `${role}` : ''}`;
        for (const [key, req] of requests) {
            if (key.startsWith(prefix)) { req.abort(); requests.delete(key); }
        }
    };
    const triggerRefresh = async (root, role, msgKey, fetcher) => {
        const key = `${root.dataset.formId}:${role}`;
        requests.get(key)?.abort();
        const request = new AbortController();
        const timeout = setTimeout(() => request.abort(), 20000);
        requests.set(key, request);
        root.dataset[msgKey] = '正在读取模型列表…'; sync();
        try {
            const models = await fetcher(request.signal);
            if (requests.get(key) === request) root.dataset[msgKey] = `已获取 ${models.length} 个可选型号，点击 ▾ 可直接筛选选择`;
        } catch (error) {
            if (requests.get(key) === request) root.dataset[msgKey] = request.signal.aborted
                ? '读取已取消或超时，可以手动填写型号' : error.message;
        } finally {
            clearTimeout(timeout);
            if (requests.get(key) === request) requests.delete(key);
            sync();
        }
    };
    const controls = () => {
        const root = document.createElement('div');
        root.className = 'auto-rewrite-controls';
        const seq = ++formSequence;
        root.dataset.formId = String(seq);
        root.innerHTML = `<label class="auto-rewrite-setting-toggle"><span><b>自动重写一次</b><small>首轮结束后，按修改意见再写一版</small></span><input type="checkbox" data-auto></label>
            <section class="auto-rewrite-model-card" aria-label="模型与 API 设置">
                <div class="auto-rewrite-model-heading"><span class="auto-rewrite-model-icon"><i class="fa-solid fa-layer-group" aria-hidden="true"></i></span><div><b>API 与模型</b><small>可直接切换主 API，也能为第二轮重写单独指定模型</small></div></div>
                <div class="auto-rewrite-route-group" data-group="main">
                    <div class="auto-rewrite-route-title"><span class="auto-rewrite-role-tag">首轮 · 主 API</span><small>全局生效，影响正常聊天</small><span class="auto-rewrite-model-badge" data-main-source></span></div>
                    <div class="auto-rewrite-route-fields">
                        <div class="auto-rewrite-label"><span>API 配置</span><button type="button" class="auto-rewrite-select-btn" data-main-profile aria-haspopup="listbox" aria-expanded="false" aria-label="主 API 连接配置"><span class="auto-rewrite-select-text" data-btn-label></span><span class="auto-rewrite-select-tag" data-btn-tag hidden></span><i class="fa-solid fa-chevron-down auto-rewrite-caret" aria-hidden="true"></i></button></div>
                        <div class="auto-rewrite-label"><span>模型型号</span><div class="auto-rewrite-combo"><input type="text" autocomplete="off" spellcheck="false" data-main-model aria-label="主 API 模型型号"><button type="button" class="auto-rewrite-combo-btn auto-rewrite-picker-btn" data-main-picker aria-haspopup="listbox" aria-expanded="false" title="从列表选择主模型" aria-label="展开主模型列表"><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></button><button type="button" class="auto-rewrite-combo-btn" data-refresh-main title="读取主 API 的模型列表" aria-label="刷新主 API 模型列表"><i class="fa-solid fa-rotate" aria-hidden="true"></i></button></div></div>
                    </div>
                    <p class="auto-rewrite-model-hint" data-main-hint hidden></p>
                </div>
                <div class="auto-rewrite-route-group" data-group="rewrite">
                    <div class="auto-rewrite-route-title"><span class="auto-rewrite-role-tag is-accent">二轮 · 重写</span><small>仅重写借用，写完自动恢复</small><span class="auto-rewrite-model-badge is-accent" data-source></span></div>
                    <div class="auto-rewrite-route-fields">
                        <div class="auto-rewrite-label"><span>API 配置</span><button type="button" class="auto-rewrite-select-btn" data-profile aria-haspopup="listbox" aria-expanded="false" aria-label="重写使用的 API 配置"><span class="auto-rewrite-select-text" data-btn-label></span><span class="auto-rewrite-select-tag" data-btn-tag hidden></span><i class="fa-solid fa-chevron-down auto-rewrite-caret" aria-hidden="true"></i></button></div>
                        <div class="auto-rewrite-label"><span>模型型号</span><div class="auto-rewrite-combo"><input type="text" autocomplete="off" spellcheck="false" data-model aria-label="重写模型型号"><button type="button" class="auto-rewrite-combo-btn auto-rewrite-picker-btn" data-model-picker aria-haspopup="listbox" aria-expanded="false" title="从列表选择重写模型" aria-label="展开重写模型列表"><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></button><button type="button" class="auto-rewrite-combo-btn" data-refresh-models title="读取重写 API 的模型列表" aria-label="刷新重写模型列表"><i class="fa-solid fa-rotate" aria-hidden="true"></i></button></div></div>
                    </div>
                    <p class="auto-rewrite-model-hint" data-model-hint></p>
                </div>
                <div class="auto-rewrite-model-summary"><i class="fa-solid fa-arrow-turn-up" aria-hidden="true"></i><span data-route-summary></span></div>
            </section>
            <label class="auto-rewrite-label">修改意见<textarea class="text_pole" rows="4" spellcheck="false" data-feedback></textarea></label>
            <p class="auto-rewrite-note">沿用当前写作预设。重写结束后恢复首轮连接，原稿保留为上一版。</p>
            <p class="auto-rewrite-status" data-status role="status"></p>`;
        root.querySelector('[data-auto]').addEventListener('change', event => { onAuto(event.target.checked); sync(); refresh(); });
        root.querySelector('[data-feedback]').addEventListener('input', event => { onFeedback(event.target.value); sync(); });

        const openBtnMenu = (btn, onPick, box = btn) => {
            if (btn.disabled) return;
            const items = JSON.parse(btn.dataset.items || '[]');
            menu.open({ anchor: btn, box, items, value: btn.dataset.value || '', onPick });
        };

        const mainProfileBtn = root.querySelector('[data-main-profile]');
        mainProfileBtn.addEventListener('click', () => openBtnMenu(mainProfileBtn, id => {
            abortForm(root, 'main');
            delete root.dataset.mainModelsMessage;
            onMainProfile(id);
        }));

        const mainModelInput = root.querySelector('[data-main-model]');
        const mainPickerBtn = root.querySelector('[data-main-picker]');
        const mainCombo = mainModelInput.closest('.auto-rewrite-combo');
        const commitMainModel = value => {
            const next = String(value ?? '').trim();
            if (!next || next === getRouting().mainModel) return;
            onMainModel(next);
        };
        const openMainModels = () => openBtnMenu(mainPickerBtn, val => {
            if (!val) return;
            mainModelInput.value = val;
            commitMainModel(val);
        }, mainCombo);
        mainModelInput.addEventListener('change', () => commitMainModel(mainModelInput.value));
        mainModelInput.addEventListener('keydown', event => {
            if (event.key === 'ArrowDown' && !mainPickerBtn.hidden && !mainPickerBtn.disabled) {
                event.preventDefault();
                openMainModels();
                return;
            }
            if (event.key !== 'Enter') return;
            event.preventDefault();
            commitMainModel(mainModelInput.value);
        });
        mainPickerBtn.addEventListener('click', openMainModels);
        root.querySelector('[data-refresh-main]').addEventListener('click', () => triggerRefresh(root, 'main', 'mainModelsMessage', onRefreshMainModels));

        const profileBtn = root.querySelector('[data-profile]');
        profileBtn.addEventListener('click', () => openBtnMenu(profileBtn, id => {
            abortForm(root, 'rewrite');
            delete root.dataset.modelsMessage;
            onRoute({ profileId: id, model: '' }); sync(); refresh();
        }));

        const rewriteModelInput = root.querySelector('[data-model]');
        const rewritePickerBtn = root.querySelector('[data-model-picker]');
        const rewriteCombo = rewriteModelInput.closest('.auto-rewrite-combo');
        const openRewriteModels = () => openBtnMenu(rewritePickerBtn, val => {
            rewriteModelInput.value = val;
            onRoute({ model: val }); sync();
        }, rewriteCombo);
        rewriteModelInput.addEventListener('input', event => {
            onRoute({ model: event.target.value }); sync();
        });
        rewriteModelInput.addEventListener('keydown', event => {
            if (event.key === 'ArrowDown' && !rewritePickerBtn.hidden && !rewritePickerBtn.disabled) {
                event.preventDefault();
                openRewriteModels();
            }
        });
        rewritePickerBtn.addEventListener('click', openRewriteModels);
        root.querySelector('[data-refresh-models]').addEventListener('click', () => triggerRefresh(root, 'rewrite', 'modelsMessage', onRefreshModels));
        forms.add(root);
        return root;
    };
    const sync = () => {
        const settings = getSettings();
        const route = getRouting();
        const busy = getView().busy;
        for (const root of forms) {
            const seq = root.dataset.formId;
            root.querySelector('[data-auto]').checked = settings.auto;
            const field = root.querySelector('[data-feedback]');
            if (document.activeElement !== field) field.value = settings.feedback;

            // Main API group
            const mainProfileBtn = root.querySelector('[data-main-profile]');
            const mainEntries = [
                { value: '', label: '当前手动连接（未选配置）', tag: '' },
                ...route.mainProfiles.map(p => ({ value: p.id, label: p.name, tag: p.api })),
            ];
            if (route.mainProfileId && !mainEntries.some(e => e.value === route.mainProfileId)) {
                mainEntries.push({ value: route.mainProfileId, label: '当前配置', tag: '' });
            }
            setDropdownButton(mainProfileBtn, mainEntries, route.mainProfileId);
            mainProfileBtn.disabled = busy || !route.mainCanProfile;

            const mainModel = root.querySelector('[data-main-model]');
            if (document.activeElement !== mainModel) mainModel.value = route.mainModel;
            mainModel.placeholder = route.supported ? '选择或输入主模型名称' : '仅聊天补全 API 支持切换主模型';
            mainModel.disabled = busy || !route.mainCanModel;
            const mainPicker = root.querySelector('[data-main-picker]');
            const mainModelItems = route.mainModels.map(m => ({ value: m.id, label: m.id, sub: m.label !== m.id ? m.label : '' }));
            mainPicker.dataset.items = JSON.stringify(mainModelItems);
            mainPicker.dataset.value = route.mainModel;
            mainPicker.hidden = mainModelItems.length === 0;
            mainPicker.disabled = busy || !route.mainCanModel || mainModelItems.length === 0;
            if (menu.isOpenFor(mainProfileBtn) && mainProfileBtn.disabled) menu.close();
            if (menu.isOpenFor(mainPicker) && mainPicker.disabled) menu.close();

            root.querySelector('[data-main-source]').textContent = route.mainSource || '未选择';
            const mainRefreshBtn = root.querySelector('[data-refresh-main]');
            const mainLoading = requests.has(`${seq}:main`);
            mainRefreshBtn.disabled = busy || !route.mainCanFetch || mainLoading;
            mainRefreshBtn.classList.toggle('is-loading', mainLoading);
            mainRefreshBtn.querySelector('i').classList.toggle('fa-spin', mainLoading);
            const mainHint = root.querySelector('[data-main-hint]');
            const mainHintText = root.dataset.mainModelsMessage || (!route.mainCanProfile ? '未检测到连接管理扩展，请直接填写模型或前往酒馆 API 面板调整。' : '');
            mainHint.hidden = !mainHintText;
            mainHint.textContent = mainHintText;

            // Rewrite group
            const profileBtn = root.querySelector('[data-profile]');
            const rewriteEntries = [
                { value: '', label: '沿用当前 API', tag: '' },
                ...route.profiles.map(p => ({ value: p.id, label: p.name, tag: p.api })),
            ];
            if (settings.profileId && !rewriteEntries.some(e => e.value === settings.profileId)) {
                rewriteEntries.push({ value: settings.profileId, label: '配置已删除 · 请重新选择', tag: '' });
            }
            setDropdownButton(profileBtn, rewriteEntries, settings.profileId);
            profileBtn.disabled = busy;

            const model = root.querySelector('[data-model]');
            if (document.activeElement !== model) model.value = settings.model;
            model.placeholder = route.model ? `默认：${route.model}` : '沿用默认型号，或输入模型名称';
            model.disabled = busy || !route.supported;
            const rewritePicker = root.querySelector('[data-model-picker]');
            const rewriteModelItems = route.models.length
                ? [{ value: '', label: '沿用默认模型（不单独指定）', sub: '' }, ...route.models.map(m => ({ value: m.id, label: m.id, sub: m.label !== m.id ? m.label : '' }))]
                : [];
            rewritePicker.dataset.items = JSON.stringify(rewriteModelItems);
            rewritePicker.dataset.value = settings.model;
            rewritePicker.hidden = rewriteModelItems.length === 0;
            rewritePicker.disabled = busy || !route.supported || rewriteModelItems.length === 0;
            if (menu.isOpenFor(profileBtn) && profileBtn.disabled) menu.close();
            if (menu.isOpenFor(rewritePicker) && rewritePicker.disabled) menu.close();

            root.querySelector('[data-source]').textContent = route.source || '未选择';
            const rewriteRefreshBtn = root.querySelector('[data-refresh-models]');
            const rewriteLoading = requests.has(`${seq}:rewrite`);
            rewriteRefreshBtn.disabled = busy || !route.supported || rewriteLoading;
            rewriteRefreshBtn.classList.toggle('is-loading', rewriteLoading);
            rewriteRefreshBtn.querySelector('i').classList.toggle('fa-spin', rewriteLoading);
            root.querySelector('[data-model-hint]').textContent = route.error || (!route.supported
                ? '模型选择支持聊天补全 API；未指定时仍沿用当前连接。'
                : root.dataset.modelsMessage || (route.canFetch ? '点击 ▾ 从菜单选择型号，也可手动输入；右侧可刷新模型列表。' : '点击 ▾ 从菜单选择已有型号，也可手动输入准确名称。'));
            const mainText = route.mainModel
                ? `${route.mainModel}${route.mainSource ? ` (${route.mainSource})` : ''}`
                : (route.mainSource || '未选择');
            const rewriteText = route.error || `${route.label} · ${route.model || '默认模型'}`;
            root.querySelector('[data-route-summary]').textContent = `主 API：${mainText}  →  重写：${rewriteText}`;
        }
        if (bar) bar.querySelector('[data-auto]').checked = settings.auto;
    };
    const openSettings = () => {
        if (dialog) { dialog.focus(); return; }
        dialog = document.createElement('dialog');
        dialog.className = 'auto-rewrite-dialog';
        const heading = document.createElement('div');
        heading.className = 'auto-rewrite-dialog-heading';
        heading.innerHTML = '<div><small>REWRITE</small><h3>正文重写</h3></div><button type="button" class="auto-rewrite-icon-button" aria-label="关闭设置"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>';
        const form = controls();
        const activeDialog = dialog;
        heading.querySelector('button').addEventListener('click', () => dialog?.close());
        dialog.append(heading, form);
        dialog.addEventListener('cancel', event => { if (menu.isOpen()) { event.preventDefault(); menu.close(); } });
        dialog.addEventListener('close', () => { menu.close(); abortForm(form); forms.delete(form); activeDialog.remove(); if (dialog === activeDialog) dialog = null; });
        document.body.append(dialog);
        sync();
        refresh();
        dialog.showModal();
    };
    const makeBar = () => {
        const root = document.createElement('div');
        root.className = 'auto-rewrite-actions';
        root.innerHTML = `<div class="auto-rewrite-main"><button type="button" class="auto-rewrite-primary" data-rewrite><i class="fa-solid fa-pen-nib" aria-hidden="true"></i><span>重写</span></button>
            <button type="button" class="auto-rewrite-secondary" data-jump><i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i><span>查看原稿</span></button>
            <div class="auto-rewrite-meta"><span data-caption></span><span class="auto-rewrite-time" data-time></span></div></div>
            <div class="auto-rewrite-buttons"><label class="auto-rewrite-quick-toggle" title="生成结束后自动重写一次"><input type="checkbox" data-auto><span>自动</span></label>
            <button type="button" class="auto-rewrite-icon-button" data-settings title="重写设置" aria-label="重写设置"><i class="fa-solid fa-sliders" aria-hidden="true"></i></button></div>`;
        root.querySelector('[data-rewrite]').addEventListener('click', () => onRewrite(shown?.reply));
        root.querySelector('[data-jump]').addEventListener('click', () => onJump(shown?.reply, shown?.link?.target));
        root.querySelector('[data-auto]').addEventListener('change', event => { onAuto(event.target.checked); sync(); refresh(); });
        root.querySelector('[data-settings]').addEventListener('click', openSettings);
        return root;
    };
    const detachFooter = () => {
        bar?.remove();
        if (pagerSlot?.isConnected && nativePager?.parentElement === footer) pagerSlot.replaceWith(nativePager);
        else pagerSlot?.remove();
        footer?.remove();
        footer = null; nativePager = null; pagerSlot = null;
    };
    const positionDock = () => {
        if (!dock || !dockViewport) return;
        const rect = dockViewport.getBoundingClientRect();
        dock.style.left = `${rect.left + 8}px`;
        dock.style.width = `${Math.max(0, rect.width - 16)}px`;
        dock.style.bottom = `${Math.max(0, window.innerHeight - rect.bottom) + 8}px`;
        const padding = `${Math.ceil(dock.getBoundingClientRect().height) + 16}px`;
        if (dockViewport.style.getPropertyValue('--auto-rewrite-dock-space') !== padding) {
            dockViewport.style.setProperty('--auto-rewrite-dock-space', padding);
        }
    };
    const releaseDock = () => {
        dockObserver?.disconnect(); dockObserver = null;
        window.removeEventListener('resize', positionDock);
        window.visualViewport?.removeEventListener('resize', positionDock);
        window.visualViewport?.removeEventListener('scroll', positionDock);
        if (dockViewport) {
            dockViewport.classList.remove('auto-rewrite-docked');
            for (const [key, value, priority] of dockPadding ?? []) {
                if (value) dockViewport.style.setProperty(key, value, priority);
                else dockViewport.style.removeProperty(key);
            }
        }
        bar?.remove(); dock?.remove();
        dock = null; dockViewport = null; dockPadding = null;
    };
    const removeBar = () => {
        if (dock) releaseDock();
        detachFooter(); bar = null;
    };
    const mountDock = () => {
        if (dock) return;
        detachFooter();
        if (!bar) bar = makeBar();
        dockViewport = document.getElementById('chat');
        if (!dockViewport) return;
        dockPadding = ['--auto-rewrite-dock-base', '--auto-rewrite-dock-space'].map(key =>
            [key, dockViewport.style.getPropertyValue(key), dockViewport.style.getPropertyPriority(key)]);
        dockViewport.style.setProperty('--auto-rewrite-dock-base', getComputedStyle(dockViewport).paddingBottom);
        dockViewport.classList.add('auto-rewrite-docked');
        dock = document.createElement('div');
        dock.className = 'auto-rewrite-live-dock';
        dock.append(bar);
        document.body.append(dock);
        positionDock();
        dockObserver = new ResizeObserver(positionDock);
        dockObserver.observe(dockViewport); dockObserver.observe(dock);
        window.addEventListener('resize', positionDock);
        window.visualViewport?.addEventListener('resize', positionDock);
        window.visualViewport?.addEventListener('scroll', positionDock);
    };
    const mountBar = block => {
        if (!bar) bar = makeBar();
        nativePager = block.closest('.mes')?.querySelector('.swipeRightBlock');
        if (!nativePager) { block.append(bar); return; }
        // Move the real pager, preserving its handlers and native visibility rules.
        // Remember its original location so disabling the extension restores it.
        pagerSlot = document.createComment('auto-rewrite-native-pager');
        nativePager.before(pagerSlot);
        footer = document.createElement('div');
        footer.className = 'auto-rewrite-footer';
        footer.append(bar, nativePager);
        block.append(footer);
    };
    function render() {
        if (disposed) return;
        const view = getView();
        shown = view;
        sync();
        for (const root of forms) {
            const node = root.querySelector('[data-status]');
            if (node.textContent !== view.status) node.textContent = view.status;
        }
        if (view.busy) {
            // Keep the same controls anchored to the viewport through temporary
            // replies and tool continuations, rather than rebuilding each floor.
            mountDock();
        } else {
            if (dock) releaseDock();
            if (bar?.isConnected && Number(bar.closest('.mes')?.getAttribute('mesid')) !== view.reply?.index) removeBar();
            if (!view.reply) { removeBar(); clearInterval(clock); clock = null; return; }
            const block = document.querySelector(`#chat .mes[mesid="${view.reply.index}"] .mes_block`);
            if (!block) return;
            if (!bar?.isConnected) { detachFooter(); mountBar(block); }
        }
        if (!bar || !view.reply) return;
        const button = bar.querySelector('[data-rewrite]');
        const disabled = view.busy || !view.idle || view.composerBusy;
        button.disabled = disabled;
        const text = view.busy ? view.cancelled ? '已取消' : '重写中…' : '重写';
        if (button.querySelector('span').textContent !== text) button.querySelector('span').textContent = text;
        button.title = view.composerBusy ? '请先发送或清空输入框中的草稿与附件' : `重写当前第 ${view.reply.swipeId + 1} 版`;
        bar.dataset.busy = String(view.busy);
        const swipeCount = view.reply.message.swipes?.length || 1;
        const caption = view.busy
            ? `${view.reply.preview ? '重写中 · ' : ''}${view.status}`
            : view.link?.original ? '正在看原稿' : view.link ? '已重写' : '';
        const captionEl = bar.querySelector('[data-caption]');
        captionEl.hidden = !caption;
        if (captionEl.textContent !== caption) captionEl.textContent = caption;
        const jump = bar.querySelector('[data-jump]');
        jump.hidden = view.busy || !view.link;
        jump.disabled = view.busy || !view.idle;
        if (view.link) jump.querySelector('span').textContent = view.link.label;
        bar.querySelector('[data-auto]').checked = getSettings().auto;
        const timing = view.timing;
        const time = bar.querySelector('[data-time]');
        const end = timing?.finishedAt ?? Date.now();
        time.hidden = !timing;
        const label = timing
            ? `${view.automatic ? `总${duration(end - timing.startedAt)} · ` : ''}重写${duration(end - timing.rewriteStartedAt)}`
            : '';
        if (time.textContent !== label) time.textContent = label;
        const meta = bar.querySelector('.auto-rewrite-meta');
        meta.hidden = !caption && !timing;
        const route = getRouting();
        const mainText = route.mainModel ? `${route.mainModel}${route.mainSource ? ` (${route.mainSource})` : ''}` : (route.mainSource || '未选择');
        const rewriteText = route.error || `${route.label} · ${route.model || '默认模型'}`;
        meta.title = `第 ${view.reply.swipeId + 1}/${swipeCount} 版${caption ? ` · ${caption}` : ''}${label ? ` · ${label}` : ''}\n主 API：${mainText} → 重写：${rewriteText}`;
        if (view.busy && !timing?.finishedAt && !clock) clock = setInterval(refresh, 1000);
        if ((!view.busy || timing?.finishedAt) && clock) { clearInterval(clock); clock = null; }
        if (!view.idle && !view.busy && !poll) poll = setTimeout(() => { poll = null; refresh(); }, 200);
    }
    function install() {
        const target = document.querySelector('#extensions_settings2') ?? document.querySelector('#extensions_settings');
        if (!panel && target) {
            panel = document.createElement('div');
            panel.className = 'extension_container auto-rewrite-settings';
            panel.innerHTML = '<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>正文重写 · 独立版</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content"></div></div>';
            panel.querySelector('.inline-drawer-content').append(controls());
            target.append(panel);
        }
        const chat = document.getElementById('chat');
        if (!observer && chat) {
            observer = new MutationObserver(() => { onMutation(); refresh(); });
            observer.observe(chat, { childList: true });
        }
        sync(); refresh();
    }
    return { install, refresh, sync, openSettings, dispose() {
        disposed = true;
        observer?.disconnect();
        if (frame) cancelAnimationFrame(frame);
        clearTimeout(poll); clearInterval(clock);
        menu.destroy();
        for (const request of requests.values()) request.abort();
        requests.clear();
        dialog?.close(); panel?.remove(); removeBar(); forms.clear();
    } };
}
