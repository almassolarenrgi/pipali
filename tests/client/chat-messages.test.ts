import { test, expect, describe } from 'bun:test';
import { mergeHistoryWithLive } from '../../src/client/utils/chat-messages';
import type { Message } from '../../src/client/types';

function userMsg(id: string, content: string, opts?: Partial<Message>): Message {
    return { id, stableId: id, role: 'user', content, ...opts };
}

function assistantMsg(id: string, content: string, opts?: Partial<Message>): Message {
    return { id, stableId: id, role: 'assistant', content, ...opts };
}

const toolThought = (id: string, name: string, result?: string) => ({
    id, type: 'tool_call' as const, content: '', toolName: name,
    ...(result !== undefined ? { toolResult: result } : { isPending: true }),
});

describe('mergeHistoryWithLive — soft interrupt duplication', () => {
    /**
     * Core bug repro: after a soft interrupt, the interrupted run's assistant
     * (UUID stableId, no content, with thoughts) was incorrectly preserved
     * and appended at the end of the chat — duplicating the thoughts already
     * present in history under a numeric step_id.
     */
    test('interrupted run assistant is NOT duplicated after history merge', () => {
        const history: Message[] = [
            userMsg('1', 'original question'),
            assistantMsg('2', '', {
                thoughts: [toolThought('tc1', 'search', 'r1'), toolThought('tc2', 'read', 'r2')],
            }),
            userMsg('4', 'interrupt message'),
            assistantMsg('6', 'final response', {
                thoughts: [toolThought('tc3', 'search', 'r3')],
            }),
        ];

        const live: Message[] = [
            userMsg('1', 'original question'),
            // Run A: stopped, thoughts but no content, UUID stableId
            assistantMsg('run-A', '', {
                stableId: 'run-A', isStreaming: false,
                thoughts: [toolThought('tc1', 'search', 'r1'), toolThought('tc2', 'read', 'r2')],
            }),
            userMsg('4', 'interrupt message'),
            // Run B: completed, content present, UUID stableId, numeric id matching history
            assistantMsg('6', 'final response', {
                stableId: 'run-B', isStreaming: false,
                thoughts: [toolThought('tc3', 'search', 'r3')],
            }),
        ];

        const merged = mergeHistoryWithLive(history, live);

        expect(merged).toHaveLength(4);
        // The last message must be the final response, not a duplicate of run A's thoughts
        expect(merged[3]!.content).toBe('final response');
    });

    /**
     * Edge case: user interrupts twice rapidly (A → B → C). Both A and B are
     * stopped runs with thoughts but no content. Neither should survive merge.
     */
    test('multiple interrupted runs do not duplicate', () => {
        const history: Message[] = [
            userMsg('1', 'q1'),
            assistantMsg('2', '', { thoughts: [toolThought('tc1', 'search', 'r1')] }),
            userMsg('3', 'interrupt 1'),
            assistantMsg('4', '', { thoughts: [toolThought('tc2', 'read', 'r2')] }),
            userMsg('5', 'interrupt 2'),
            assistantMsg('7', 'done', { thoughts: [toolThought('tc3', 'write', 'r3')] }),
        ];

        const live: Message[] = [
            userMsg('1', 'q1'),
            assistantMsg('run-A', '', {
                stableId: 'run-A', isStreaming: false,
                thoughts: [toolThought('tc1', 'search', 'r1')],
            }),
            userMsg('3', 'interrupt 1'),
            assistantMsg('run-B', '', {
                stableId: 'run-B', isStreaming: false,
                thoughts: [toolThought('tc2', 'read', 'r2')],
            }),
            userMsg('5', 'interrupt 2'),
            assistantMsg('7', 'done', {
                stableId: 'run-C', isStreaming: false,
                thoughts: [toolThought('tc3', 'write', 'r3')],
            }),
        ];

        const merged = mergeHistoryWithLive(history, live);

        expect(merged).toHaveLength(6);
        expect(merged[5]!.content).toBe('done');
    });

    /**
     * History loads while a run is still streaming. The live streaming placeholder
     * must survive the merge so step_start events can attach to it.
     */
    test('streaming placeholder survives merge with partial history', () => {
        // History was persisted up through the last completed turn
        const history: Message[] = [
            userMsg('1', 'question'),
            assistantMsg('2', 'previous answer'),
            userMsg('3', 'follow-up'),
        ];

        // Live state: user sent follow-up, assistant is mid-run with some thoughts
        const live: Message[] = [
            userMsg('1', 'question'),
            assistantMsg('2', 'previous answer'),
            userMsg('3', 'follow-up'),
            assistantMsg('run-X', '', {
                stableId: 'run-X', isStreaming: true,
                thoughts: [toolThought('tc1', 'search', 'r1'), toolThought('tc2', 'read')],
            }),
        ];

        const merged = mergeHistoryWithLive(history, live);

        expect(merged).toHaveLength(4);
        expect(merged[3]!.isStreaming).toBe(true);
        expect(merged[3]!.thoughts).toHaveLength(2);
    });

    /**
     * Completed assistant has UUID stableId (not yet reconciled) but its numeric
     * id matches history. The role:id dedup should prevent duplication even though
     * stableIds differ.
     */
    test('completed assistant deduped by role:id when stableIds differ', () => {
        const history: Message[] = [
            userMsg('1', 'q'),
            assistantMsg('5', 'answer', { stableId: '5' }),
        ];

        const live: Message[] = [
            userMsg('1', 'q'),
            // RUN_COMPLETE set id='5' (stepId) but stableId stayed as UUID
            assistantMsg('5', 'answer', { stableId: 'run-uuid', isStreaming: false }),
        ];

        const merged = mergeHistoryWithLive(history, live);

        expect(merged).toHaveLength(2);
    });

    /**
     * Optimistic user message (UUID id, not yet persisted) must survive merge so
     * the user sees their message while the server processes it.
     */
    test('optimistic user message preserved until server persists it', () => {
        const history: Message[] = [
            userMsg('1', 'first question'),
            assistantMsg('2', 'first answer'),
        ];

        const live: Message[] = [
            userMsg('1', 'first question'),
            assistantMsg('2', 'first answer'),
            userMsg('client-uuid', 'follow-up', { stableId: 'client-uuid' }),
        ];

        const merged = mergeHistoryWithLive(history, live);

        expect(merged).toHaveLength(3);
        expect(merged[2]!.content).toBe('follow-up');
    });
});
