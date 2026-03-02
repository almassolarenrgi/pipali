// Message list container with empty state

import { useEffect, useRef, useCallback } from 'react';
import type { Message } from '../../types';
import { MessageItem } from './MessageItem';
import { EmptyHomeState } from '../home/EmptyHomeState';

interface MessageListProps {
    messages: Message[];
    conversationId?: string;
    platformFrontendUrl?: string;
    onDeleteMessage?: (messageId: string, role: 'user' | 'assistant') => void;
    userName?: string;
}

export function MessageList({ messages, conversationId, platformFrontendUrl, onDeleteMessage, userName }: MessageListProps) {
    const lastUserMessageRef = useRef<HTMLDivElement>(null);
    const mainContentRef = useRef<HTMLElement>(null);
    const messagesRef = useRef<HTMLDivElement>(null);
    const previousConversationIdRef = useRef<string | undefined>(undefined);
    const previousMessagesLengthRef = useRef<number>(0);
    const previousThoughtsLengthRef = useRef<number>(0);
    // Track if user is near bottom (updated on scroll events)
    const isNearBottomRef = useRef<boolean>(true);

    // Find the index of the last user message
    const lastUserMessageIndex = messages.findLastIndex(msg => msg.role === 'user');

    // Get the streaming message's thoughts count
    const streamingMessage = messages.find(msg => msg.role === 'assistant' && msg.isStreaming);
    const currentThoughtsLength = streamingMessage?.thoughts?.length ?? 0;

    // Track scroll position to detect if user is near bottom
    const handleScroll = useCallback(() => {
        const container = mainContentRef.current;
        if (container) {
            const threshold = 150;
            isNearBottomRef.current = container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
        }
    }, []);

    // Set up scroll listener
    useEffect(() => {
        const container = mainContentRef.current;
        if (container) {
            container.addEventListener('scroll', handleScroll, { passive: true });
            // Initial check
            handleScroll();
            return () => container.removeEventListener('scroll', handleScroll);
        }
    }, [handleScroll]);

    // Scroll to last user message when conversation messages are freshly loaded
    // or when a new message is sent while near the bottom
    useEffect(() => {
        const prevLength = previousMessagesLengthRef.current;
        previousMessagesLengthRef.current = messages.length;

        // Only scroll when messages transition from empty to loaded (fresh load)
        // This handles both initial load and conversation switches
        const isFreshLoad = prevLength === 0 && messages.length > 0;
        const isNewConversation = conversationId !== previousConversationIdRef.current;

        if (isNewConversation) {
            previousConversationIdRef.current = conversationId;
        }

        if (isFreshLoad && messages.length > 0) {
            // Use requestAnimationFrame to ensure DOM has updated with the new ref
            requestAnimationFrame(() => {
                lastUserMessageRef.current?.scrollIntoView({ behavior: 'instant' });
            });
            return;
        }

        // Check if new messages were added (user sent a message)
        const newMessagesAdded = messages.length > prevLength && prevLength > 0;
        if (newMessagesAdded && isNearBottomRef.current) {
            // Scroll to show the new user message
            requestAnimationFrame(() => {
                lastUserMessageRef.current?.scrollIntoView({ behavior: 'smooth' });
            });
        }
    }, [conversationId, messages.length]);

    // Scroll when thoughts are added during streaming.
    // The ResizeObserver handles height-based scrolling well for level 2 (full results),
    // but at level 1 (outline) new thoughts add minimal height and STEP_END produces
    // zero height change (results are hidden), so we need an explicit scroll trigger.
    useEffect(() => {
        const prevThoughtsLength = previousThoughtsLengthRef.current;
        previousThoughtsLengthRef.current = currentThoughtsLength;

        if (currentThoughtsLength > prevThoughtsLength && isNearBottomRef.current) {
            const container = mainContentRef.current;
            requestAnimationFrame(() => {
                if (prevThoughtsLength === 0) {
                    lastUserMessageRef.current?.scrollIntoView({ behavior: 'smooth' });
                } else if (container) {
                    container.scrollTop = container.scrollHeight;
                }
            });
        }
    }, [currentThoughtsLength]);

    // Auto-scroll when content height grows during streaming.
    // Tool call results and expanded thoughts change DOM height without changing
    // messages.length or currentThoughtsLength, so the above effects miss them.
    useEffect(() => {
        const container = mainContentRef.current;
        const messagesEl = messagesRef.current;
        if (!container || !messagesEl) return;

        const observer = new ResizeObserver(() => {
            if (isNearBottomRef.current) {
                // Defer scroll to after paint so hit-test coordinates stay in sync
                // with visual positions. Synchronous scrollTop updates during layout
                // can desync the compositor, making buttons visually offset from their
                // actual clickable area until the next repaint.
                requestAnimationFrame(() => {
                    container.scrollTop = container.scrollHeight;
                });
            }
        });
        observer.observe(messagesEl);
        return () => observer.disconnect();
    }, []);

    return (
        <main className="main-content" ref={mainContentRef}>
            <div className="messages-container">
                {messages.length === 0 ? (
                    <EmptyHomeState userName={userName} />
                ) : (
                    <div className="messages" ref={messagesRef}>
                        {messages.map((msg, index) => (
                            <div key={msg.stableId} ref={index === lastUserMessageIndex ? lastUserMessageRef : undefined}>
                                <MessageItem message={msg} platformFrontendUrl={platformFrontendUrl} onDelete={onDeleteMessage} />
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </main>
    );
}
