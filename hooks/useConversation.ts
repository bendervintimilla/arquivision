import { useState, useCallback, useRef, useEffect, type Dispatch, type SetStateAction } from 'react';
import { DesignStep } from '../types';
import {
  createConversation,
  saveMessage,
  loadMessages,
  messagesToDesignSteps,
  updateConversation,
  listConversations,
  DBConversation,
} from '../services/conversationService';
import { buildAIContext, updateConversationSummary, AIContext } from '../services/contextService';

interface UseConversationOptions {
  userId: string;
  tabSource: 'PHOTO' | 'PLAN' | 'VIDEO';
  autoLoadLast?: boolean;
}

interface UseConversationReturn {
  steps: DesignStep[];
  setSteps: Dispatch<SetStateAction<DesignStep[]>>;
  currentConversationId: string | null;
  conversations: DBConversation[];
  loading: boolean;
  addStep: (step: DesignStep) => Promise<void>;
  loadConversation: (conversationId: string) => Promise<void>;
  startNewConversation: (title?: string) => Promise<string>;
  refreshConversations: () => Promise<void>;
  getAIContext: () => Promise<AIContext>;
  reset: () => void;
}

export function useConversation({
  userId,
  tabSource,
  autoLoadLast = false,
}: UseConversationOptions): UseConversationReturn {
  const [steps, setSteps] = useState<DesignStep[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);

  // Revoke blob: object URLs to prevent memory leaks
  const revokeStepUrls = useCallback((stepsToClean: DesignStep[]) => {
    for (const step of stepsToClean) {
      if (step.images) {
        for (const img of step.images) {
          if (img.startsWith('blob:')) {
            URL.revokeObjectURL(img);
          }
        }
      }
    }
  }, []);
  const [conversations, setConversations] = useState<DBConversation[]>([]);
  const [loading, setLoading] = useState(false);
  const sequenceRef = useRef(0);
  const messageCountRef = useRef(0);

  // Load conversation list on mount
  useEffect(() => {
    if (userId) {
      refreshConversations();
    }
  }, [userId, tabSource]);

  // Auto-load last conversation
  useEffect(() => {
    if (autoLoadLast && conversations.length > 0 && !currentConversationId) {
      loadConversation(conversations[0].id);
    }
  }, [conversations, autoLoadLast]);

  const refreshConversations = useCallback(async () => {
    try {
      const convos = await listConversations(userId, tabSource);
      setConversations(convos);
    } catch (e) {
      console.error('Failed to refresh conversations:', e);
    }
  }, [userId, tabSource]);

  const startNewConversation = useCallback(async (title?: string): Promise<string> => {
    const id = await createConversation(userId, tabSource, title);
    setCurrentConversationId(id);
    // NOTE: Do NOT clear steps here — addStep calls this mid-flow
    // and clearing would wipe the optimistic step. Steps are only
    // cleared explicitly by reset() or loadConversation().
    sequenceRef.current = 0;
    messageCountRef.current = 0;
    await refreshConversations();
    return id;
  }, [userId, tabSource, refreshConversations]);

  const loadConversation = useCallback(async (conversationId: string) => {
    setLoading(true);
    try {
      // Clean up old object URLs before replacing
      revokeStepUrls(steps);
      const messages = await loadMessages(conversationId);
      const designSteps = await messagesToDesignSteps(messages);
      setSteps(designSteps);
      setCurrentConversationId(conversationId);
      sequenceRef.current = messages.length;
      messageCountRef.current = messages.length;
    } catch (e) {
      console.error('Failed to load conversation:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const addStep = useCallback(async (step: DesignStep) => {
    // Optimistic UI update
    setSteps(prev => [...prev, step]);

    // Ensure we have a conversation
    let convId = currentConversationId;
    if (!convId) {
      try {
        const title = step.text || 'Untitled Project';
        convId = await startNewConversation(title.slice(0, 60));
      } catch (e) {
        console.error('Failed to create conversation:', e);
        // Step was added optimistically — UI still shows it
        return;
      }
    }

    // Save to DB
    try {
      await saveMessage(convId, userId, step, sequenceRef.current);
      sequenceRef.current++;
      messageCountRef.current++;

      // Auto-update title on first user message
      if (messageCountRef.current === 1 && step.role === 'user' && step.text) {
        await updateConversation(convId, { title: step.text.slice(0, 60) });
        await refreshConversations();
      }

      // Trigger conversation summary every 6 messages
      if (messageCountRef.current > 0 && messageCountRef.current % 6 === 0) {
        updateConversationSummary(convId, userId).catch(e =>
          console.error('Summary update failed:', e)
        );
      }
    } catch (e) {
      console.error('Failed to save step:', e);
    }
  }, [currentConversationId, userId, startNewConversation, refreshConversations]);

  const getAIContext = useCallback(async (): Promise<AIContext> => {
    if (!currentConversationId) {
      return { userMemory: '', conversationSummary: '', recentMessages: [] };
    }
    return buildAIContext(userId, currentConversationId, steps);
  }, [userId, currentConversationId, steps]);

  const reset = useCallback(() => {
    revokeStepUrls(steps);
    setSteps([]);
    setCurrentConversationId(null);
    sequenceRef.current = 0;
    messageCountRef.current = 0;
  }, []);

  return {
    steps,
    setSteps,
    currentConversationId,
    conversations,
    loading,
    addStep,
    loadConversation,
    startNewConversation,
    refreshConversations,
    getAIContext,
    reset,
  };
}
