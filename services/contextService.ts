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
 * Format AI context for injection directly into the IMAGE GENERATION prompt.
 * This is different from formatContextForPrompt — it produces a concise,
 * action-oriented block that guides Gemini's image generation with awareness
 * of the cumulative edit history and user preferences.
 *
 * Purpose: Make every generation aware of what the architect has been doing,
 * producing coherent iterative results instead of stateless one-shots.
 */
export function formatContextForImagePrompt(context: AIContext): string {
  const parts: string[] = [];

  // Inject user's known architectural preferences
  if (context.userMemory) {
    parts.push(`ARCHITECT PROFILE (known preferences): ${context.userMemory}`);
  }

  // Inject session history — the cumulative design journey
  if (context.conversationSummary) {
    parts.push(`DESIGN SESSION HISTORY: ${context.conversationSummary}`);
  }

  // Inject recent edit chain — this creates the "cumulative context" effect
  if (context.recentMessages.length > 0) {
    const editChain = context.recentMessages
      .filter(m => m.startsWith('User:'))
      .map(m => m.replace('User: ', '').trim())
      .filter(Boolean);

    if (editChain.length > 0) {
      parts.push(
        `PREVIOUS EDITS IN THIS SESSION (apply these cumulatively — each edit builds on the last):\n` +
        editChain.map((edit, i) => `  ${i + 1}. ${edit}`).join('\n') +
        `\nThe current request below is the NEXT iteration in this sequence.`
      );
    }
  }

  if (parts.length === 0) return '';

  return `--- DESIGN CONTEXT (use this to maintain consistency across iterations) ---\n${parts.join('\n\n')}\n--- END DESIGN CONTEXT ---`;
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
