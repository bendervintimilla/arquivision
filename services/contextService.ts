import { DesignStep } from '../types';
import { getUserPreferences, updateUserPreferences } from './conversationService';
import { supabase } from './supabaseClient';
import { backendApi } from './backendApiService';

export interface AIContext {
  userMemory: string;
  conversationSummary: string;
  recentMessages: string[];
}

/**
 * Build the 3-tier AI context for a conversation.
 */
export async function buildAIContext(
  userId: string,
  conversationId: string,
  currentSteps: DesignStep[]
): Promise<AIContext> {
  // Tier 1: User long-term memory
  let userMemory = '';
  try {
    const prefs = await getUserPreferences(userId);
    userMemory = prefs?.ai_memory_summary || '';
  } catch {
    // Continue without user memory
  }

  // Tier 2: Conversation summary
  let conversationSummary = '';
  try {
    const { data } = await supabase
      .from('conversations')
      .select('summary')
      .eq('id', conversationId)
      .single();
    conversationSummary = data?.summary || '';
  } catch {
    // Continue without summary
  }

  // Tier 3: Last 4 message texts
  const recentMessages = currentSteps
    .filter(s => s.text)
    .slice(-4)
    .map(s => `${s.role === 'user' ? 'User' : 'AI'}: ${s.text}`);

  return { userMemory, conversationSummary, recentMessages };
}

/**
 * Format AI context for injection into system prompt.
 */
export function formatContextForPrompt(context: AIContext): string {
  const parts: string[] = [];

  if (context.userMemory) {
    parts.push(`[USER PROFILE]\n${context.userMemory}`);
  }

  if (context.conversationSummary) {
    parts.push(`[SESSION CONTEXT]\n${context.conversationSummary}`);
  }

  if (context.recentMessages.length > 0) {
    parts.push(`[RECENT EXCHANGES]\n${context.recentMessages.join('\n')}`);
  }

  return parts.length > 0 ? `\n\n--- CONTEXT ---\n${parts.join('\n\n')}\n--- END CONTEXT ---\n` : '';
}

/**
 * Update conversation summary (called every 6 messages).
 * This runs in the background - doesn't block the UI.
 */
export async function updateConversationSummary(
  conversationId: string,
  userId: string
): Promise<void> {
  try {
    // Get current conversation summary
    const { data: conv } = await supabase
      .from('conversations')
      .select('summary')
      .eq('id', conversationId)
      .single();

    // Get recent messages (last 6)
    const { data: messages } = await supabase
      .from('messages')
      .select('role, text')
      .eq('conversation_id', conversationId)
      .order('sequence_order', { ascending: false })
      .limit(6);

    if (!messages || messages.length === 0) return;

    const prefs = await getUserPreferences(userId);

    // Call backend to generate summary
    const { summary } = await backendApi.summarizeContext({
      previousSummary: conv?.summary || '',
      newMessages: messages.reverse().map(m => ({
        role: m.role,
        text: m.text || '',
      })),
      userMemory: prefs?.ai_memory_summary || '',
    });

    // Save the summary
    await supabase
      .from('conversations')
      .update({ summary, updated_at: new Date().toISOString() })
      .eq('id', conversationId);

    // Also save a context snapshot
    const lastSeq = messages.length;
    await supabase.from('context_snapshots').insert({
      conversation_id: conversationId,
      user_id: userId,
      summary,
      covers_through_sequence: lastSeq,
    });

  } catch (e) {
    console.error('Failed to update conversation summary:', e);
  }
}

/**
 * Update user's long-term memory from recent conversation summaries.
 * Called periodically (e.g., every 5 conversations).
 */
export async function updateUserMemory(userId: string): Promise<void> {
  try {
    const prefs = await getUserPreferences(userId);

    // Get last 5 conversation summaries
    const { data: conversations } = await supabase
      .from('conversations')
      .select('summary')
      .eq('user_id', userId)
      .neq('summary', '')
      .order('updated_at', { ascending: false })
      .limit(5);

    if (!conversations || conversations.length === 0) return;

    const summaries = conversations.map(c => c.summary).filter(Boolean);

    const { memory } = await backendApi.updateUserMemory({
      currentMemory: prefs?.ai_memory_summary || '',
      conversationSummaries: summaries,
    });

    await updateUserPreferences(userId, { ai_memory_summary: memory });

  } catch (e) {
    console.error('Failed to update user memory:', e);
  }
}
