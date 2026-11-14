import * as core from '../../../../script.js';
import { getContext } from '../../../extensions.js';
import { SWIPE_DIRECTION, SWIPE_SOURCE, OVERSWIPE_BEHAVIOR } from '../../../constants.js';
import { REVISION, fingerprint } from './revisions.js';

const RECEIPT = 'st.auto-rewrite.native.pending:';
export const keyOf = ctx => `${ctx.groupId ?? ''}|${ctx.characterId ?? ''}|${ctx.getCurrentChatId() ?? ''}`;

function readReceipt(key) {
    try { return JSON.parse(sessionStorage.getItem(RECEIPT + key) || 'null'); }
    catch { return null; }
}

function forget(job) {
    try {
        if (readReceipt(job.key)?.id === job.id) sessionStorage.removeItem(RECEIPT + job.key);
    } catch { /* Recovery storage is optional. */ }
}

function remember(job, phase = 'pending') {
    try {
        sessionStorage.setItem(RECEIPT + job.key, JSON.stringify({ id: job.id, index: job.index,
            sourceSwipe: job.attempt.swipeId, sourceHash: fingerprint(job.attempt.text),
            initialSwipeCount: job.initialSwipeCount, candidateSwipe: job.candidateSwipe, phase }));
    } catch { /* Native swipes retain the original even without session storage. */ }
}

export function ownsNativeSwipe(job, ctx = getContext()) {
    return keyOf(ctx) === job.key && ctx.chat.length === job.index + 1
        && ctx.chat[job.index] === job.source && !job.source.is_user && !job.source.is_system
        && job.prefix.every((message, index) => ctx.chat[index] === message);
}

export function liveNativeReply(job) {
    if (!ownsNativeSwipe(job)) return null;
    return { key: job.key, index: job.index, message: job.source, text: job.source.mes,
        swipeId: job.source.swipe_id ?? 0, preview: !job.cancelled };
}

export function clearNativePrompt(job) {
    if (!job?.promptEntries) return;
    // Delete only the entry we installed, including after a chat switch. Never
    // erase an entry replaced by another owner or restore a stale prompt map.
    for (const { key, prompt } of job.promptEntries) {
        if (job.prompts?.[key] === prompt) delete job.prompts[key];
    }
    job.promptEntries = null;
}

export function claimNativeGeneration(job, type, options, dryRun) {
    if (dryRun || !job.generating || job.cancelled || !ownsNativeSwipe(job)) return false;
    if (!job.nativeStarted && type === 'swipe' && job.source.swipe_id === job.candidateSwipe) {
        job.nativeStarted = true;
        return true;
    }
    // Host tool continuations and host auto-swipes are handled by the host.
    // Their explicit signals are required; automatic_trigger alone is not an
    // ownership token for an unrelated background generation.
    if (job.toolContinuation && [undefined, 'normal'].includes(type)) {
        job.toolContinuation = false;
        return true;
    }
    if (type === 'swipe' && job.nativeStarted && job.source.swipe_id > job.candidateSwipe) {
        job.candidateSwipe = job.source.swipe_id;
        return true;
    }
    return false;
}

export async function startNativeSwipe(job, feedback) {
    const ctx = getContext();
    if (!ownsNativeSwipe(job, ctx)) throw new Error('聊天或原稿已变化');
    if (typeof ctx.swipe?.to !== 'function' || typeof ctx.setExtensionPrompt !== 'function'
        || !ctx.extensionPrompts || typeof core.getOverswipeBehavior !== 'function'
        || typeof core.syncMesToSwipe !== 'function' || typeof core.deleteSwipe !== 'function') {
        throw new Error('当前酒馆缺少原生 Swipe 或提示注入接口，请更新酒馆');
    }
    // Respect explicit non-swipeable, loop and disabled settings. Do not mutate
    // host preferences or third-party message metadata to force generation.
    if (core.getOverswipeBehavior(job.index, job.source) !== OVERSWIPE_BEHAVIOR.REGENERATE) {
        throw new Error('当前回复不允许向右生成新 Swipe，请先检查该回复的翻页设置');
    }
    job.candidateSwipe = Array.isArray(job.source.swipes) && job.source.swipes.length
        ? job.source.swipes.length : 1;
    job.initialSwipeCount = job.candidateSwipe;
    job.parentRevision = structuredClone(job.source.extra?.[REVISION] ?? null);
    job.prompts = ctx.extensionPrompts;
    job.promptEntries = [];
    // Preserve the author's assistant-draft / user-feedback conversation.
    // The host's depth-0 injection ordering places assistant before user.
    // No extra rewriting instructions, labels or delimiters are introduced.
    for (const [suffix, content, role] of [
        ['draft', job.attempt.text, core.extension_prompt_roles.ASSISTANT],
        ['feedback', feedback, core.extension_prompt_roles.USER],
    ]) {
        const key = `auto_rewrite_${job.id}_${suffix}`;
        ctx.setExtensionPrompt(key, content, core.extension_prompt_types.IN_CHAT, 0, false, role);
        job.promptEntries.push({ key, prompt: job.prompts[key] });
    }
    remember(job);
    try {
        // The host selects the new slot, syncs the original swipe, emits
        // MESSAGE_SWIPED and runs Generate('swipe'). It also owns streaming,
        // MESSAGE_RECEIVED, rendering, stopping and saving. No synthetic floors.
        await ctx.swipe.to(null, SWIPE_DIRECTION.RIGHT, { source: SWIPE_SOURCE.SLASH_COMMAND,
            forceMesId: job.index, forceSwipeId: job.candidateSwipe, forceDuration: 0 });
    } finally {
        clearNativePrompt(job);
    }
}

export async function completeNativeSwipe(job) {
    const ctx = getContext();
    if (!ownsNativeSwipe(job, ctx) || !job.nativeStarted || !job.received
        || job.source.swipe_id < job.candidateSwipe || !job.source.mes?.trim()
        || job.source.mes.trim() === '...'
        || typeof job.source.swipes?.[job.source.swipe_id] !== 'string') {
        throw new Error('未收到同一楼层的完整重写候选；已保留酒馆现有记录');
    }
    const message = job.source;
    const originalHash = job.parentRevision?.originalHash;
    const inherited = originalHash ? message.swipes.findIndex(text => fingerprint(text) === originalHash) : -1;
    const originalSwipe = inherited >= 0 ? inherited : job.attempt.swipeId;
    message.extra ??= {};
    message.extra[REVISION] = { id: job.id, originalSwipe,
        originalHash: fingerprint(message.swipes[originalSwipe]), sourceSwipe: job.attempt.swipeId,
        rewrittenSwipe: message.swipe_id, automatic: job.automatic, timing: { ...job.timing } };
    // Preserve the actual host message and all plugin-owned fields. Only our
    // revision metadata is added; the host remains responsible for swipe sync.
    core.syncMesToSwipe(job.index);
    job.settled = true;
    remember(job, 'completed');
    await ctx.saveChat();
    forget(job);
}

export async function restoreNativeSwipe(job) {
    clearNativePrompt(job);
    const ctx = getContext();
    if (!ownsNativeSwipe(job, ctx)) return false;
    const original = job.source.swipes?.[job.attempt.swipeId];
    if (original === undefined && !job.nativeStarted && job.source.mes === job.attempt.text) {
        forget(job); return true;
    }
    if (typeof original !== 'string' || fingerprint(original) !== fingerprint(job.attempt.text)) return false;
    // The old implementation discarded an interrupted temporary reply. Match
    // that result by deleting only our single new candidate via the host API.
    // Extra or ambiguous candidates are left untouched instead of guessing.
    const discardCandidate = job.initialSwipeCount === job.candidateSwipe
        && job.source.swipes.length === job.initialSwipeCount + 1
        && job.source.swipe_id === job.candidateSwipe;
    const candidateText = job.source.mes;
    if (job.source.swipe_id !== job.attempt.swipeId) {
        // Switching back emits the same MESSAGE_SWIPED notification as an
        // ordinary picker; an attributable partial candidate is removed below.
        await ctx.swipe.to(null, SWIPE_DIRECTION.LEFT, { source: SWIPE_SOURCE.SWIPE_PICKER,
            forceMesId: job.index, forceSwipeId: job.attempt.swipeId, forceDuration: 0 });
    }
    if (!ownsNativeSwipe(job, ctx) || job.source.swipe_id !== job.attempt.swipeId
        || job.source.mes !== original) return false;
    if (discardCandidate && job.source.swipes.length === job.initialSwipeCount + 1
        && job.source.swipes[job.candidateSwipe] === candidateText) {
        // Delete an inactive candidate so the host does not briefly select a
        // different old candidate while restoring the requested original.
        await core.deleteSwipe(job.candidateSwipe, job.index);
        if (!ownsNativeSwipe(job, ctx) || job.source.swipe_id !== job.attempt.swipeId) return false;
    }
    job.settled = true;
    await ctx.saveChat();
    forget(job);
    return true;
}

export async function recoverNativeSwipe() {
    const ctx = getContext(), key = keyOf(ctx), saved = readReceipt(key);
    if (!saved) return false;
    if (saved.phase === 'completed') { forget({ ...saved, key }); return false; }
    if (!Number.isInteger(saved.index) || !Number.isInteger(saved.sourceSwipe)
        || saved.index !== ctx.chat.length - 1) return false;
    const source = ctx.chat[saved.index], text = source?.swipes?.[saved.sourceSwipe];
    if (!source || source.is_user || source.is_system || typeof text !== 'string'
        || fingerprint(text) !== saved.sourceHash) return false;
    return restoreNativeSwipe({ ...saved, key, source, prefix: ctx.chat.slice(0, saved.index),
        nativeStarted: true, attempt: { text, swipeId: saved.sourceSwipe } });
}
