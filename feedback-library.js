import { getContext } from '../../../extensions.js';

const APIS = { openai: '聊天补全', textgenerationwebui: '文本补全', kobold: 'Kobold', novel: 'NovelAI' };
export const presetKey = preset => JSON.stringify([preset.api, preset.name]);
export const entryId = () => globalThis.crypto?.randomUUID?.()
    ?? `feedback-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export function normalizeEntry(input = {}) {
    const distinct = (items, key) => [...new Map(items.map(item => [key(item), item])).values()];
    return {
        id: typeof input.id === 'string' && input.id ? input.id : entryId(),
        name: typeof input.name === 'string' ? input.name : '新修改意见',
        content: typeof input.content === 'string' ? input.content : '',
        enabled: input.enabled !== false,
        order: Number.isFinite(Number(input.order)) ? Math.max(-9999, Math.min(9999, Math.trunc(Number(input.order)))) : 3,
        always: input.always === true,
        match: input.match === 'all' ? 'all' : 'any',
        presets: distinct((Array.isArray(input.presets) ? input.presets : [])
            .filter(item => item && typeof item.api === 'string' && typeof item.name === 'string' && item.name)
            .map(item => ({ api: item.api, name: item.name })), presetKey),
        characters: distinct((Array.isArray(input.characters) ? input.characters : [])
            .filter(item => item && typeof item.avatar === 'string' && item.avatar)
            .map(item => ({ avatar: item.avatar, name: typeof item.name === 'string' ? item.name : item.avatar })), item => item.avatar),
    };
}

export function ensureFeedbackLibrary(settings, initialName = '常驻修改意见') {
    if (settings.feedbackLibraryVersion === 1 && Array.isArray(settings.feedbackEntries)) return false;
    const existing = Array.isArray(settings.feedbackEntries) ? settings.feedbackEntries : null;
    settings.feedbackEntries = existing ? existing.filter(item => item && typeof item === 'object').map(normalizeEntry)
        : [normalizeEntry({ name: initialName, content: settings.feedback ?? '', order: 2, always: true })];
    const ids = new Set();
    for (const entry of settings.feedbackEntries) {
        if (ids.has(entry.id)) entry.id = entryId();
        ids.add(entry.id);
    }
    settings.feedbackLibraryVersion = 1;
    return true;
}

export function bindingContext() {
    const ctx = getContext();
    const api = ctx.mainApi === 'koboldhorde' ? 'kobold' : ctx.mainApi;
    let name = '';
    try { name = ctx.getPresetManager?.(api)?.getSelectedPresetName?.() ?? ''; }
    catch { /* Preset controls can be unavailable during startup. */ }
    const character = !ctx.groupId && ctx.characterId != null ? ctx.characters?.[ctx.characterId] : null;
    return { preset: name ? { api, name } : null,
        character: character?.avatar ? { avatar: character.avatar, name: character.name || character.avatar } : null };
}

export function bindingCatalog() {
    const ctx = getContext();
    const presets = [];
    const api = ctx.mainApi === 'koboldhorde' ? 'kobold' : ctx.mainApi;
    try {
        // Only offer the presets the user sees for their current writing API.
        // Inactive backends can contain bundled defaults unrelated to this setup.
        const names = ctx.getPresetManager?.(api)?.getAllPresets?.() ?? [];
        for (const name of names) if (name) presets.push({ api, name, label: APIS[api] ?? '当前 API' });
    } catch { /* The selected API may not expose a preset manager. */ }
    const characters = (ctx.characters ?? []).filter(character => character?.avatar)
        .map(character => ({ avatar: character.avatar, name: character.name || character.avatar }));
    return { presets: [...new Map(presets.map(preset => [presetKey(preset), preset])).values()]
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
        characters: characters.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')) };
}

export function sortedEntries(settings) {
    return (settings.feedbackEntries ?? []).map((entry, index) => ({ entry, index }))
        .sort((a, b) => a.entry.order - b.entry.order || a.index - b.index).map(item => item.entry);
}

export function matchEntry(entry, context) {
    if (!entry.enabled) return { active: false, reason: '已停用' };
    if (!entry.content.trim()) return { active: false, reason: '内容为空' };
    if (entry.always) return { active: true, reason: '常驻' };
    const preset = Boolean(context.preset && entry.presets.some(item => presetKey(item) === presetKey(context.preset)));
    const character = Boolean(context.character && entry.characters.some(item => item.avatar === context.character.avatar));
    const bound = entry.presets.length + entry.characters.length > 0;
    const active = bound && (entry.match === 'all'
        ? (!entry.presets.length || preset) && (!entry.characters.length || character)
        : preset || character);
    return { active, reason: active ? preset && character ? '预设 + 角色' : preset ? '预设匹配' : '角色匹配'
        : bound ? '未匹配' : '未绑定' };
}

export function composedFeedback(settings, context = bindingContext()) {
    const entries = sortedEntries(settings).filter(entry => matchEntry(entry, context).active);
    return { context, entries, text: entries.map(entry => entry.content.trim()).join('\n\n') };
}

export function moveEntry(settings, id, step) {
    const ordered = sortedEntries(settings);
    const from = ordered.findIndex(entry => entry.id === id), to = from + step;
    if (from < 0 || to < 0 || to >= ordered.length) return;
    const entry = ordered[from], neighbor = ordered[to];
    const source = settings.feedbackEntries.indexOf(entry), target = settings.feedbackEntries.indexOf(neighbor);
    [entry.order, neighbor.order] = [neighbor.order, entry.order];
    [settings.feedbackEntries[source], settings.feedbackEntries[target]] = [neighbor, entry];
}

export function reorderEntry(settings, dragId, targetId, position = 'before') {
    if (!dragId || !targetId || dragId === targetId) return false;
    const ordered = sortedEntries(settings);
    const from = ordered.findIndex(entry => entry.id === dragId);
    const target = ordered.findIndex(entry => entry.id === targetId);
    if (from < 0 || target < 0) return false;
    const orders = ordered.map(entry => entry.order);
    const next = [...ordered];
    const [moved] = next.splice(from, 1);
    const insertAt = next.findIndex(entry => entry.id === targetId) + (position === 'after' ? 1 : 0);
    if (insertAt < 0) return false;
    next.splice(insertAt, 0, moved);
    if (next.every((entry, index) => entry === ordered[index])) return false;
    next.forEach((entry, index) => { entry.order = orders[index]; });
    settings.feedbackEntries = next;
    return true;
}

export function rebindCharacter(settings, oldAvatar, newAvatar) {
    if (!oldAvatar || !newAvatar || oldAvatar === newAvatar) return false;
    const ctx = getContext();
    const name = ctx.characters?.find(character => character?.avatar === newAvatar)?.name
        ?? newAvatar.replace(/\.[^.]+$/, '');
    let changed = false;
    for (const entry of settings.feedbackEntries ?? []) {
        for (const binding of entry.characters) if (binding.avatar === oldAvatar) {
            binding.avatar = newAvatar; binding.name = name; changed = true;
        }
    }
    return changed;
}
