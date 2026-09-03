import Link from "next/link";
import { Heart } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * Shown in place of the composer once POST /api/chat/guest returns
 * `limitReached: true` (see that route's own comment — GUEST_MESSAGE_LIMIT,
 * default 7). Named for the moment it fires: a guest who's just built real
 * rapport across several exchanges, not a cold paywall shown before they've
 * felt anything. signUpHref carries the redirect back to this character's
 * authed page — see GuestChatWidget — and the guest's transcript is already
 * sitting in localStorage (src/lib/guest-transcript.ts) for
 * POST /api/chat/claim-guest-transcript to pick up right after, so
 * "continue this conversation" here is literally true, not just copy.
 */
export function EmotionalPeakPaywall({
  characterName,
  signUpHref,
}: {
  characterName: string;
  signUpHref: string;
}) {
  return (
    <Card interactive={false} className="p-6 text-center">
      <Heart className="h-5 w-5 text-gold-400 mx-auto mb-3" strokeWidth={1.75} />
      <h3 className="font-display text-lg text-text-primary">
        You and {characterName} are just getting started
      </h3>
      <p className="mt-2 text-sm text-text-secondary">
        Create a free account to keep talking — this conversation picks up
        right where you left it, nothing you&apos;ve said is lost.
      </p>
      <Button asChild size="md" className="mt-5">
        <Link href={signUpHref}>Continue as a free member</Link>
      </Button>
    </Card>
  );
}
