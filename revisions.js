import * as core from '../../../../script.js';
import { getContext } from '../../../extensions.js';
import { SWIPE_DIRECTION, SWIPE_SOURCE } from '../../../constants.js';

export const REVISION = 'auto_rewrite_revision';
export const TEMP = 'auto_rewrite_temporary';
const RECEIPT = 'st.auto-rewrite.pending:';
export const keyOf = ctx => `${ctx.groupId ?? ''}|${ctx.characterId ?? ''}|${ctx.getCurrentChatId() ?? ''}`;

export function fingerprint(text) {
    let value = 2166136261;
    for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
    return `${text.length}:${value >>> 0}`;
}

function forget(job) {
    try {
        const saved = JSON.parse(sessionStorage.getItem(RECEIPT + job.key) || 'null');
        if (saved?.id === job.id) sessionStorage.removeItem(RECEIPT + job.key);
    } catch { /* Storage is optional. */ }
}

function ownsTail(job, ctx = getContext()) {
    return keyOf(ctx) === job.key && ctx.chat[job.index] === job.source
        && job.source.mes === job.attempt.text && (job.source.swipe_id ?? 0) === job.attempt.swipeId
        && job.prefix.every((message, i) => ctx.chat[i] === message)
        && ctx.chat[job.index + 1] === job.feedback && job.feedback?.extra?.[TEMP]?.id === job.id
        && ctx.chat.slice(job.index + 2).every(message => !message.is_user);
}

function captureAnchor(index, preserve = false) {
    const viewport = document.getElementById('chat');
    if (!viewport) return null;
    const top = viewport.getBoundingClientRect().top;
    const anchor = [...viewport.querySelectorAll(':scope > .mes')]
        .find(node => !node.classList.contains('auto-rewrite-staging')
            && !node.classList.contains('auto-rewrite-preview-covered')
            && node.getBoundingClientRect().bottom > top);
    const anchorId = Number(anchor?.getAttribute('mesid'));
    const readingAbove = Number.isInteger(anchorId) && anchorId < index;
    const body = anchor?.querySelector('.mes_text') || anchor;
    const bodyOffset = body ? body.getBoundingClientRect().top - top : 12;
    return {
        viewport,
        targetId: readingAbove ? anchorId : index,
        useBody: !readingAbove,
        offset: readingAbove ? anchor.getBoundingClientRect().top - top : preserve && anchor ? Math.min(bodyOffset, 12) : 12,
    };
}

function applyAnchor(pin) {
    if (!pin?.viewport?.isConnected) return;
    const target = pin.viewport.querySelector(`.mes[mesid="${pin.targetId}"]`);
    if (!target) return;
    const el = pin.useBody ? target.querySelector('.mes_text') || target : target;
    pin.viewport.scrollTop += (el.getBoundingClientRect().top - pin.viewport.getBoundingClientRect().top) - pin.offset;
}

async function redraw(index, key, { preserve = false } = {}) {
    if (keyOf(getContext()) !== key) return null;
    const pin = captureAnchor(index, preserve);
    await core.redisplayChat({ startIndex: index, fade: false });
    if (keyOf(getContext()) !== key) return null;
    applyAnchor(pin);
    return pin;
}

async function restore(job) {
    if (!job.feedback) { forget(job); return true; }
    const ctx = getContext();
    if (!ownsTail(job, ctx)) return false;
    ctx.chat.splice(job.index + 1);
    job.settled = true;
    await ctx.saveChat();
    forget(job);
    const pin = await redraw(job.index, job.key, { preserve: true });
    if (keyOf(getContext()) !== job.key) return true;
    await ctx.eventSource.emit(ctx.eventTypes.MESSAGE_DELETED, ctx.chat.length);
    requestAnimationFrame(() => { if (keyOf(getContext()) === job.key) applyAnchor(pin); });
    if (keyOf(getContext()) === job.key) await ctx.saveChat();
    return true;
}

export async function recoverLegacyRewrite() {
    const ctx = getContext();
    let saved;
    try { saved = JSON.parse(sessionStorage.getItem(RECEIPT + keyOf(ctx)) || 'null'); } catch { return false; }
    if (!saved || !Number.isInteger(saved.index)) return false;
    const source = ctx.chat[saved.index];
    const feedback = ctx.chat[saved.index + 1];
    if (!source || source.is_user || source.is_system || fingerprint(source.mes ?? '') !== saved.sourceHash || feedback?.extra?.[TEMP]?.id !== saved.id) return false;
    return restore({ ...saved, key: keyOf(ctx), source, feedback, prefix: ctx.chat.slice(0, saved.index),
        attempt: { text: source.mes, swipeId: saved.sourceSwipe } });
}

export function versionLink(reply) {
    const message = reply?.message;
    if (!message || !Array.isArray(message.swipes)) return null;
    const current = message.swipe_id ?? 0;
    // Native overswipe selects the new slot before the first streamed token
    // creates its swipes entry. There is no version link during that window.
    if (!Number.isInteger(current) || typeof message.swipes[current] !== 'string') return null;
    const record = message.extra?.[REVISION];
    const originalSwipe = record?.originalHash ? message.swipes.findIndex(text => fingerprint(text) === record.originalHash) : record?.originalSwipe;
    if (Number.isInteger(originalSwipe) && originalSwipe >= 0
        && originalSwipe < message.swipes.length && originalSwipe !== current) {
        return { target: originalSwipe, label: '查看原稿', original: false };
    }
    for (let i = message.swipes.length - 1; i >= 0; i--) {
        const item = message.swipe_info?.[i]?.extra?.[REVISION];
        const sameOriginal = item?.originalHash ? item.originalHash === fingerprint(message.swipes[current]) : item?.originalSwipe === current;
        if (i !== current && item && sameOriginal) return { target: i, label: '返回重写版', original: true };
    }
    return null;
}

export async function jumpVersion(reply, target) {
    const ctx = getContext();
    const message = ctx.chat[reply.index];
    if (keyOf(ctx) !== reply.key || message !== reply.message || (message.swipe_id ?? 0) !== reply.swipeId
        || !Number.isInteger(target) || target < 0 || target >= (message.swipes?.length ?? 0)) return;
    await ctx.swipe.to(null, target < reply.swipeId ? SWIPE_DIRECTION.LEFT : SWIPE_DIRECTION.RIGHT,
        { source: SWIPE_SOURCE.SWIPE_PICKER, forceMesId: reply.index, forceSwipeId: target, forceDuration: 0 });
    if (keyOf(getContext()) === reply.key) {
        await ctx.saveChat();
    }
}
