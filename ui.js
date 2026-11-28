import { createFeedbackLibraryUI } from './feedback-library-ui.js';

function duration(ms) {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    return `${seconds}秒`;
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
            btn.addEventListener('pointerenter', () => { if (!btn.disabled) setHighlight(btn, false); });
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

    const update = ({ anchor, items, value }) => {
        if (state?.anchor !== anchor || JSON.stringify([state.items, state.value]) === JSON.stringify([items, value])) return;
        const highlighted = list.querySelector('.is-active')?.dataset.value;
        const scroll = list.scrollTop;
        state.items = items; state.value = value;
        searchWrap.hidden = items.length < 7;
        renderItems(searchInput.value);
        const previous = [...list.querySelectorAll('.auto-rewrite-menu-item:not(:disabled)')]
            .find(item => item.dataset.value === highlighted);
        if (previous) setHighlight(previous);
        list.scrollTop = scroll;
        position(state.box);
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
        update,
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

export function createRewriteUI({ getSettings, getView, onVersions, getRouting, onRoute, onRefreshModels, onMainProfile, onMainModel, onRefreshMainModels, onAuto, onMvuUpdate, onQuickChange, onLibraryChange, onRewrite, onJump, onMutation }) {
    let settingsLauncher, settingsEntry, bar, dialog, observer, chatResizeObserver, frame, poll, clock, shown, wasBusy = false;
    const ensureBarVisible = (forceBottom = false) => {
        if (!bar?.isConnected || bar.hidden) return;
        const chat = document.getElementById('chat');
        if (!chat) return;
        const chatRect = chat.getBoundingClientRect();
        const barRect = bar.getBoundingClientRect();
        if (barRect.height <= 0) return;
        const clippedBottom = barRect.bottom - (chatRect.bottom - 10);
        const partiallyVisible = barRect.top < chatRect.bottom && clippedBottom > 1;
        const nearBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight <= 180;
        if (partiallyVisible || (forceBottom && nearBottom && clippedBottom > 1)) {
            chat.scrollTop += Math.ceil(clippedBottom);
        }
    };
    const toolbarObserver = new ResizeObserver(() => {
        if (!bar?.parentElement) return;
        const row = bar.firstElementChild;
        const style = getComputedStyle(bar);
        const available = bar.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        if (available > 0 && row.offsetWidth > 0) {
            row.style.setProperty('--rewrite-row-scale', Math.min(1, available / row.offsetWidth));
        }
        requestAnimationFrame(() => ensureBarVisible(Boolean(shown?.busy)));
    });
    let inlineNetworkLabel;
    let disposed = false;
    const forms = new Set();
    const requests = new Map();
    let formSequence = 0;
    const menu = createFloatingMenu();
    const refresh = () => {
        if (disposed || frame || document.hidden) return;
        frame = requestAnimationFrame(() => { frame = null; render(); });
    };
    const onVisibility = () => {
        if (frame) { cancelAnimationFrame(frame); frame = null; }
        if (!document.hidden) refresh();
    };
    const library = createFeedbackLibraryUI({ getSettings, createMenu: createFloatingMenu,
        onChange: () => { onLibraryChange(); refresh(); }, onOpen: () => menu.close() });
    document.addEventListener('visibilitychange', onVisibility);
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
        root.innerHTML = `<label class="auto-rewrite-setting-toggle"><span><b>首轮完成后自动重写</b></span><input type="checkbox" data-auto></label>
            <label class="auto-rewrite-setting-toggle"><span><b>重写时更新 MVU 变量</b><small>关闭后重写只替换正文，不再要求模型输出变量更新块</small></span><input type="checkbox" data-mvu-update></label>
            <div data-feedback-library-placeholder></div>
            <details open class="auto-rewrite-model-card" aria-label="模型与 API 设置">
                <summary class="auto-rewrite-disclosure"><b>模型设置</b><span data-route-summary></span></summary>
                <div class="auto-rewrite-route-group" data-group="main">
                    <div class="auto-rewrite-route-title"><span class="auto-rewrite-role-tag">聊天模型（全局）</span></div>
                    <div class="auto-rewrite-route-fields">
                        <div class="auto-rewrite-label"><span>API 配置</span><button type="button" class="auto-rewrite-select-btn" data-main-profile aria-haspopup="listbox" aria-expanded="false" aria-label="主 API 连接配置"><span class="auto-rewrite-select-text" data-btn-label></span><span class="auto-rewrite-select-tag" data-btn-tag hidden></span><i class="fa-solid fa-chevron-down auto-rewrite-caret" aria-hidden="true"></i></button></div>
                        <div class="auto-rewrite-label"><span>模型型号</span><div class="auto-rewrite-combo"><input type="text" autocomplete="off" spellcheck="false" data-main-model aria-label="主 API 模型型号"><button type="button" class="auto-rewrite-combo-btn auto-rewrite-picker-btn" data-main-picker aria-haspopup="listbox" aria-expanded="false" title="从列表选择主模型" aria-label="展开主模型列表"><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></button><button type="button" class="auto-rewrite-combo-btn" data-refresh-main title="读取主 API 的模型列表" aria-label="刷新主 API 模型列表"><i class="fa-solid fa-rotate" aria-hidden="true"></i></button></div></div>
                    </div>
                    <p class="auto-rewrite-model-hint" data-main-hint hidden></p>
                </div>
                <div class="auto-rewrite-route-group" data-group="rewrite">
                    <div class="auto-rewrite-route-title"><span class="auto-rewrite-role-tag is-accent">重写专用</span></div>
                    <div class="auto-rewrite-route-fields">
                        <div class="auto-rewrite-label"><span>API 配置</span><button type="button" class="auto-rewrite-select-btn" data-profile aria-haspopup="listbox" aria-expanded="false" aria-label="重写使用的 API 配置"><span class="auto-rewrite-select-text" data-btn-label></span><span class="auto-rewrite-select-tag" data-btn-tag hidden></span><i class="fa-solid fa-chevron-down auto-rewrite-caret" aria-hidden="true"></i></button></div>
                        <div class="auto-rewrite-label"><span>模型型号</span><div class="auto-rewrite-combo"><input type="text" autocomplete="off" spellcheck="false" data-model aria-label="重写模型型号"><button type="button" class="auto-rewrite-combo-btn auto-rewrite-picker-btn" data-model-picker aria-haspopup="listbox" aria-expanded="false" title="从列表选择重写模型" aria-label="展开重写模型列表"><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></button><button type="button" class="auto-rewrite-combo-btn" data-refresh-models title="读取重写 API 的模型列表" aria-label="刷新重写模型列表"><i class="fa-solid fa-rotate" aria-hidden="true"></i></button></div></div>
                    </div>
                    <p class="auto-rewrite-model-hint" data-model-hint></p>
                </div>
                </details>
            <p class="auto-rewrite-status" data-status role="status"></p>`;
        root.querySelector('[data-auto]').addEventListener('change', event => { onAuto(event.target.checked); sync(); refresh(); });
        root.querySelector('[data-mvu-update]').addEventListener('change', event => { onMvuUpdate(event.target.checked); sync(); refresh(); });
        root.querySelector('[data-feedback-library-placeholder]').replaceWith(library.summary());

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
        const openMainModels = () => {
            openBtnMenu(mainPickerBtn, val => {
                if (!val) return;
                mainModelInput.value = val;
                commitMainModel(val);
            }, mainCombo);
            const route = getRouting();
            if (menu.isOpenFor(mainPickerBtn) && route.mainCanFetch && !route.mainCatalogLoaded
                && !requests.has(`${root.dataset.formId}:main`)) {
                void triggerRefresh(root, 'main', 'mainModelsMessage', onRefreshMainModels);
            }
        };
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
        const openRewriteModels = () => {
            openBtnMenu(rewritePickerBtn, val => {
                rewriteModelInput.value = val;
                onRoute({ model: val }); sync();
            }, rewriteCombo);
            const route = getRouting();
            if (menu.isOpenFor(rewritePickerBtn) && route.canFetch && !route.catalogLoaded
                && !requests.has(`${root.dataset.formId}:rewrite`)) {
                void triggerRefresh(root, 'rewrite', 'modelsMessage', onRefreshModels);
            }
        };
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
        library.sync();
        for (const root of forms) {
            const seq = root.dataset.formId;
            root.querySelector('[data-auto]').checked = settings.auto;
            root.querySelector('[data-mvu-update]').checked = settings.mvuUpdateVariables;

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
            const mainLoading = requests.has(`${seq}:main`);
            if (mainLoading) mainModelItems.push({ value: '__auto_rewrite_loading__', label: '正在读取此 API 的模型…', disabled: true });
            else if (!route.mainCatalogLoaded && root.dataset.mainModelsMessage) mainModelItems.push({ value: '__auto_rewrite_status__', label: root.dataset.mainModelsMessage, disabled: true });
            else if (!mainModelItems.length && route.mainCanFetch) mainModelItems.push({ value: '__auto_rewrite_empty__', label: '打开后自动读取模型列表', disabled: true });
            mainPicker.dataset.items = JSON.stringify(mainModelItems);
            mainPicker.dataset.value = route.mainModel;
            mainPicker.hidden = mainModelItems.length === 0;
            mainPicker.disabled = busy || !route.mainCanModel || mainModelItems.length === 0;
            if (menu.isOpenFor(mainProfileBtn) && mainProfileBtn.disabled) menu.close();
            if (menu.isOpenFor(mainPicker) && mainPicker.disabled) menu.close();
            menu.update({ anchor: mainPicker, items: mainModelItems, value: route.mainModel });

            const mainRefreshBtn = root.querySelector('[data-refresh-main]');
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
            const rewriteLoading = requests.has(`${seq}:rewrite`);
            const rewriteModelItems = route.models.length || route.canFetch
                ? [{ value: '', label: '沿用默认模型（不单独指定）', sub: '' }, ...route.models.map(m => ({ value: m.id, label: m.id, sub: m.label !== m.id ? m.label : '' }))]
                : [];
            if (rewriteLoading) rewriteModelItems.push({ value: '__auto_rewrite_loading__', label: '正在读取此 API 的模型…', disabled: true });
            else if (!route.catalogLoaded && root.dataset.modelsMessage) rewriteModelItems.push({ value: '__auto_rewrite_status__', label: root.dataset.modelsMessage, disabled: true });
            rewritePicker.dataset.items = JSON.stringify(rewriteModelItems);
            rewritePicker.dataset.value = settings.model;
            rewritePicker.hidden = rewriteModelItems.length === 0;
            rewritePicker.disabled = busy || !route.supported || rewriteModelItems.length === 0;
            if (menu.isOpenFor(profileBtn) && profileBtn.disabled) menu.close();
            if (menu.isOpenFor(rewritePicker) && rewritePicker.disabled) menu.close();
            menu.update({ anchor: rewritePicker, items: rewriteModelItems, value: settings.model });

            const rewriteRefreshBtn = root.querySelector('[data-refresh-models]');
            rewriteRefreshBtn.disabled = busy || !route.supported || rewriteLoading;
            rewriteRefreshBtn.classList.toggle('is-loading', rewriteLoading);
            rewriteRefreshBtn.querySelector('i').classList.toggle('fa-spin', rewriteLoading);
            root.querySelector('[data-model-hint]').textContent = route.error || (!route.supported
                ? '模型选择支持聊天补全 API；未指定时仍沿用当前连接。'
                : root.dataset.modelsMessage || '');
            root.querySelector('[data-route-summary]').textContent = route.error || settings.model || route.model || '跟随当前模型';
        }
        if (bar) bar.querySelector('[data-auto]').checked = settings.auto;
        if (settingsLauncher) {
            settingsLauncher.dataset.auto = String(settings.auto);
            settingsLauncher.title = `正文重写设置 · 自动重写${settings.auto ? '已开启' : '已关闭'}`;
        }
    };
    const openSettings = () => {
        if (dialog) { dialog.focus(); return; }
        dialog = document.createElement('dialog');
        dialog.className = 'auto-rewrite-dialog';
        dialog.id = 'auto-rewrite-settings-dialog';
        dialog.setAttribute('aria-label', '正文重写设置');
        const heading = document.createElement('div');
        heading.className = 'auto-rewrite-dialog-heading';
        heading.innerHTML = '<div><h3>重写设置</h3></div><button type="button" class="auto-rewrite-icon-button" aria-label="关闭设置"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>';
        const form = controls();
        const activeDialog = dialog;
        let backdropPressed = false;
        const isBackdrop = event => {
            if (event.target !== activeDialog) return false;
            const bounds = activeDialog.getBoundingClientRect();
            return event.clientX < bounds.left || event.clientX > bounds.right
                || event.clientY < bounds.top || event.clientY > bounds.bottom;
        };
        activeDialog.addEventListener('pointerdown', event => { backdropPressed = event.button === 0 && isBackdrop(event); });
        activeDialog.addEventListener('pointercancel', () => { backdropPressed = false; });
        activeDialog.addEventListener('click', event => {
            const dismiss = backdropPressed && isBackdrop(event);
            backdropPressed = false;
            if (dismiss) activeDialog.close();
        });
        heading.querySelector('button').addEventListener('click', () => dialog?.close());
        dialog.append(heading, form);
        dialog.addEventListener('cancel', event => { if (menu.isOpen()) { event.preventDefault(); menu.close(); } });
        dialog.addEventListener('close', () => {
            menu.close(); abortForm(form); forms.delete(form); activeDialog.remove();
            if (dialog === activeDialog) {
                dialog = null;
                settingsLauncher?.setAttribute('aria-expanded', 'false');
                settingsEntry?.querySelector('button').setAttribute('aria-expanded', 'false');
            }
        });
        document.body.append(dialog);
        sync();
        refresh();
        dialog.showModal();
        settingsLauncher?.setAttribute('aria-expanded', 'true');
        settingsEntry?.querySelector('button').setAttribute('aria-expanded', 'true');
    };
    const makeBar = () => {
        const root = document.createElement('div');
        root.className = 'auto-rewrite-actions';
        root.setAttribute('role', 'group');
        root.setAttribute('aria-label', '正文重写');
        root.innerHTML = `<div class="auto-rewrite-row"><div class="auto-rewrite-main">
            <button type="button" class="auto-rewrite-primary" data-rewrite><i class="fa-solid fa-pen-nib" aria-hidden="true"></i><span>重写正文</span></button>
            <button type="button" class="auto-rewrite-quick-trigger" data-quick-toggle aria-expanded="false" title="展开或收起本轮即时修改意见"><i class="fa-solid fa-comment-dots" aria-hidden="true"></i><span>即时意见</span><span class="auto-rewrite-quick-dot" data-quick-dot hidden></span></button>
            <div class="auto-rewrite-meta" hidden>
                <i class="fa-solid fa-circle-notch auto-rewrite-indicator" aria-hidden="true" hidden></i>
                <span data-caption role="status"></span><span class="auto-rewrite-time" data-time></span>
            </div>
            <button type="button" data-jump><i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i><span>查看原稿</span></button>
        </div>
        <div class="auto-rewrite-buttons">
            <label class="auto-rewrite-quick-toggle" title="生成结束后自动重写一次"><input type="checkbox" role="switch" aria-label="自动重写" data-auto><span>自动重写</span></label>
            <button type="button" class="auto-rewrite-icon-button" data-settings title="重写设置" aria-label="重写设置" aria-haspopup="dialog"><i class="fa-solid fa-sliders" aria-hidden="true"></i></button>
        </div></div>
        <div class="auto-rewrite-quick-box" data-quick-box hidden>
            <textarea class="auto-rewrite-quick-input" rows="1" placeholder="输入即时修改意见…（Ctrl+Enter 立即重写）" aria-label="即时修改意见" data-quick-input></textarea>
            <button type="button" class="auto-rewrite-quick-mode" data-quick-mode data-mode="append" title="点击切换：追加到常驻意见末尾 / 仅使用本条即时意见">追加</button>
            <button type="button" class="auto-rewrite-primary auto-rewrite-quick-run" data-quick-run title="按当前即时修改意见立即重写"><i class="fa-solid fa-play" aria-hidden="true"></i><span>立即重写</span></button>
        </div>`;
        const quickInput = root.querySelector('[data-quick-input]');
        const resizeQuickInput = () => {
            quickInput.style.height = 'auto';
            const nextHeight = Math.min(quickInput.scrollHeight + 2, 96);
            quickInput.style.height = `${nextHeight}px`;
            quickInput.style.overflowY = quickInput.scrollHeight + 2 > 96 ? 'auto' : 'hidden';
        };
        root.querySelector('[data-rewrite]').addEventListener('click', () => onRewrite(shown?.reply));
        root.querySelector('[data-quick-toggle]').addEventListener('click', () => {
            const nextOpen = !shown?.quick?.open;
            onQuickChange?.({ open: nextOpen });
            if (nextOpen) requestAnimationFrame(() => { resizeQuickInput(); quickInput.focus(); });
        });
        quickInput.addEventListener('input', () => {
            resizeQuickInput();
            onQuickChange?.({ text: quickInput.value });
        });
        quickInput.addEventListener('keydown', event => {
            event.stopPropagation();
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                const runBtn = root.querySelector('[data-quick-run]');
                if (!runBtn.disabled) onRewrite(shown?.reply);
            } else if (event.key === 'Escape') {
                event.preventDefault();
                onQuickChange?.({ open: false });
            }
        });
        root.querySelector('[data-quick-mode]').addEventListener('click', () => {
            const nextMode = shown?.quick?.mode === 'replace' ? 'append' : 'replace';
            onQuickChange?.({ mode: nextMode });
        });
        root.querySelector('[data-quick-run]').addEventListener('click', () => onRewrite(shown?.reply));
        root.querySelector('[data-jump]').addEventListener('click', () => {
            if (shown?.busy) void onVersions();
            else onJump(shown?.reply, shown?.link?.target);
        });
        root.querySelector('[data-auto]').addEventListener('change', event => { onAuto(event.target.checked); sync(); refresh(); });
        root.querySelector('[data-settings]').addEventListener('click', openSettings);
        return root;
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
        const host = view.reply && document.querySelector(`#chat > .mes[mesid="${view.reply.index}"]`);
        if (bar?.parentElement && bar.parentElement !== host) {
            bar.remove();
        }
        if (!host) {
            inlineNetworkLabel?.classList.remove('auto-rewrite-inline-network');
            inlineNetworkLabel = null;
            clearInterval(clock);
            clock = null;
            return;
        }
        if (!bar) {
            bar = makeBar();
            toolbarObserver.observe(bar);
            toolbarObserver.observe(bar.firstElementChild);
        }
        const mountedNewHost = bar.parentElement !== host;
        if (mountedNewHost) {
            host.append(bar);
        }
        bar.dataset.busy = String(view.busy);
        const enteredBusy = view.busy && !wasBusy;
        wasBusy = view.busy;
        if (enteredBusy || mountedNewHost) {
            requestAnimationFrame(() => ensureBarVisible(true));
            setTimeout(() => ensureBarVisible(true), 120);
            setTimeout(() => ensureBarVisible(true), 320);
            setTimeout(() => ensureBarVisible(true), 600);
        } else if (view.busy) {
            requestAnimationFrame(() => ensureBarVisible(false));
        }

        const button = bar.querySelector('[data-rewrite]');
        button.hidden = view.busy;
        button.disabled = view.busy || view.waiting || !view.canRewrite;
        button.querySelector('span').textContent = view.link ? '再写一版' : '重写正文';
        button.classList.toggle('auto-rewrite-primary', !view.link);
        button.title = view.waiting
            ? '等待保存完成后自动开始重写'
            : ((view.blocker && view.blocker !== '正在保存聊天') ? view.blocker : view.composerBusy ? '请先发送或清空输入框中的草稿与附件' : `重写当前第 ${view.reply.swipeId + 1} 版`);

        // This status is optional on upstream SillyTavern. Its label is replaced
        // per request, so the label from the initial reply cannot enter this row.
        const transportLabel = view.receiving && view.canBrowse
            ? document.querySelector('#generation_network_status:not([hidden]) > [role="status"]') : null;
        const networkLabel = transportLabel !== view.networkLabelAtStart ? transportLabel : null;
        if (networkLabel !== inlineNetworkLabel) {
            inlineNetworkLabel?.classList.remove('auto-rewrite-inline-network');
            networkLabel?.classList.add('auto-rewrite-inline-network');
            inlineNetworkLabel = networkLabel;
        }
        const networkPhase = networkLabel?.textContent;
        const phase = networkPhase === '请求已发出，等待上游响应' ? '等待模型响应' : networkPhase;
        const caption = view.busy
            ? phase ? `重写 · ${phase}` : view.receiving ? '正在重写' : view.status
            : view.waiting
                ? (view.waitingReason === '正在保存聊天' ? '等待保存完成，随后自动重写…' : '等待当前操作完成，随后自动重写…')
                : view.blocker || (view.link?.original ? '原稿' : view.stopped ? '已停止，重写稿已保留' : view.link ? '重写稿' : '');
        const meta = bar.querySelector('.auto-rewrite-meta');
        meta.hidden = !caption;
        meta.dataset.passive = String(!view.busy && !view.waiting && !view.blocker && !view.stopped);
        const indicator = meta.querySelector('.auto-rewrite-indicator');
        indicator.hidden = (!view.busy && !view.waiting) || view.cancelled || view.stopping;
        const captionEl = meta.querySelector('[data-caption]');
        if (captionEl.textContent !== caption) captionEl.textContent = caption;
        const jump = bar.querySelector('[data-jump]');
        jump.hidden = view.busy ? !view.canBrowse : !view.link;
        jump.disabled = !view.busy && !view.idle;
        jump.querySelector('span').textContent = view.busy ? '版本' : view.link?.label ?? '查看原稿';
        jump.querySelector('i').className = `fa-solid ${view.busy ? 'fa-book-open' : 'fa-clock-rotate-left'}`;
        jump.title = view.busy ? '查看历史版本，后台继续重写' : '切换正文版本';
        bar.querySelector('[data-auto]').checked = getSettings().auto;
        const quick = view.quick ?? { text: '', mode: 'append', open: false };
        const quickOpen = Boolean(quick.open) && !view.busy;
        const hasQuickText = Boolean(quick.text.trim());
        bar.dataset.quickOpen = String(quickOpen);
        const quickToggle = bar.querySelector('[data-quick-toggle]');
        quickToggle.hidden = view.busy;
        quickToggle.setAttribute('aria-expanded', String(quickOpen));
        quickToggle.classList.toggle('is-active', quickOpen || hasQuickText);
        bar.querySelector('[data-quick-dot]').hidden = !hasQuickText;
        const quickBox = bar.querySelector('[data-quick-box]');
        quickBox.hidden = !quickOpen;
        const quickInput = bar.querySelector('[data-quick-input]');
        if (quickInput.value !== quick.text) {
            quickInput.value = quick.text;
            quickInput.style.height = 'auto';
            const nextHeight = Math.min(quickInput.scrollHeight + 2, 96);
            quickInput.style.height = `${nextHeight}px`;
            quickInput.style.overflowY = quickInput.scrollHeight + 2 > 96 ? 'auto' : 'hidden';
        }
        quickInput.disabled = view.busy;
        const quickModeBtn = bar.querySelector('[data-quick-mode]');
        const isReplace = quick.mode === 'replace';
        quickInput.placeholder = isReplace
            ? '仅用模式：请填写本轮修改意见…（Ctrl+Enter 重写）'
            : '输入即时修改意见…（Ctrl+Enter 立即重写）';
        quickModeBtn.dataset.mode = isReplace ? 'replace' : 'append';
        quickModeBtn.textContent = isReplace ? '仅用' : '追加';
        quickModeBtn.title = isReplace
            ? '当前：仅用（只发送这条即时意见，跳过常驻意见库）。点击切换为「追加」'
            : '当前：追加（保留常驻意见，并把这条即时意见以最高优先级附在末尾）。点击切换为「仅用」';
        quickModeBtn.disabled = view.busy;
        const quickRunBtn = bar.querySelector('[data-quick-run]');
        const needText = isReplace && !hasQuickText;
        quickRunBtn.disabled = view.busy || view.waiting || !view.canRewrite || needText;
        quickRunBtn.title = needText
            ? '「仅用」模式下请先输入即时修改意见'
            : (view.waiting ? '等待保存完成后自动开始重写' : ((view.blocker && view.blocker !== '正在保存聊天') ? view.blocker : view.composerBusy ? '请先发送或清空输入框中的草稿与附件' : '按当前即时修改意见立即重写（Ctrl+Enter）'));
        const timing = view.timing;
        const time = bar.querySelector('[data-time]');
        const elapsed = timing ? duration((timing.finishedAt ?? Date.now()) - timing.rewriteStartedAt) : '';
        time.hidden = !view.busy || !elapsed;
        if (time.textContent !== elapsed) time.textContent = elapsed;
        const route = getRouting();
        const rewriteText = route.error || `${route.label} · ${route.model || '默认模型'}`;
        const swipeCount = view.reply.message.swipes?.length || 1;
        meta.title = [
            `第 ${view.reply.swipeId + 1}/${swipeCount} 版`,
            networkPhase || caption,
            elapsed && `重写用时 ${elapsed}`,
            networkLabel?.nextElementSibling?.textContent.replace(/^ · [^·]+(?: · |$)/, ''),
            `重写模型：${rewriteText}`,
        ].filter(Boolean).join('\n');
        if (view.busy && !clock) clock = setInterval(refresh, 1000);
        if (!view.busy && clock) { clearInterval(clock); clock = null; }
        if (!view.idle && !view.busy && !poll) poll = setTimeout(() => { poll = null; refresh(); }, 200);
    }
    function install() {
        const settingsTarget = document.querySelector('#extensions_settings2') ?? document.querySelector('#extensions_settings');
        if (!settingsEntry && settingsTarget) {
            settingsEntry = document.createElement('div');
            settingsEntry.id = 'auto-rewrite-settings-entry';
            settingsEntry.className = 'extension_container auto-rewrite-entry';
            settingsEntry.innerHTML = '<span class="auto-rewrite-entry-icon"><i class="fa-solid fa-pen-nib" aria-hidden="true"></i></span><span class="auto-rewrite-entry-title">正文重写</span><button type="button" class="menu_button auto-rewrite-entry-button" aria-label="打开正文重写设置" aria-haspopup="dialog" aria-expanded="false" aria-controls="auto-rewrite-settings-dialog"><i class="fa-solid fa-sliders" aria-hidden="true"></i><span>设置</span></button>';
            settingsEntry.querySelector('button').addEventListener('click', openSettings);
            settingsTarget.append(settingsEntry);
        }
        const toolsMenu = document.getElementById('extensionsMenu');
        if (!settingsLauncher && toolsMenu) {
            settingsLauncher = document.createElement('button');
            settingsLauncher.type = 'button';
            settingsLauncher.id = 'auto-rewrite-settings-menu';
            settingsLauncher.className = 'list-group-item flex-container flexGap5';
            settingsLauncher.setAttribute('aria-label', '打开正文重写设置');
            settingsLauncher.setAttribute('aria-haspopup', 'dialog');
            settingsLauncher.setAttribute('aria-expanded', 'false');
            settingsLauncher.setAttribute('aria-controls', 'auto-rewrite-settings-dialog');
            settingsLauncher.innerHTML = '<i class="fa-solid fa-sliders extensionsMenuExtensionButton" aria-hidden="true"></i><span>重写设置</span>';
            settingsLauncher.addEventListener('click', openSettings);
            toolsMenu.append(settingsLauncher);
        }
        const chat = document.getElementById('chat');
        if (!observer && chat) {
            observer = new MutationObserver(() => { onMutation(); refresh(); });
            observer.observe(chat, { childList: true });
        }
        if (!chatResizeObserver && chat) {
            chatResizeObserver = new ResizeObserver(() => ensureBarVisible(Boolean(shown?.busy)));
            chatResizeObserver.observe(chat);
        }
        sync(); refresh();
    }
    return { install, refresh, sync, openSettings, openLibrary: library.open, dispose() {
        disposed = true;
        library.dispose();
        document.removeEventListener('visibilitychange', onVisibility);
        observer?.disconnect();
        chatResizeObserver?.disconnect();
        toolbarObserver.disconnect();
        if (frame) cancelAnimationFrame(frame);
        clearTimeout(poll); clearInterval(clock);
        menu.destroy();
        for (const request of requests.values()) request.abort();
        requests.clear();
        inlineNetworkLabel?.classList.remove('auto-rewrite-inline-network');
        dialog?.close(); settingsLauncher?.remove(); settingsEntry?.remove(); bar?.remove(); forms.clear();
    } };
}
