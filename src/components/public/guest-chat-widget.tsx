"use client";

import { useEffect, useRef, useState } from "react";
import { SafeImage as Image } from "@/components/ui/safe-image";
import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ChatComposer } from "@/components/chat/chat-composer";
import { EmotionalPeakPaywall } from "@/components/public/emotional-peak-paywall";
import { saveGuestTranscript, type GuestTranscriptMessage } from "@/lib/guest-transcript";
import { resolveImageSrc, cn } from "@/lib/utils";

/**
 * The frontend half of the guest-chat funnel: POST /api/chat/guest,
 * src/lib/guest-transcript.ts, and POST /api/chat/claim-guest-transcript
 * (see ChatWindow's mount effect) were all fully built and security-hardened
 * (SEC-07 cookie-bound rate limiting, SEC-08 idempotent claiming) but had
 * zero UI consumer anywhere in the app — this is that consumer.
 *
 * Only rendered on /companions/[id] (getPublicCharacter's is_public/
 * non-nsfw/approved subset), matching what /api/chat/guest's own
 * checkCharacterAccessForGuest gate allows; a gate rejection (403) still
 * surfaces cleanly as an inline error rather than a broken chat.
 *
 * Deliberately lighter than ChatWindow: no streaming, voice, media
 * generation, or milestone plumbing — those all require an authenticated
 * conversation. A guest exchange is at most GUEST_MESSAGE_LIMIT (7) turns,
 * so a minimal message list with no virtualization/scroll-follow logic is
 * enough.
 */
export function GuestChatWidget({
  character,
  signUpHref,
}: {
  character: { id: string; name: string; image_url: string | null; opening_line: string | null };
  signUpHref: string;
}) {
  const [messages, setMessages] = useState<GuestTranscriptMessage[]>(
    character.opening_line ? [{ role: "assistant", content: character.opening_line }] : []
  );
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [limitReached, setLimitReached] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  async function handleSend() {
    const text = draft.trim();
    if (!text || sending || limitReached) return;

    setSending(true);
    setError(null);
    setDraft("");

    try {
      const history = messages
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.content.slice(0, 1000) }));

      const res = await fetch("/api/chat/guest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, characterId: character.id, history }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error ?? "Something went wrong — try again.");
        setDraft(text);
        return;
      }

      // No `reply` means the per-session limit was already hit before this
      // call was made (stale client state — e.g. a second tab) — see
      // /api/chat/guest's limitResponse branch, which omits `reply`
      // entirely rather than generating one.
      if (!data.reply) {
        setLimitReached(true);
        return;
      }

      const next: GuestTranscriptMessage[] = [
        ...messages,
        { role: "user", content: text },
        { role: "assistant", content: data.reply as string },
      ];
      setMessages(next);
      saveGuestTranscript(character.id, next);

      if (typeof data.guestMessagesRemaining === "number") setRemaining(data.guestMessagesRemaining);
      if (data.limitReached) setLimitReached(true);
    } catch {
      setError("Something went wrong — try again.");
      setDraft(text);
    } finally {
      setSending(false);
    }
  }

  return (
    <Card interactive={false} className="flex flex-col overflow-hidden">
      <div className="max-h-[420px] overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((m, i) => (
          <div
            key={i}
            className={cn(
              "flex items-end gap-2",
              m.role === "user" ? "flex-row-reverse" : "flex-row"
            )}
          >
            {m.role === "assistant" && (
              <div className="relative h-6 w-6 shrink-0 rounded-full overflow-hidden">
                <Image src={resolveImageSrc(character.image_url)} alt="" fill sizes="24px" className="object-cover" />
              </div>
            )}
            <div
              className={cn(
                "max-w-[80%] rounded-md px-3.5 py-2 text-[14px] leading-relaxed",
                m.role === "user"
                  ? "bg-gold-500/10 border border-gold-500/30 text-text-primary"
                  : "border border-border-hairline text-text-secondary"
              )}
            >
              {m.content}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex items-center gap-2 text-text-tertiary text-xs pl-8">
            <Loader2 className="h-3 w-3 animate-spin" /> {character.name} is typing…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {error && <p className="px-4 pb-2 text-xs text-danger">{error}</p>}

      {limitReached ? (
        <div className="border-t border-border-hairline p-4">
          <EmotionalPeakPaywall characterName={character.name} signUpHref={signUpHref} />
        </div>
      ) : (
        <>
          {remaining !== null && remaining <= 3 && (
            <p className="px-4 pt-2 text-[11px] text-text-tertiary">
              {remaining === 0 ? "Last free message" : `${remaining} free messages left`}
            </p>
          )}
          <ChatComposer value={draft} onChange={setDraft} onSend={handleSend} disabled={sending} />
        </>
      )}
    </Card>
  );
}
