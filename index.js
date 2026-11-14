import * as core from '../../../../script.js';
import { getContext } from '../../../extensions.js';
import { SWIPE_STATE } from '../../../constants.js';
import { hasPendingFileAttachment } from '../../../chats.js';
import { getRegexedString, regex_placement } from '../../regex/engine.js';
import { createRewriteUI } from './ui.js';
import { createModelRouting } from './model-routing.js';
import { mvuBusy, mvuFeedback, prepareMvu, resetMvuFeedback, finishMvu, syncMvuChat, waitMvuWindow } from './mvu-compat.js';
import { REVISION, TEMP, remember, collapse, restore, recover, markStaging, liveReply, showStaging, versionLink, jumpVersion } from './revisions.js';

const KEY = 'rewrite_writer';
const RUNTIME = Symbol.for('st.auto-rewrite.standalone');
const DEFAULT_FEEDBACK = `上一轮正文剧情写的太烂了，角色们（不局限于{{user}}）的言行举止刻画的很烂，角色们的心理刻画很烂毫无深度可言，又肤浅又烂，台词很烂。那些优秀的网文角色塑造，哪个不是吊打你这破内容。剧情很烂。文风很烂。烂完了!  重写！

写本轮正文前，先用<prex>...</prex>做一次预分析，挑出上一轮的问题。</prex>后空一行，再写<content>。

分析不少于2000字

每部分最后用一两句写出"本轮改法"。正文要照着这些改法写，不能分析完了照旧。`;
let installed = false;
let ui;
let cycle;
let pending;
let running;
let timer;
let sequence = 0;
let mvuReadyAt = 0;
let status = '等待下一次生成';
const subscriptions = [];
const routing = createModelRouting();

function settings() {
    const all = getContext().extensionSettings;
    if (!all[KEY] || typeof all[KEY] !== 'object') all[KEY] = {};
    if (typeof all[KEY].auto !== 'boolean') all[KEY].auto = false;
    if (typeof all[KEY].feedback !== 'string') all[KEY].feedback = DEFAULT_FEEDBACK;
    if (typeof all[KEY].profileId !== 'string') all[KEY].profileId = '';
    if (typeof all[KEY].model !== 'string') all[KEY].model = '';
    return all[KEY];
}

function chatKey(ctx = getContext()) {
    return `${ctx.groupId ?? ''}|${ctx.characterId ?? ''}|${ctx.getCurrentChatId() ?? ''}`;
}

function isSingleChat(ctx) {
    return !ctx.groupId && ctx.characterId != null;
}

function composerBusy() {
    return Boolean(document.getElementById('send_textarea')?.value.trim()) || hasPendingFileAttachment();
}

function isIdle(ctx = getContext()) {
    // A finished stream can still be saving or emitting message events. Wait until
    // core releases it entirely; no private finalization flag or core patch is needed.
    return !core.is_send_press && !core.isChatSaving && !ctx.streamingProcessor
        && (core.swipeState == null || core.swipeState === SWIPE_STATE.NONE)
        && !document.querySelector('.mes_edit_textarea') && !mvuBusy();
}

function setStatus(text) {
    status = text;
    ui?.refresh();
}

function clearPending() {
    clearTimeout(timer);
    timer = undefined;
    pending = null;
}

function matches(attempt, ctx = getContext(), checkText = true) {
    const last = ctx.chat.at(-1);
    return chatKey(ctx) === attempt.key && isSingleChat(ctx)
        && last === attempt.message && !last.is_user && !last.is_system
        && ctx.chat.length - 1 === attempt.index
        && (last.swipe_id ?? 0) === attempt.swipeId && (!checkText || last.mes === attempt.text);
}

function latestReply(ctx = getContext()) {
    const message = ctx.chat.at(-1);
    if (!isSingleChat(ctx) || !message || message.is_user || message.is_system || !message.mes?.trim() || message.mes.trim() === '...') return null;
    return { key: chatKey(ctx), index: ctx.chat.length - 1, message, text: message.mes, swipeId: message.swipe_id ?? 0 };
}

function view() {
    const ctx = getContext();
    const reply = running && chatKey(ctx) === running.key && ctx.chat[running.index] === running.source
        ? liveReply(running) ?? { ...running.attempt, message: running.source, preview: !running.cancelled } : latestReply(ctx);
    const saved = reply?.message.extra?.[REVISION];
    return { reply, link: versionLink(reply), status, busy: Boolean(running), cancelled: Boolean(running?.cancelled),
        idle: isIdle(ctx), composerBusy: composerBusy(), timing: running?.timing ?? saved?.timing,
        automatic: running ? running.automatic : saved?.automatic };
}

function manualRewrite(attempt) {
    if (!attempt || running) return;
    if (!matches(attempt) || !isIdle()) {
        globalThis.toastr?.info('请等生成、保存或翻页完成后，再点击当前版本的重写。');
        ui?.refresh(); return;
    }
    if (composerBusy()) { globalThis.toastr?.info('请先发送或清空输入框中的草稿与附件。'); return; }
    clearPending();
    if (cycle) cycle.attempted = true;
    void rewrite(attempt, false);
}

async function jump(attempt, target) {
    if (!attempt || running || !isIdle() || !matches(attempt)) return;
    clearPending();
    try { await jumpVersion(attempt, target); }
    catch (error) { console.error('[Auto Rewrite] Version switch', error); globalThis.toastr?.warning('版本切换未完成，请等保存结束后重试。'); }
    finally { ui?.refresh(); }
}

function subscribe(type, handler) {
    if (!type) return;
    const ctx = getContext();
    ctx.eventSource.on(type, handler);
    subscriptions.push([type, handler]);
}

function queue() {
    clearTimeout(timer);
    if (!installed || !settings().auto || !pending || running) return;
    timer = setTimeout(() => {
        timer = undefined;
        if (!installed || !settings().auto || !pending || running) return;
        const attempt = pending;
        const ctx = getContext();
        if (!cycle || cycle.id !== attempt.cycleId || cycle.attempted || !matches(attempt, ctx, false)) {
            clearPending();
            setStatus('聊天或回复已变化，已取消本次自动重写');
            return;
        }
        if (!isIdle(ctx)) { setStatus('等待首轮生成和保存完成'); queue(); return; }
        if (composerBusy()) { setStatus('输入框有草稿或附件，暂缓自动重写'); queue(); return; }
        // Capture the finalized text after receive/render handlers and MVU's
        // extra-model parsing, rather than before their status/variable additions.
        attempt.text = attempt.message.mes;
        if (!attempt.text?.trim() || attempt.text.trim() === '...') { clearPending(); return; }
        cycle.attempted = true;
        clearPending();
        void rewrite(attempt);
    }, 150);
}

function sameJob(job) {
    return installed && running === job && !job.cancelled && chatKey() === job.key;
}

function appendFeedback(ctx, text, job) {
    // Keep the original assistant text as the draft being reviewed. MVU variables
    // are temporarily rebased separately, without changing the saved draft text.
    const message = {
        name: ctx.name1,
        is_user: true,
        is_system: false,
        send_date: new Date().toISOString(),
        mes: ctx.substituteParams(getRegexedString(text, regex_placement.USER_INPUT)),
        extra: { [TEMP]: { id: job.id, sourceIndex: job.index } },
    };
    if (!message.mes.trim()) throw new Error('修改意见被用户输入正则清空');
    remember(job);
    const avatar = core.user_avatar;
    if (avatar && Object.hasOwn(ctx.powerUserSettings?.personas ?? {}, avatar)) {
        message.force_avatar = ctx.getThumbnailUrl('persona', avatar);
    }
    const index = ctx.chat.length;
    ctx.chat.push(message);
    if (ctx.chatMetadata) ctx.chatMetadata.tainted = true;
    ctx.addOneMessage(message, { scroll: false });
    return { message, index };
}

async function rewrite(attempt, automatic = true) {
    if (running) return;
    const ctx = getContext();
    const feedback = settings().feedback.trim();
    if (!feedback) { setStatus('请先填写修改意见'); ui?.openSettings(); return; }
    if (!matches(attempt, ctx) || !isIdle(ctx) || composerBusy()) return;
    const now = Date.now();
    const firstStarted = Date.parse(attempt.message.gen_started);
    const job = { id: `rewrite-${now.toString(36)}-${Math.random().toString(36).slice(2)}`,
        key: attempt.key, index: attempt.index, attempt, source: attempt.message,
        original: structuredClone(attempt.message), prefix: ctx.chat.slice(0, attempt.index),
        cancelled: false, generating: false, automatic,
        timing: { startedAt: automatic && Number.isFinite(firstStarted) ? Math.min(firstStarted, now) : now, rewriteStartedAt: now } };
    running = job;
    setStatus('正在准备重写');
    try {
        prepareMvu(job);
        const { message, index } = appendFeedback(ctx, feedback + (job.mvu ? mvuFeedback : ''), job);
        job.feedback = message;
        resetMvuFeedback(job);
        markStaging(job);
        await ctx.saveChat();
        if (!sameJob(job) || getContext().chat.at(-1) !== message) throw new Error('重写已取消或聊天已变化');
        await ctx.eventSource.emit(ctx.eventTypes.MESSAGE_SENT, index);
        if (!sameJob(job) || getContext().chat.at(-1) !== message) throw new Error('重写已取消或聊天已变化');
        await ctx.eventSource.emit(ctx.eventTypes.USER_MESSAGE_RENDERED, index);
        if (!sameJob(job) || getContext().chat.at(-1) !== message) throw new Error('重写已取消或聊天已变化');
        resetMvuFeedback(job);
        if (composerBusy()) {
            throw new Error('输入框中出现了新草稿或附件，本次重写已停止');
        }
        if (job.mvu) {
            setStatus('等待 MVU 解析窗口');
            await waitMvuWindow(mvuReadyAt, () => sameJob(job) && getContext().chat.at(-1) === message);
            if (composerBusy()) throw new Error('输入框中出现了新草稿或附件，本次重写已停止');
        }
        // Standard generation, exactly as replying to the newly added user turn.
        // This guard remains set through all native tool-call continuation requests.
        job.route = routing.acquire({ ...settings() }, () => sameJob(job) && job.generating && !mvuBusy());
        job.generating = true;
        setStatus(`${automatic ? '正在自动重写' : '正在重写'} · ${job.route.label}`);
        await getContext().generate('normal', { automatic_trigger: true });
        if (!sameJob(job)) throw new Error('重写已取消或聊天已变化');
        const last = getContext().chat.at(-1);
        if (!last || last === job.source || last.is_user || last.is_system || !last.mes?.trim() || last.mes.trim() === '...') throw new Error('未收到可用的重写正文');
        if (job.mvu) setStatus('正在整理重写稿的 MVU 变量');
        await finishMvu(job, last, () => sameJob(job) && getContext().chat.at(-1) === last);
        job.timing.finishedAt = Date.now();
        await collapse(job, last);
        setStatus('重写已完成，原稿已保存为上一版');
    } catch (error) {
        job.timing.finishedAt ??= Date.now();
        if (!job.settled) {
            const restored = await restore(job).catch(cleanupError => { console.error('[Auto Rewrite] Cleanup', cleanupError); return false; });
            if (installed && chatKey() === job.key) {
                setStatus(restored ? job.cancelled ? '重写已取消，原稿已恢复' : '重写未完成，原稿已保留' : '聊天已变化，保留记录供检查，未覆盖新内容');
                if (!job.cancelled) globalThis.toastr?.warning(`${status}：${error.message}`);
            }
        } else if (installed && chatKey() === job.key) {
            setStatus('回复版本已保留，保存或界面更新未完成');
            globalThis.toastr?.warning(status);
        }
        if (!job.cancelled) console.error('[Auto Rewrite]', error);
    } finally {
        job.route?.release();
        showStaging();
        if (running === job) running = null;
        ui?.sync();
        ui?.refresh();
    }
}

async function recoverInterrupted() {
    if (!installed || running || !isIdle()) return;
    try { if (await recover()) setStatus('已清理中断的重写，原稿已恢复'); }
    catch (error) { console.error('[Auto Rewrite] Recovery', error); }
    ui?.refresh();
}

export function enable() {
    if (installed) return;
    globalThis[RUNTIME]?.disable?.();
    installed = true;
    globalThis[RUNTIME] = { disable };
    const { eventTypes: events } = getContext();
    ui = createRewriteUI({ getSettings: settings, getView: view, onRewrite: manualRewrite, onJump: jump,
        getRouting: () => routing.describe(settings()),
        onRoute: value => { Object.assign(settings(), value); getContext().saveSettingsDebounced(); },
        onRefreshModels: signal => routing.refreshModels({ ...settings() }, signal),
        onMainProfile: id => { routing.setMainProfile(id); ui?.sync(); ui?.refresh(); },
        onMainModel: model => { routing.setMainModel(model); ui?.sync(); ui?.refresh(); },
        onRefreshMainModels: signal => routing.refreshModels({ profileId: '', model: '' }, signal),
        onMutation: () => markStaging(running),
        onAuto: value => {
            settings().auto = value; getContext().saveSettingsDebounced();
            if (!value) clearPending();
            setStatus(value ? '等待下一次生成' : running ? '当前重写继续进行，后续自动重写已关闭' : '自动重写已关闭');
        },
        onFeedback: value => { settings().feedback = value; getContext().saveSettingsDebounced(); } });
    ui.install();
    subscribe(events.APP_READY, () => { ui?.install(); void recoverInterrupted(); });
    subscribe(events.SETTINGS_LOADED, () => { ui?.sync(); ui?.refresh(); });
    for (const type of [events.CONNECTION_PROFILE_CREATED, events.CONNECTION_PROFILE_UPDATED,
        events.CONNECTION_PROFILE_DELETED, events.CONNECTION_PROFILE_LOADED,
        events.CHATCOMPLETION_MODEL_CHANGED, events.SETTINGS_UPDATED]) {
        if (type) subscribe(type, () => { ui?.sync(); ui?.refresh(); });
    }
    subscribe(events.GENERATION_STARTED, (type, options, dryRun) => {
        if (dryRun) return;
        // An MVU extra-model request belongs to the active turn, not a new
        // user generation that should take over or invalidate the rewrite.
        if (mvuBusy()) return;
        if (running) {
            // Another extension started a request while feedback events were firing.
            if (!running.generating || !options?.automatic_trigger) { running.cancelled = true; running.timing.finishedAt ??= Date.now(); setStatus('已由其他生成流程接管'); }
            return;
        }
        clearPending();
        cycle = { id: ++sequence, key: chatKey(), attempted: false,
            eligible: [undefined, 'normal', 'regenerate', 'swipe'].includes(type) && isSingleChat(getContext()) };
        ui?.refresh();
    });
    subscribe(events.MESSAGE_RECEIVED, (id, type) => {
        markStaging(running); ui?.refresh();
        if (running || !settings().auto || !cycle?.eligible || cycle.attempted || type === 'first_message') return;
        const ctx = getContext();
        const stream = ctx.streamingProcessor;
        if (stream?.isStopped || stream?.abortController?.signal.aborted) return;
        const message = ctx.chat.at(-1);
        const text = message?.mes;
        if (chatKey(ctx) !== cycle.key || Number(id) !== ctx.chat.length - 1 || !message
            || message.is_user || message.is_system || !text?.trim() || text.trim() === '...') return;
        pending = { cycleId: cycle.id, key: cycle.key, index: Number(id), message, text, swipeId: message.swipe_id ?? 0 };
        queue();
    });
    subscribe(events.GENERATION_ENDED, () => {
        if (!running) mvuReadyAt = Date.now() + 3100;
        ui?.refresh(); queue();
    });
    subscribe(events.MESSAGE_EDITED, id => {
        // Automatic finalization may accept MVU's programmatic text additions,
        // but an explicit user edit still cancels the queued rewrite.
        if (pending && Number(id) === pending.index) {
            clearPending();
            setStatus('回复已编辑，已取消本次自动重写');
        }
    });
    subscribe(events.MESSAGE_SWIPED, async id => {
        const ctx = getContext();
        if (running || Number(id) !== ctx.chat.length - 1) return;
        if (syncMvuChat(ctx.chat[Number(id)])) await ctx.saveChat();
    });
    subscribe(events.GENERATION_STOPPED, () => {
        clearPending(); cycle = null;
        if (running) { running.cancelled = true; running.timing.finishedAt ??= Date.now(); }
        markStaging(running);
        setStatus(running ? '已取消，正在恢复原稿' : '已停止生成');
    });
    for (const type of [events.CHAT_CHANGED, events.MAIN_API_CHANGED, events.OAI_PRESET_CHANGED_BEFORE,
        events.CONNECTION_PROFILE_LOADED]) subscribe(type, () => {
        clearPending(); cycle = null;
        if (running) { running.cancelled = true; running.timing.finishedAt ??= Date.now(); }
        setStatus('上下文已切换，等待下一次生成');
        ui?.sync();
        void recoverInterrupted();
    });
    subscribe(events.CHAT_LOADED, () => { ui?.install(); void recoverInterrupted(); });
    for (const type of [events.MESSAGE_SWIPED, events.MESSAGE_UPDATED, events.MESSAGE_DELETED,
        events.CHARACTER_MESSAGE_RENDERED, events.MORE_MESSAGES_LOADED]) subscribe(type, () => ui?.refresh());
    subscribe(events.MESSAGE_SENT, id => {
        if (running && getContext().chat[Number(id)] !== running.feedback) {
            running.cancelled = true; running.timing.finishedAt ??= Date.now(); showStaging();
        }
    });
    $(document).on('input.autoRewriteComposer change.autoRewriteComposer', '#send_textarea, #file_form_input', () => ui?.refresh());
    void recoverInterrupted();
}

export function disable() {
    installed = false;
    clearPending(); cycle = null;
    const job = running;
    if (job) {
        job.cancelled = true;
        if (job.generating) getContext().stopGeneration();
    }
    const ctx = getContext();
    for (const [type, handler] of subscriptions.splice(0)) ctx.eventSource.removeListener(type, handler);
    $(document).off('.autoRewriteComposer');
    ui?.dispose(); ui = null;
    showStaging();
}

jQuery(enable);
