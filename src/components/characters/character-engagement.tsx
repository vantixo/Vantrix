"use client";

import { useEffect, useState } from "react";
import { Heart, UserPlus, UserCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCharacterPage } from "@/hooks/use-character-page";
import { useTriggerCharacterReaction } from "@/components/immersive/character-reaction-context";

/**
 * Character-page equivalent of discussion-thread.tsx's post-like button:
 * same optimistic-toggle-then-reconcile pattern, applied to the
 * characters/[id]/like and /follow routes. Status is fetched client-side
 * after mount since the page itself is rendered without per-user state
 * (see the like/follow routes' own GET doc comments).
 *
 * CHARACTER-REACTIONS: liking (not unliking) fires the portrait's
 * heart-burst via the shared CharacterReactionProvider — see
 * character-reaction-context.tsx and character-hero.tsx. Fired
 * optimistically alongside the optimistic count update, not gated on
 * the server round-trip, since the reaction is a same-page visual cue
 * with no server state of its own to reconcile.
 */
export function CharacterEngagement({
  characterId,
  initialLikeCount,
  initialFollowerCount,
}: {
  characterId: string;
  initialLikeCount: number;
  initialFollowerCount: number;
}) {
  const { getSocialStatus, toggleLike, toggleFollow } = useCharacterPage();
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(initialLikeCount);
  const [following, setFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(initialFollowerCount);
  const [likeBusy, setLikeBusy] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const triggerReaction = useTriggerCharacterReaction();

  useEffect(() => {
    let cancelled = false;
    getSocialStatus(characterId).then((status) => {
      if (cancelled || !status) return;
      setLiked(status.liked);
      setLikeCount(status.likeCount);
      setFollowing(status.following);
      setFollowerCount(status.followerCount);
    });
    return () => {
      cancelled = true;
    };
  }, [characterId, getSocialStatus]);

  async function handleLike() {
    if (likeBusy) return;
    setLikeBusy(true);
    if (!liked) triggerReaction("like");
    setLiked((v) => !v);
    setLikeCount((c) => c + (liked ? -1 : 1));
    const result = await toggleLike(characterId);
    if (result) {
      setLiked(result.liked);
      setLikeCount(result.likeCount);
    }
    setLikeBusy(false);
  }

  async function handleFollow() {
    if (followBusy) return;
    setFollowBusy(true);
    setFollowing((v) => !v);
    setFollowerCount((c) => c + (following ? -1 : 1));
    const result = await toggleFollow(characterId);
    if (result) {
      setFollowing(result.following);
      setFollowerCount(result.followerCount);
    }
    setFollowBusy(false);
  }

  return (
    <div className="flex items-center justify-center gap-4">
      <button
        onClick={handleLike}
        disabled={likeBusy}
        className={cn(
          "flex items-center gap-1.5 text-sm transition-colors ease-premium",
          liked ? "text-gold-400" : "text-text-secondary hover:text-text-primary"
        )}
      >
        <Heart className="h-4 w-4" fill={liked ? "currentColor" : "none"} strokeWidth={1.75} />
        {likeCount.toLocaleString()}
      </button>

      <button
        onClick={handleFollow}
        disabled={followBusy}
        className={cn(
          "flex items-center gap-1.5 text-sm transition-colors ease-premium",
          following ? "text-gold-400" : "text-text-secondary hover:text-text-primary"
        )}
      >
        {following ? (
          <UserCheck className="h-4 w-4" strokeWidth={1.75} />
        ) : (
          <UserPlus className="h-4 w-4" strokeWidth={1.75} />
        )}
        {following ? "Following" : "Follow"} · {followerCount.toLocaleString()}
      </button>
    </div>
  );
}
