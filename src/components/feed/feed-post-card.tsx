"use client";

import { memo, useRef, useState } from "react";
import Link from "next/link";
import { SafeImage as Image } from "@/components/ui/safe-image";
import { AnimatePresence, motion } from "framer-motion";
import { Heart, MessageCircle, Send, Lock, BadgeCheck, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MediaLightbox, type LightboxMedia } from "@/components/chat/media-lightbox";
import { FeedComments } from "./feed-comments";
import { useFeed } from "@/hooks/use-feed";
import { resolveImageSrc, timeAgo, cn } from "@/lib/utils";
import type { FeedPost } from "@/types/feed";

// A tap and the next tap within this window counts as a double-tap-to-like,
// matching the interval most touch UIs treat as "the same gesture" rather
// than two separate taps.
const DOUBLE_TAP_MS = 300;

/**
 * PERF (runtime re-render pass): wrapped in memo() below. FeedGrid renders
 * one of these per post and re-renders itself on every filter/character/
 * loading-state change (e.g. the spinner toggling during "Load more") —
 * without memo, every already-rendered card re-rendered along with it even
 * though its own `post` object reference is untouched (loadMore appends via
 * `[...prev, ...page.posts]`, a shallow copy that keeps existing post
 * objects' identity). Only prop is `post` itself, no function props from
 * the parent, so a plain memo() (default shallow-compare) is enough here —
 * unlike message-bubble.tsx there's no callback identity to also stabilize.
 */
function FeedPostCardImpl({ post }: { post: FeedPost }) {
  const { toggleLike } = useFeed();
  const [liked, setLiked] = useState(post.user_liked);
  const [likesCount, setLikesCount] = useState(post.likes_count);
  const [commentsCount, setCommentsCount] = useState(post.comments_count);
  const [showComments, setShowComments] = useState(false);
  const [lightboxMedia, setLightboxMedia] = useState<LightboxMedia | null>(null);
  const [likeBusy, setLikeBusy] = useState(false);
  const [burstId, setBurstId] = useState(0);
  const [justCopied, setJustCopied] = useState(false);

  const lastTapAt = useRef(0);
  const singleTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const character = post.character;
  const showImage = !!post.image_url;

  async function like() {
    if (likeBusy || liked) return;
    setLikeBusy(true);
    setLiked(true);
    setLikesCount((c) => c + 1);
    const result = await toggleLike(post.id);
    if (result) {
      setLiked(result.liked);
      setLikesCount(result.likes_count);
    } else {
      setLiked(false);
      setLikesCount((c) => c - 1);
    }
    setLikeBusy(false);
  }

  async function toggleLikeButton() {
    if (likeBusy) return;
    setLikeBusy(true);
    const prevLiked = liked;
    const prevCount = likesCount;
    setLiked(!prevLiked);
    setLikesCount(prevCount + (prevLiked ? -1 : 1));
    const result = await toggleLike(post.id);
    if (result) {
      setLiked(result.liked);
      setLikesCount(result.likes_count);
    } else {
      setLiked(prevLiked);
      setLikesCount(prevCount);
    }
    setLikeBusy(false);
  }

  // Single tap opens the lightbox; a second tap inside DOUBLE_TAP_MS cancels
  // that and likes the post instead — the same disambiguation every
  // double-tap-to-like gesture needs, since a click handler alone can't
  // tell the two apart on the first tap.
  function handleMediaTap() {
    const now = Date.now();
    const isDoubleTap = now - lastTapAt.current < DOUBLE_TAP_MS;
    lastTapAt.current = now;

    if (isDoubleTap) {
      if (singleTapTimer.current) {
        clearTimeout(singleTapTimer.current);
        singleTapTimer.current = null;
      }
      setBurstId((id) => id + 1);
      like();
      return;
    }

    singleTapTimer.current = setTimeout(() => {
      if (post.image_url) setLightboxMedia({ type: "image", url: post.image_url });
    }, DOUBLE_TAP_MS);
  }

  async function handleShare() {
    const url = typeof window !== "undefined" ? `${window.location.origin}/feed?post=${post.id}` : "";
    try {
      if (navigator.share) {
        await navigator.share({ url, title: character?.name ? `${character.name} on Vantrix` : "Vantrix" });
        return;
      }
    } catch {
      // user cancelled the native share sheet — fall through to clipboard
    }
    try {
      await navigator.clipboard.writeText(url);
      setJustCopied(true);
      setTimeout(() => setJustCopied(false), 1500);
    } catch {
      // clipboard unavailable — nothing else we can do here
    }
  }

  return (
    <Card className="p-0" interactive={false}>
      <div className="flex items-center gap-2.5 p-3">
        <Link
          href={character ? `/characters/${character.id}` : "#"}
          className="relative h-9 w-9 shrink-0 rounded-full overflow-hidden border border-border-hairline"
        >
          <Image
            src={resolveImageSrc(character?.image_url)}
            alt={character?.name ?? "Character"}
            fill
            sizes="36px"
            className="object-cover"
          />
        </Link>
        <div className="min-w-0 flex-1">
          <Link
            href={character ? `/characters/${character.id}` : "#"}
            className="flex items-center gap-1 text-sm font-semibold text-text-primary hover:text-gold-400 truncate"
          >
            {character?.name ?? "Unknown"}
            {character?.is_live && <BadgeCheck className="h-3.5 w-3.5 text-gold-500 shrink-0" />}
          </Link>
        </div>
      </div>

      {showImage ? (
        <button
          type="button"
          onClick={handleMediaTap}
          className="relative block aspect-[4/5] w-full bg-black/40 select-none"
        >
          <Image
            src={resolveImageSrc(post.image_url)}
            alt={post.caption ?? `Post by ${character?.name ?? "character"}`}
            fill
            sizes="(max-width: 640px) 100vw, 520px"
            className="object-cover"
            draggable={false}
          />
          <AnimatePresence>
            {burstId > 0 && (
              <motion.div
                key={burstId}
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1.15, opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                className="pointer-events-none absolute inset-0 flex items-center justify-center"
              >
                <Heart className="h-24 w-24 text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.5)]" fill="white" />
              </motion.div>
            )}
          </AnimatePresence>
        </button>
      ) : post.is_locked ? (
        <PremiumTeaserPanel />
      ) : null}

      <div className="flex items-center gap-4 px-4 pt-3">
        <button
          type="button"
          onClick={toggleLikeButton}
          aria-label={liked ? "Unlike" : "Like"}
          className="text-text-secondary hover:text-text-primary transition-colors ease-premium duration-150"
        >
          <motion.span whileTap={{ scale: 1.3 }} className="block">
            <Heart
              className={cn("h-6 w-6", liked && "text-gold-400")}
              fill={liked ? "currentColor" : "none"}
              strokeWidth={1.75}
            />
          </motion.span>
        </button>
        <button
          type="button"
          onClick={() => setShowComments((v) => !v)}
          aria-label="Comments"
          className={cn(
            "transition-colors ease-premium duration-150",
            showComments ? "text-text-primary" : "text-text-secondary hover:text-text-primary"
          )}
        >
          <MessageCircle className="h-6 w-6" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={handleShare}
          aria-label="Share"
          className="relative text-text-secondary hover:text-text-primary transition-colors ease-premium duration-150"
        >
          <Send className="h-6 w-6" strokeWidth={1.75} />
          {justCopied && (
            <span className="absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded-xs bg-white/10 px-1.5 py-0.5 text-[10px] text-text-secondary">
              Link copied
            </span>
          )}
        </button>
      </div>

      <div className="px-4 pt-2">
        {likesCount > 0 && (
          <p className="text-sm font-semibold text-text-primary">
            {likesCount.toLocaleString()} {likesCount === 1 ? "like" : "likes"}
          </p>
        )}

        {post.caption && (
          <p className="mt-1 text-sm text-text-secondary whitespace-pre-wrap break-words">
            <Link
              href={character ? `/characters/${character.id}` : "#"}
              className="mr-1.5 font-semibold text-text-primary hover:text-gold-400"
            >
              {character?.name ?? "Unknown"}
            </Link>
            {post.caption}
          </p>
        )}

        {commentsCount > 0 && !showComments && (
          <button
            type="button"
            onClick={() => setShowComments(true)}
            className="mt-1 block text-sm text-text-tertiary hover:text-text-secondary"
          >
            View all {commentsCount} comments
          </button>
        )}

        <p className="mt-1 pb-3 text-[11px] uppercase tracking-wide text-text-tertiary">
          {timeAgo(post.created_at, true)}
        </p>
      </div>

      {showComments && (
        <FeedComments postId={post.id} onCommentAdded={() => setCommentsCount((c) => c + 1)} />
      )}

      <MediaLightbox media={lightboxMedia} onClose={() => setLightboxMedia(null)} />
    </Card>
  );
}

export const FeedPostCard = memo(FeedPostCardImpl);

/**
 * SEC/MONETIZATION FIX follow-through (route.ts already redacts a locked
 * post's image_url to null server-side — see feed/posts/route.ts): the old
 * treatment for that state was a bare Lock icon + one text link, which
 * undersold the moment a real premium teaser is meant to create. This is
 * the actual conversion surface the lock exists for, so it gets a real CTA
 * rather than an afterthought.
 */
function PremiumTeaserPanel() {
  return (
    <div className="relative flex aspect-[4/5] w-full flex-col items-center justify-center gap-3 overflow-hidden bg-gradient-to-b from-white/[0.03] to-black/40 px-8 text-center">
      <div className="pointer-events-none absolute inset-0 bg-gold-edge opacity-30" />
      <span className="flex h-14 w-14 items-center justify-center rounded-full border border-gold-500/40 bg-black/40">
        <Lock className="h-6 w-6 text-gold-500" strokeWidth={1.5} />
      </span>
      <div>
        <p className="flex items-center justify-center gap-1.5 text-sm font-semibold text-text-primary">
          <Sparkles className="h-3.5 w-3.5 text-gold-500" />
          Premium teaser
        </p>
        <p className="mt-1 text-xs text-text-tertiary">
          This companion is holding something back for premium members.
        </p>
      </div>
      <Button asChild size="sm" variant="primary">
        <Link href="/premium">Unlock with Premium</Link>
      </Button>
    </div>
  );
}
