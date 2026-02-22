import type { Message } from '../types';

export function isNumericIdString(value: string): boolean {
    return /^\d+$/.test(value);
}

/**
 * When history is loaded mid-run, we can end up with a trailing, history-derived assistant message
 * that has only thoughts (tool calls) and no content. If we also render a live run placeholder,
 * that tail becomes a duplicate "steps taken" block.
 */
export function trimHistoryTailAfterUser(messages: Message[]): Message[] {
    const lastUserIdx = messages.findLastIndex(m => m.role === 'user');
    if (lastUserIdx === -1) return messages;

    let end = messages.length;
    for (let i = messages.length - 1; i > lastUserIdx; i--) {
        const msg = messages[i];
        if (!msg) continue;
        const hasThoughts = (msg.thoughts?.length ?? 0) > 0;
        const hasContent = (msg.content ?? '').trim().length > 0;
        const isHistoryDerived = isNumericIdString(msg.stableId);
        const isTrimCandidate =
            msg.role === 'assistant'
            && !msg.isStreaming
            && hasThoughts
            && !hasContent
            && isHistoryDerived;

        if (!isTrimCandidate) break;
        end = i;
    }

    return end === messages.length ? messages : messages.slice(0, end);
}

/**
 * Determine whether a live (in-memory) message should be preserved when merging
 * with server-persisted history. Messages that are already represented in history
 * should NOT be preserved to avoid duplication.
 */
export function shouldPreserveLiveMessage(msg: Message): boolean {
    // Billing/errors etc aren't persisted
    if (msg.billingInfo) return true;
    // Keep in-progress streaming placeholders
    if (msg.isStreaming) return true;
    // Keep run-based assistant messages that have content (completed but not yet
    // reconciled with history via id). Don't preserve stopped/interrupted assistants
    // that have no content — their thoughts are already persisted in history.
    if (msg.role === 'assistant' && !isNumericIdString(msg.stableId) && (msg.content ?? '').trim()) return true;
    // Keep optimistic user messages (id=clientMessageId UUID) until persisted
    if (msg.role === 'user' && !isNumericIdString(msg.id)) return true;
    return false;
}

/**
 * Merge server-persisted history with live in-memory messages. Live messages that
 * pass `shouldPreserveLiveMessage` and aren't already present in history (by stableId
 * or role:id) are appended.
 */
export function mergeHistoryWithLive(history: Message[], live: Message[]): Message[] {
    if (live.length === 0) return history;
    const merged = [...history];
    const seenStableIds = new Set(history.map(m => m.stableId));
    const seenRoleIds = new Set(history.map(m => `${m.role}:${m.id}`));
    for (const msg of live) {
        if (!shouldPreserveLiveMessage(msg)) continue;
        const roleIdKey = `${msg.role}:${msg.id}`;
        if (seenStableIds.has(msg.stableId) || seenRoleIds.has(roleIdKey)) continue;
        merged.push(msg);
        seenStableIds.add(msg.stableId);
        seenRoleIds.add(roleIdKey);
    }
    return merged;
}

