/**
 * Agent Communication Engine
 *
 * Characters exchange information independently of the user — rumors spread,
 * factions issue directives, allies pass warnings. This is the substrate
 * `collective-memory.ts` writes into (a message that spreads far enough
 * becomes a shared memory) and that `leadership-engine.ts` / `organization-
 * engine.ts` use to issue directives and announcements.
 *
 * Messages are asynchronous and lossy on purpose: confidence decays as a
 * rumor is relayed, and delivery is deferred to the world tick rather than
 * instant, so the world feels like it's actually talking to itself between
 * user sessions rather than reacting in lockstep.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';
import { getSocialLinks } from './social-graph';

export type MessageType =
  | 'information' | 'rumor' | 'proposal' | 'request'
  | 'warning' | 'greeting' | 'directive';

export interface AgentMessage {
  id:            string;
  sender_id:     string;
  recipient_id:  string | null;
  faction_id:    string | null;
  message_type:  MessageType;
  content:       string;
  topic:         string | null;
  confidence:    number;
  delivered:     boolean;
  created_at:    string;
}

const RUMOR_DECAY_PER_HOP = 0.15;
const MIN_CONFIDENCE_TO_RELAY = 0.25;

// ── Public: Send ─────────────────────────────────────────────────────────────

/**
 * Send a direct message from one character to another (or broadcast to a
 * faction when recipientId is omitted). Delivery is deferred — call
 * `deliverPendingMessages` from the world tick to actually surface it.
 */
export async function sendMessage(params: {
  senderId:      string;
  recipientId?:  string | null;
  factionId?:    string | null;
  messageType:   MessageType;
  content:       string;
  topic?:        string;
  confidence?:   number;
  locationId?:   string;
}): Promise<AgentMessage | null> {
  const { data, error } = await supabaseAdmin
    .from('agent_messages')
    .insert({
      sender_id:     params.senderId,
      recipient_id:  params.recipientId ?? null,
      faction_id:    params.factionId ?? null,
      message_type:  params.messageType,
      content:       params.content,
      topic:         params.topic ?? null,
      confidence:    params.confidence ?? 1.0,
      location_id:   params.locationId ?? null,
    })
    .select('*')
    .maybeSingle();

  if (error) {
    logger.warn('agent-communication:send-failed', { error, senderId: params.senderId });
    return null;
  }
  return data as AgentMessage;
}

/**
 * Propagate a rumor outward from a character to their social links.
 * Each hop degrades confidence; a rumor that decays below the relay
 * threshold quietly stops spreading rather than being deleted, so it still
 * shows up in the originator's sent history at full strength.
 */
export async function propagateRumor(
  originCharacterId: string,
  content: string,
  topic?: string,
  hops = 2,
): Promise<number> {
  let frontier = [originCharacterId];
  let confidence = 1.0;
  let sentCount = 0;

  for (let hop = 0; hop < hops && confidence >= MIN_CONFIDENCE_TO_RELAY; hop++) {
    const nextFrontier = new Set<string>();

    for (const characterId of frontier) {
      const links = await getSocialLinks(characterId);
      for (const link of links.slice(0, 3)) {
        const msg = await sendMessage({
          senderId:    characterId,
          recipientId: link.linked_character_id,
          messageType: 'rumor',
          content,
          topic,
          confidence,
        });
        if (msg) sentCount++;
        nextFrontier.add(link.linked_character_id);
      }
    }

    frontier = Array.from(nextFrontier);
    confidence = Math.max(0, confidence - RUMOR_DECAY_PER_HOP);
  }

  return sentCount;
}

/** Broadcast a directive from a leader/faction to every faction member. */
export async function broadcastDirective(
  factionId: string,
  senderId:  string,
  content:   string,
  topic?:    string,
): Promise<number> {
  const msg = await sendMessage({
    senderId,
    factionId,
    messageType: 'directive',
    content,
    topic,
    confidence: 1.0,
  });
  return msg ? 1 : 0;
}

// ── Public: Deliver / Read ───────────────────────────────────────────────────

/**
 * Mark queued messages as delivered. Called by the world worker on each
 * tick so message delivery has a natural cadence instead of firing the
 * instant it's sent.
 */
export async function deliverPendingMessages(limit = 200): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('agent_messages')
    .update({ delivered: true })
    .eq('delivered', false)
    .lte('created_at', new Date().toISOString())
    .select('id')
    .limit(limit);

  if (error) {
    logger.warn('agent-communication:deliver-failed', { error });
    return 0;
  }
  return data?.length ?? 0;
}

/** Fetch a character's inbox — delivered messages, most recent first. */
export async function getInbox(characterId: string, limit = 20): Promise<AgentMessage[]> {
  const factionIds = await memberFactionIds(characterId);
  const factionFilter = factionIds.length > 0 ? `,faction_id.in.(${factionIds.join(',')})` : '';

  const { data, error } = await supabaseAdmin
    .from('agent_messages')
    .select('*')
    .or(`recipient_id.eq.${characterId}${factionFilter}`)
    .eq('delivered', true)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return [];
  return (data ?? []) as AgentMessage[];
}

export async function markRead(messageId: string): Promise<void> {
  await supabaseAdmin
    .from('agent_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('id', messageId)
    .then(({ error }) => {
      if (error) logger.warn('agent-communication:mark-read-failed', { messageId, error });
    });
}

// ── Public: Prompt Formatter ──────────────────────────────────────────────────

export async function formatMessagesForPrompt(characterId: string): Promise<string> {
  const inbox = await getInbox(characterId, 5);
  if (inbox.length === 0) return '';

  const lines = inbox.map((m) => `- (${m.message_type}) ${m.content}`);
  return `[Recent Word Reaching You]\n${lines.join('\n')}`;
}

// ── Internal ──────────────────────────────────────────────────────────────────

async function memberFactionIds(characterId: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('faction_memberships')
    .select('faction_id')
    .eq('character_id', characterId);

  return (data ?? []).map((r) => r.faction_id);
}
