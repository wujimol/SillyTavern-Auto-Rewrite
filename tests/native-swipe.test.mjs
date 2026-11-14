import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const constants = { SWIPE_STATE: { NONE: 'none' }, SWIPE_DIRECTION: { LEFT: 'left', RIGHT: 'right' },
    SWIPE_SOURCE: { SLASH_COMMAND: 'slash_command', SWIPE_PICKER: 'swipe_picker' }, OVERSWIPE_BEHAVIOR: { REGENERATE: 'regenerate' } };
const root = new URL('../', import.meta.url);

async function fixture({ swipes = ['original'], selected = 0, auto = false } = {}) {
    const handlers = new Map(), events = [], receipts = new Map(), logs = [], calls = [];
    const user = { is_user: true, mes: 'original input with recalled memory', qrf_plot: 'original plot' };
    const source = { is_user: false, mes: swipes[selected], swipe_id: selected, swipes: [...swipes],
        extra: { thirdParty: 'keep' }, swipe_info: swipes.map(() => ({ extra: { thirdParty: 'keep' } })),
        TavernDB_ACU_IsolatedData: { '': { sentinel: 'plugin-owned' } } };
    const ctx = { chat: [user, source], characterId: 0, groupId: null, chatId: 'fixture',
        extensionSettings: { rewrite_writer: { auto, feedback: 'rewrite instruction' } },
        extensionPrompts: { other: { value: 'keep this prompt' } },
        getCurrentChatId() { return this.chatId; }, substituteParams: text => text,
        saveSettingsDebounced() {}, saveChat: async () => {},
        setExtensionPrompt(key, value, position, depth, scan, role) { this.extensionPrompts[key] = { value, position, depth, scan, role }; },
        stopGeneration: async () => { await ctx.eventSource.emit('GENERATION_STOPPED'); },
    };
    const core = { is_send_press: false, isChatSaving: false, swipeState: 'none',
        extension_prompt_types: { IN_CHAT: 1 }, extension_prompt_roles: { USER: 1, ASSISTANT: 2 },
        overswipe: 'regenerate', getOverswipeBehavior: () => core.overswipe, redisplayChat: async () => {},
        syncMesToSwipe(index) {
            const m = ctx.chat[index];
            m.swipes[m.swipe_id] = m.mes;
            m.swipe_info[m.swipe_id] = { extra: structuredClone(m.extra) };
        },
        async deleteSwipe(swipeId, index) {
            const m = ctx.chat[index];
            const currentSwipe = m.swipe_id;
            m.swipes.splice(swipeId, 1); m.swipe_info.splice(swipeId, 1);
            m.swipe_id = Math.min(m.swipe_id, m.swipes.length - 1);
            m.mes = m.swipes[m.swipe_id]; m.extra = structuredClone(m.swipe_info[m.swipe_id].extra);
            await ctx.eventSource.emit('MESSAGE_SWIPE_DELETED', { messageId: index, swipeId });
            if (currentSwipe === swipeId) await ctx.eventSource.emit('MESSAGE_SWIPED', index);
        },
    };
    ctx.eventTypes = Object.fromEntries(['APP_READY', 'SETTINGS_LOADED', 'GENERATION_STARTED', 'MESSAGE_RECEIVED',
        'GENERATION_ENDED', 'GENERATION_STOPPED', 'MESSAGE_SWIPED', 'MESSAGE_UPDATED', 'MESSAGE_DELETED',
        'CHARACTER_MESSAGE_RENDERED', 'MORE_MESSAGES_LOADED', 'MESSAGE_SENT', 'USER_MESSAGE_RENDERED',
        'CHAT_CHANGED', 'CHAT_LOADED', 'TOOL_CALLS_PERFORMED'].map(key => [key,key]));
    ctx.eventSource = {
        on(name, fn) { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(fn); },
        removeListener(name, fn) { handlers.set(name, (handlers.get(name) || []).filter(h => h !== fn)); },
        async emit(name, ...args) { events.push({ name, args, length: ctx.chat.length }); for (const fn of [...(handlers.get(name) || [])]) await fn(...args); },
    };
    let ui, generate;
    ctx.swipe = { async to(event, direction, options) {
        calls.push({ direction, options });
        const m = ctx.chat[options.forceMesId];
        core.syncMesToSwipe(options.forceMesId);
        m.swipe_id = options.forceSwipeId;
        if (options.forceSwipeId < m.swipes.length) {
            m.mes = m.swipes[options.forceSwipeId];
            m.extra = structuredClone(m.swipe_info[options.forceSwipeId].extra);
            await ctx.eventSource.emit('MESSAGE_SWIPED', options.forceMesId);
            return;
        }
        await ctx.eventSource.emit('MESSAGE_SWIPED', options.forceMesId);
        core.is_send_press = true;
        try {
            await ctx.eventSource.emit('GENERATION_STARTED', 'swipe', {}, false);
            await generate?.();
            await ctx.eventSource.emit('GENERATION_ENDED', options.forceMesId);
        } finally {
            if (m.swipe_id >= m.swipes.length) {
                m.swipe_id = m.swipes.length - 1;
                m.mes = m.swipes[m.swipe_id]; m.extra = structuredClone(m.swipe_info[m.swipe_id].extra);
            }
            core.is_send_press = false;
        }
    } };
    let released = 0, acquired = 0;
    const routing = { acquire: () => { acquired++; let done = false; return { label: 'test route', release() { if (!done) { done = true; released++; } } }; } };
    const context = vm.createContext({ console: { error: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
        structuredClone, setTimeout, clearTimeout, requestAnimationFrame: callback => { callback(); return 1; }, document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
        sessionStorage: { getItem: key => receipts.get(key) ?? null, setItem: (key,value) => receipts.set(key,value), removeItem: key => receipts.delete(key) },
        jQuery() {}, $: () => ({ on() {}, off() {} }) });
    const exports = {
        '../../../../script.js': core, '../../../extensions.js': { getContext: () => ctx },
        '../../../constants.js': constants, '../../../chats.js': { hasPendingFileAttachment: () => false },
        '../../regex/engine.js': { getRegexedString: text => text, regex_placement: { USER_INPUT: 1 } },
        './model-routing.js': { createModelRouting: () => routing },
        './ui.js': { createRewriteUI(callbacks) { ui = callbacks; return { install() {}, refresh() {}, sync() {}, dispose() {}, openSettings() {} }; } },
    };
    const cache = new Map();
    async function load(url) {
        if (cache.has(url.href)) return cache.get(url.href);
        const module = new vm.SourceTextModule(await fs.readFile(url, 'utf8'), { context, identifier: url.href });
        cache.set(url.href, module);
        await module.link(async (id, parent) => {
            if (exports[id]) {
                const values = exports[id];
                return new vm.SyntheticModule(Object.keys(values), function () { for (const [key,value] of Object.entries(values)) this.setExport(key,value); }, { context });
            }
            return load(new URL(id, parent.identifier));
        });
        return module;
    }
    const entry = await load(new URL('index.js', root)); await entry.evaluate(); entry.namespace.enable();
    const native = await load(new URL('native-swipe.js', root));
    const finish = async (text = 'rewritten') => {
        source.mes = text; core.syncMesToSwipe(1);
        await ctx.eventSource.emit('MESSAGE_RECEIVED', 1, 'swipe');
        await ctx.eventSource.emit('CHARACTER_MESSAGE_RENDERED', 1, 'swipe');
    };
    generate = () => finish();
    const wait = async () => {
        for (let i=0; i<1000; i++) { if (!ui.getView().busy) return; await new Promise(resolve => setTimeout(resolve, 1)); }
        throw new Error('rewrite did not settle');
    };
    return { ctx, core, source, user, events, receipts, calls, logs, native: native.namespace, revisions: (await load(new URL('revisions.js', root))).namespace,
        ui: () => ui, routes: () => ({ acquired, released }), setGenerate: fn => { generate = fn; }, finish, wait,
        async rewrite() { ui.onRewrite(ui.getView().reply); await wait(); }, disable: () => entry.namespace.disable() };
}

test('manual rewrite uses a native same-floor swipe, without synthetic lifecycle events', async () => {
    const f = await fixture(); const storage = f.source.TavernDB_ACU_IsolatedData;
    f.setGenerate(async () => {
        assert.equal(f.ctx.chat.length, 2); assert.equal(f.ctx.chat[0], f.user);
        const prompts = Object.entries(f.ctx.extensionPrompts).filter(([key]) => key.startsWith('auto_rewrite_')).map(([,p]) => ({ role: p.role, value: p.value }));
        assert.deepEqual(prompts, [{ role: 2, value: 'original' }, { role: 1, value: 'rewrite instruction' }]);
        assert.equal(f.source.swipe_id, 1); await f.finish();
    });
    await f.rewrite();
    assert.equal(f.ctx.chat[1], f.source); assert.equal(f.ctx.chat.length, 2);
    assert.deepEqual(f.source.swipes, ['original','rewritten']); assert.equal(f.source.swipe_id, 1);
    assert.equal(f.source.TavernDB_ACU_IsolatedData, storage); assert.equal(f.user.qrf_plot, 'original plot');
    assert.equal(f.source.extra.thirdParty, 'keep');
    assert.deepEqual(f.events.filter(e => ['MESSAGE_SENT','USER_MESSAGE_RENDERED','MESSAGE_DELETED','MESSAGE_UPDATED'].includes(e.name)), []);
    assert.deepEqual(f.events.filter(e => e.name === 'MESSAGE_RECEIVED').map(e => e.args), [[1,'swipe']]);
    assert.equal(f.events.filter(e => e.name === 'MESSAGE_SWIPED').length, 1);
    assert.deepEqual(Object.keys(f.ctx.extensionPrompts), ['other']);
    assert.deepEqual(f.routes(), { acquired: 1, released: 1 }); assert.equal(f.receipts.size, 0);
    f.disable();
});

test('appends a new candidate even when rewriting an older swipe', async () => {
    const f = await fixture({ swipes: ['original','other','latest'], selected: 0 }); await f.rewrite();
    assert.deepEqual(f.source.swipes, ['original','other','latest','rewritten']); assert.equal(f.source.swipe_id, 3);
    assert.equal(f.calls[0].options.forceSwipeId, 3); f.disable();
});

test('rewriting a rewrite retains the original-version link', async () => {
    const f = await fixture(); await f.rewrite(); const hash = f.source.extra.auto_rewrite_revision.originalHash;
    await f.rewrite(); assert.equal(f.source.extra.auto_rewrite_revision.originalHash, hash);
    assert.equal(f.source.extra.auto_rewrite_revision.originalSwipe, 0); assert.equal(f.source.swipes.length, 3); f.disable();
});

test('version shortcut uses native selection in both directions without requesting a model', async () => {
    const f = await fixture(); await f.rewrite();
    assert.equal(f.ui().getView().link.target, 0);
    let view = f.ui().getView(); await f.ui().onJump(view.reply, view.link.target);
    assert.equal(f.source.mes, 'original'); assert.equal(f.source.swipe_id, 0);
    view = f.ui().getView(); assert.equal(view.link.target, 1);
    await f.ui().onJump(view.reply, view.link.target);
    assert.equal(f.source.mes, 'rewritten'); assert.equal(f.source.swipe_id, 1);
    assert.equal(f.events.filter(e => e.name === 'GENERATION_STARTED').length, 1);
    assert.equal(f.events.filter(e => e.name === 'MESSAGE_DELETED').length, 0);
    f.disable();
});

test('view handles an unmaterialized native swipe slot during streaming', async () => {
    const f = await fixture(); await f.rewrite();
    f.source.swipe_id = 0; f.source.mes = f.source.swipes[0];
    f.source.extra = structuredClone(f.source.swipe_info[0].extra);
    f.setGenerate(async () => {
        assert.equal(f.source.swipes[f.source.swipe_id], undefined);
        assert.doesNotThrow(() => f.ui().getView());
        await new Promise(resolve => setTimeout(resolve, 3)); await f.finish();
    });
    await f.rewrite(); assert.equal(f.source.swipes.length, 3); f.disable();
});

test('stop restores the original and discards only its unfinished candidate without deleting a floor', async () => {
    const f = await fixture();
    f.setGenerate(async () => { f.source.mes = 'partial'; f.core.syncMesToSwipe(1); await f.ctx.stopGeneration(); });
    await f.rewrite();
    assert.equal(f.source.mes, 'original'); assert.equal(f.source.swipe_id, 0);
    assert.deepEqual(f.source.swipes, ['original']);
    assert.equal(f.events.filter(e => e.name === 'MESSAGE_DELETED').length, 0);
    assert.equal(f.events.filter(e => e.name === 'MESSAGE_SWIPED').length, 2);
    assert.deepEqual(Object.keys(f.ctx.extensionPrompts), ['other']); f.disable();
});

test('host error before a result restores the existing original candidate', async () => {
    const f = await fixture(); f.setGenerate(() => { throw new Error('simulated API failure'); });
    await f.rewrite(); assert.equal(f.source.mes, 'original'); assert.equal(f.source.swipe_id, 0);
    assert.equal(f.ctx.chat.length, 2); assert.equal(f.receipts.size, 0); f.disable();
});

test('stop removes only the new candidate when rewriting an older version', async () => {
    const f = await fixture({ swipes: ['original', 'other', 'latest'], selected: 0 });
    f.setGenerate(async () => { f.source.mes = 'partial'; f.core.syncMesToSwipe(1); await f.ctx.stopGeneration(); });
    await f.rewrite();
    assert.deepEqual(f.source.swipes, ['original', 'other', 'latest']);
    assert.equal(f.source.swipe_id, 0); assert.equal(f.source.mes, 'original');
    const switches = f.events.filter(e => e.name === 'MESSAGE_SWIPED');
    assert.equal(switches.length, 2); f.disable();
});

test('ambiguous extra candidates are preserved on cancellation', async () => {
    const f = await fixture();
    f.setGenerate(async () => {
        f.source.mes = 'partial'; f.core.syncMesToSwipe(1);
        f.source.swipes.push('foreign candidate'); f.source.swipe_info.push({ extra: {} });
        await f.ctx.stopGeneration();
    });
    await f.rewrite();
    assert.deepEqual(f.source.swipes, ['original', 'partial', 'foreign candidate']);
    assert.equal(f.events.filter(e => e.name === 'MESSAGE_SWIPE_DELETED').length, 0);
    assert.equal(f.source.swipe_id, 0); f.disable();
});

test('a successful native result is not rolled back if only the metadata save fails', async () => {
    const f = await fixture(); f.ctx.saveChat = async () => { throw new Error('simulated save error'); };
    await f.rewrite(); assert.equal(f.source.mes, 'rewritten'); assert.equal(f.source.swipe_id, 1);
    assert.equal(await f.native.recoverNativeSwipe(), false); assert.equal(f.source.mes, 'rewritten');
    assert.equal(f.receipts.size, 0); f.disable();
});

test('does not touch another chat after a chat switch', async () => {
    const f = await fixture(); const other = [{ is_user: true, mes: 'another chat' }];
    f.setGenerate(async () => {
        f.ctx.chat = other; f.ctx.chatId = 'another'; await f.ctx.eventSource.emit('CHAT_CHANGED');
        assert.deepEqual(Object.keys(f.ctx.extensionPrompts), ['other']);
    });
    await f.rewrite(); assert.equal(f.ctx.chat, other); assert.equal(other.length, 1);
    assert.deepEqual(f.routes(), { acquired: 1, released: 1 }); f.disable();
});

test('a newly appended user message is never removed during failure cleanup', async () => {
    const f = await fixture(); const newUser = { is_user: true, mes: 'new input' };
    f.setGenerate(async () => { f.ctx.chat.push(newUser); await f.ctx.eventSource.emit('MESSAGE_SENT', 2); });
    await f.rewrite(); assert.equal(f.ctx.chat[2], newUser); assert.equal(f.ctx.chat.length, 3);
    assert.equal(f.calls.length, 1); f.disable();
});

test('an unrelated background generation releases route and prompt immediately', async () => {
    const f = await fixture();
    f.setGenerate(async () => {
        await f.ctx.eventSource.emit('GENERATION_STARTED', 'quiet', { automatic_trigger: true }, false);
        assert.deepEqual(Object.keys(f.ctx.extensionPrompts), ['other']);
        assert.equal(f.routes().released, 1);
    });
    await f.rewrite(); assert.equal(f.source.mes, 'original'); f.disable();
});

test('does not overwrite explicit loop/disabled overswipe behavior', async () => {
    const f = await fixture(); f.core.overswipe = 'loop';
    await f.rewrite(); assert.equal(f.calls.length, 0); assert.equal(f.source.swipes.length, 1);
    assert.deepEqual(Object.keys(f.ctx.extensionPrompts), ['other']); f.disable();
});

test('missing host swipe API fails without creating a floor', async () => {
    const f = await fixture(); f.ctx.swipe.to = undefined;
    await f.rewrite(); assert.equal(f.ctx.chat.length, 2); assert.equal(f.source.mes, 'original');
    assert.deepEqual(Object.keys(f.ctx.extensionPrompts), ['other']); f.disable();
});

test('prompt cleanup preserves an entry replaced by another owner', async () => {
    const f = await fixture(); let key;
    f.setGenerate(async () => {
        key = Object.keys(f.ctx.extensionPrompts).find(k => k.startsWith('auto_rewrite_'));
        f.ctx.extensionPrompts[key] = { value: 'replaced by another owner' }; await f.finish();
    });
    await f.rewrite(); assert.equal(f.ctx.extensionPrompts[key].value, 'replaced by another owner'); f.disable();
});

test('auto mode performs one rewrite and does not recursively rewrite its own candidate', async () => {
    const f = await fixture({ auto: true });
    await f.ctx.eventSource.emit('GENERATION_STARTED', 'normal', {}, false);
    await f.ctx.eventSource.emit('MESSAGE_RECEIVED', 1, 'normal');
    await f.ctx.eventSource.emit('GENERATION_ENDED', 1);
    await new Promise(resolve => setTimeout(resolve, 220)); await f.wait();
    await new Promise(resolve => setTimeout(resolve, 190));
    assert.equal(f.calls.length, 1); assert.equal(f.source.swipes.length, 2);
    f.disable();
});

test('interrupted native session recovers using existing candidate without cloning plugin data', async () => {
    const f = await fixture({ swipes: ['original','partial'], selected: 1 });
    const job = { id: 'recovery-test', key: '|0|fixture', index: 1, source: f.source, prefix: [f.user],
        attempt: { text: 'original', swipeId: 0 }, generating: true };
    // Generate an actual pending receipt through the production preparation code,
    // then simulate a page interruption before finalization.
    f.ctx.swipe.to = async () => {};
    await f.native.startNativeSwipe(job, 'feedback');
    const stored = [...f.receipts.values()][0]; assert.match(stored, /recovery-test/);
    let target;
    f.ctx.swipe.to = async (_event, _direction, options) => {
        target = options.forceSwipeId; f.source.swipe_id = target;
        f.source.mes = f.source.swipes[target]; f.source.extra = structuredClone(f.source.swipe_info[target].extra);
    };
    const storage = f.source.TavernDB_ACU_IsolatedData;
    assert.equal(await f.native.recoverNativeSwipe(), true); assert.equal(target, 0);
    assert.equal(f.source.TavernDB_ACU_IsolatedData, storage); assert.equal(f.source.mes, 'original');
    f.disable();
});


test('legacy interrupted temporary floors still recover with upstream scroll helpers', async () => {
    const f = await fixture();
    const originalData = f.source.TavernDB_ACU_IsolatedData;
    const id = 'legacy-recovery-test';
    f.ctx.chat.push({ is_user: true, mes: 'old feedback', extra: { auto_rewrite_temporary: { id } } },
        { is_user: false, mes: 'old interrupted reply' });
    f.receipts.set('st.auto-rewrite.pending:|0|fixture', JSON.stringify({
        id, index: 1, sourceSwipe: 0, sourceHash: f.revisions.fingerprint('original'),
    }));
    assert.equal(await f.revisions.recoverLegacyRewrite(), true);
    assert.equal(f.ctx.chat.length, 2); assert.equal(f.ctx.chat[1], f.source);
    assert.equal(f.source.mes, 'original'); assert.equal(f.source.TavernDB_ACU_IsolatedData, originalData);
    assert.equal(f.receipts.size, 0);
    assert.equal(f.events.filter(e => e.name === 'MESSAGE_DELETED').length, 1);
    f.disable();
});
