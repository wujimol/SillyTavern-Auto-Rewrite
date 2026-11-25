import { getContext } from '../../../extensions.js';
import { backgroundDelay } from './background-scheduler.js';

// MVU stores a complete state in message.variables[swipe_id], outside swipe_info.
// Keep only its own fields in the transaction so other scripts retain their data.
const FIELDS = ['initialized_lorebooks', 'stat_data', 'schema', 'display_data', 'delta_data'];
const TRANSACTION = 'auto_rewrite_mvu';
// 重写稿重新计算变量时追加的约定。关闭「重写时更新变量」后插件完全不追加任何文字：
// 变量更新块出不出、怎么写，由用户自己的预设和世界书决定，本插件不代为要求也不代为禁止。
export const mvuFeedback = '\n\n【MVU 重写约定】本次是替换上一版正文，不是推进下一轮剧情。上一版的变量更新作废；当前提供的变量是本轮开始前的状态。请仍按原预设与角色卡格式要求在末尾保留变量更新块（如 <UpdateVariable> / <JSONPatch> 等），不要将其当作“正文之外的内容”省略；计算变量更新时只基于本轮开始前的状态，不要累加上一版的变化。';

export function mvuBusy() {
    return Boolean(globalThis.Mvu?.isDuringExtraAnalysis?.());
}

export async function waitMvuWindow(readyAt, isCurrent) {
    // MVU drops receive events inside its 3-second leading-only throttle. Wait
    // before starting the second request so even a cached/short reply is parsed.
    while (Date.now() < readyAt || mvuBusy()) {
        if (!isCurrent()) throw new Error('重写已取消或聊天已变化');
        await backgroundDelay(100);
    }
    if (!isCurrent()) throw new Error('重写已取消或聊天已变化');
}

const activeData = message => message?.variables?.[message.swipe_id ?? 0];
const isMvuData = data => data?.stat_data != null && data?.schema != null;
export function mvuTransaction(message, id = null) {
    const direct = message?.extra?.[TRANSACTION];
    if (direct && (id == null || direct.id === id)) return direct;
    if (Array.isArray(message?.swipe_info)) {
        for (const entry of message.swipe_info) {
            const record = entry?.extra?.[TRANSACTION];
            if (record && (id == null || record.id === id)) return record;
        }
    }
    return undefined;
}

function pick(data) {
    const result = {};
    for (const field of FIELDS) {
        if (data && Object.hasOwn(data, field)) result[field] = structuredClone(data[field]);
    }
    return result;
}

function replaceFields(target, data) {
    for (const field of FIELDS) {
        if (Object.hasOwn(data, field)) target[field] = structuredClone(data[field]);
        else delete target[field];
    }
}

function slot(message, swipe = message.swipe_id ?? 0) {
    message.variables ??= [];
    return message.variables[swipe] ??= {};
}

export function prepareMvu(job, { updateVariables = true } = {}) {
    const ctx = getContext();
    const current = activeData(job.source);
    const active = Boolean(globalThis.Mvu);
    // No MVU dependency is introduced for ordinary chats or other variable systems.
    if (!active && !isMvuData(current)) return;
    let baseline;
    for (let i = job.index - 1; i >= 0; i--) {
        const data = activeData(ctx.chat[i]);
        if (isMvuData(data)) { baseline = pick(data); break; }
    }
    if (!baseline && !isMvuData(current)) return;
    if (!active) {
        // Legacy MVU data exists in chat history, but MVU itself is not loaded.
        // Preserve the existing snapshot on the rewritten swipe without blocking.
        baseline ??= pick(current);
    } else if (updateVariables) {
        if (!baseline) throw new Error('找不到本轮开始前的 MVU 变量快照，已保留原稿；请先用 MVU 恢复历史楼层变量');
        if (!isMvuData(current)) throw new Error('本轮 MVU 变量尚未写入，请等变量更新完成后再重写');
    } else {
        // 不重算变量时不需要本轮开始前的快照，沿用上一版结果即可。
        baseline ??= pick(current);
    }
    const transaction = {
        id: job.id, swipe: job.attempt.swipeId, active, updateVariables,
        original: pick(current), baseline,
        chat: pick(ctx.chatMetadata?.variables),
        mirrorChat: isMvuData(ctx.chatMetadata?.variables),
    };
    job.mvu = transaction;
    // Persist the undo information on the source alongside the temporary feedback.
    // It survives reloads, unlike the in-memory job or sessionStorage receipt alone.
    job.source.extra ??= {};
    job.source.extra[TRANSACTION] = transaction;
    // 不重算变量时不回拨：重写稿直接沿用上一版的变量结果。
    if (!updateVariables) return;
    replaceFields(slot(job.source), baseline);
    if (transaction.mirrorChat) replaceFields(ctx.chatMetadata.variables, baseline);
}

export function resetMvuFeedback(job) {
    if (!job.mvu) return;
    // MESSAGE_SENT runs MVU and other listeners. Discard any variable commands in
    // the temporary feedback and give prompt macros/extra-model parsing the state
    // this rewrite is anchored to: the turn baseline, or the previous version's
    // result when variable updates are switched off.
    const state = job.mvu.updateVariables === false ? job.mvu.original : job.mvu.baseline;
    replaceFields(slot(job.feedback), state);
    if (job.mvu.mirrorChat) replaceFields(getContext().chatMetadata.variables, state);
}

export async function finishMvu(job, result, isCurrent) {
    if (!job.mvu) return;
    if (job.mvu.updateVariables === false) return finishMvuKeepVariables(job, result, isCurrent);
    const preserveStopped = () => {
        if (!job.stopRequested) return false;
        if (!isCurrent()) throw new Error('聊天已变化，未覆盖新的内容');
        // An incomplete reply must not launch another analysis after Stop.
        // Keep parsed variables if ready, otherwise retain the turn baseline.
        job.mvuPending = mvuBusy() || !isMvuData(activeData(result));
        if (job.mvuPending) replaceFields(slot(result), job.mvu.baseline);
        return true;
    };
    if (preserveStopped()) return;
    // Native generation awaits receive/render listeners. Also wait for MVU versions
    // that keep their extra-model request running outside the native generation.
    while (mvuBusy()) {
        if (preserveStopped()) return;
        if (!isCurrent()) throw new Error('重写已取消或聊天已变化');
        await backgroundDelay(100);
    }
    if (preserveStopped()) return;
    if (!isCurrent()) throw new Error('重写已取消或聊天已变化');
    if (!isMvuData(activeData(result))) {
        // If MVU is not loaded in this session, silently inherit the baseline
        // snapshot so legacy chats with historical MVU data can still rewrite.
        if (!globalThis.Mvu) {
            replaceFields(slot(result), job.mvu.baseline);
            return;
        }
        // MVU throttles MESSAGE_RECEIVED. A very fast second reply may therefore
        // miss inline parsing; try its public parser with the same baseline.
        if (globalThis.Mvu?.parseMessage && /<UpdateVariable\b|<JSONPatch\b|_\.(?:set|add|assign|insert|remove|delete)\s*\(/i.test(result.mes)) {
            try {
                const data = await globalThis.Mvu.parseMessage(result.mes, structuredClone(job.mvu.baseline));
                if (!isCurrent()) throw new Error('重写已取消或聊天已变化');
                if (isMvuData(data)) {
                    replaceFields(slot(result), pick(data));
                    return;
                }
            } catch (error) {
                if (!isCurrent()) throw error;
                console.warn('[Auto Rewrite] Fallback MVU parseMessage failed; retaining baseline snapshot', error);
            }
        }
        // Never discard a completed rewrite draft just because MVU did not emit
        // a new snapshot (e.g. no variable changes or omitted update block).
        job.mvuPending = true;
        replaceFields(slot(result), job.mvu.baseline);
    }
}

// 关闭「重写时更新变量」：重写稿只替换正文，变量沿用被替换那一版的结果。
// 这里既不解析更新块，也不因为没收到快照而把变量退回本轮开始前。
async function finishMvuKeepVariables(job, result, isCurrent) {
    while (mvuBusy()) {
        if (!isCurrent()) throw new Error('重写已取消或聊天已变化');
        await backgroundDelay(100);
    }
    if (!isCurrent()) throw new Error('重写已取消或聊天已变化');
    replaceFields(slot(result), job.mvu.original);
    job.mvuPending = false;
}

export function restoreMvu(job, { restoreChat = true } = {}) {
    const transaction = mvuTransaction(job.source, job.id);
    if (!transaction) return;
    replaceFields(slot(job.source, transaction.swipe), transaction.original);
    if (restoreChat && getContext().chatMetadata) {
        getContext().chatMetadata.variables ??= {};
        replaceFields(getContext().chatMetadata.variables, transaction.chat);
    }
    delete job.source.extra?.[TRANSACTION];
    if (Array.isArray(job.source.swipe_info)) {
        for (const entry of job.source.swipe_info) {
            if (entry?.extra?.[TRANSACTION]?.id === job.id) delete entry.extra[TRANSACTION];
        }
    }
}

export function commitMvu(job, final) {
    if (!job.mvu) return;
    if (job.mvu.mirrorChat || isMvuData(getContext().chatMetadata?.variables)) {
        getContext().chatMetadata.variables ??= {};
        replaceFields(getContext().chatMetadata.variables, pick(activeData(final)));
    }
    delete final.extra?.[TRANSACTION];
}

export function mergeSwipeVariables(original, result, final) {
    if (!original.variables && !result.variables) return;
    final.variables = original.swipes.map((_, i) => structuredClone(original.variables?.[i] ?? {}));
    final.variables.push(structuredClone(activeData(result) ?? {}));
}

export function syncMvuChat(message) {
    const data = activeData(message);
    const variables = getContext().chatMetadata?.variables;
    if (!isMvuData(data) || !isMvuData(variables)) return false;
    replaceFields(variables, pick(data));
    return true;
}
