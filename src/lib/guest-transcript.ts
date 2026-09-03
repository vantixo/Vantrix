"use client";

/**
 * Guest → authenticated conversation handoff.
 *
 * /api/chat/guest deliberately never writes to the database ("no DB writes
 * ever" — see that route's comment header) — a guest's reply history exists
 * only in the browser. Without this, "create a free account to continue
 * this conversation" was a lie: signing up landed the user on a blank
 * conversation with no memory of the rapport just built as a guest.
 *
 * This stores the transcript in localStorage (scoped per-character) while
 * guest chatting happens, so the authenticated ChatWindow can claim it via
 * /api/chat/claim-guest-transcript right after signup and the conversation
 * actually does resume where it left off.
 *
 * Not a security boundary — the claim endpoint re-validates everything
 * (auth required, message caps, content sanitization) and only ever
 * backfills a conversation that's still empty, so a tampered localStorage
 * value can't do anything worse than seed a first message a real user could
 * have typed anyway.
 */

const PREFIX   = "vantrix:guestTranscript:";
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // matches GUEST_COOKIE_MAX_AGE on the server

export interface GuestTranscriptMessage {
  role:    "user" | "assistant";
  content: string;
}

interface StoredTranscript {
  messages: GuestTranscriptMessage[];
  ts:       number;
}

function keyFor(characterId: string): string {
  return `${PREFIX}${characterId}`;
}

export function saveGuestTranscript(characterId: string, messages: GuestTranscriptMessage[]): void {
  if (typeof window === "undefined") return;
  try {
    const payload: StoredTranscript = { messages, ts: Date.now() };
    localStorage.setItem(keyFor(characterId), JSON.stringify(payload));
  } catch {
    // localStorage can throw (quota, private mode) — losing the transcript
    // cache is not worth surfacing an error to the user over.
  }
}

export function getGuestTranscript(characterId: string): GuestTranscriptMessage[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(keyFor(characterId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredTranscript;
    if (!Array.isArray(parsed.messages) || parsed.messages.length === 0) return null;
    if (Date.now() - parsed.ts > MAX_AGE_MS) {
      localStorage.removeItem(keyFor(characterId));
      return null;
    }
    return parsed.messages;
  } catch {
    return null;
  }
}

export function clearGuestTranscript(characterId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(keyFor(characterId));
  } catch {
    // ignore
  }
}

/**
 * Whether the browser is holding *any* unclaimed guest transcript, for any
 * character — used by the signup form to tell `signup_completed`'s
 * `method` (see lib/analytics/events.ts) apart: 'guest_claim' for someone
 * who chatted first and is now signing up to keep the conversation, vs a
 * cold 'email' signup with no prior guest session. Keys are per-character
 * (see keyFor above), so this scans by prefix rather than a single lookup.
 * Doesn't validate age/shape of what it finds — same "just existence"
 * check getGuestTranscript already does its own full validation of, this
 * is only ever used for analytics segmentation, never as a security or
 * data-integrity check.
 */
export function hasAnyGuestTranscript(): boolean {
  if (typeof window === "undefined") return false;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX)) return true;
    }
    return false;
  } catch {
    return false;
  }
}
