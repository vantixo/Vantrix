"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Heart, Loader2, Pin, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, timeAgo } from "@/lib/utils";
import { useCommunity } from "@/hooks/use-community";
import { ReportModal } from "@/components/community/report-modal";
import type { CommunityPost, CommunityReply } from "@/types/community";

export function DiscussionThread({
  post: initialPost,
  replies: initialReplies,
  currentUserId,
}: {
  post: CommunityPost;
  replies: CommunityReply[];
  /** Passed down from the server page's getAuthedUser() call so the client
   *  can decide whether to show delete affordances — the actual
   *  authorization is enforced server-side regardless (see DELETE routes). */
  currentUserId?: string | null;
}) {
  const [post, setPost] = useState(initialPost);
  const [replies, setReplies] = useState(initialReplies);
  const [likingPost, setLikingPost] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [submittingReply, setSubmittingReply] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [deletingPost, setDeletingPost] = useState(false);
  const [deletingReplyId, setDeletingReplyId] = useState<string | null>(null);
  const router = useRouter();
  const { toggleLike, fetchReplies, submitReply: submitReplyApi, deletePost, deleteReply } = useCommunity();

  async function handlePostLike() {
    if (likingPost) return;
    setLikingPost(true);
    // Optimistic — mirrors notifications-list.tsx's read-toggle pattern;
    // worst case a failed toggle self-corrects on next page load.
    setPost((p) => ({
      ...p,
      userLiked: !p.userLiked,
      likesCount: p.likesCount + (p.userLiked ? -1 : 1),
    }));
    const result = await toggleLike("posts", post.id);
    if (result) {
      setPost((p) => ({ ...p, userLiked: result.liked, likesCount: result.likesCount }));
    }
    setLikingPost(false);
  }

  async function handleReplyLike(replyId: string) {
    setReplies((prev) =>
      prev.map((r) =>
        r.id === replyId
          ? { ...r, userLiked: !r.userLiked, likesCount: r.likesCount + (r.userLiked ? -1 : 1) }
          : r
      )
    );
    const result = await toggleLike("replies", replyId);
    if (result) {
      setReplies((prev) =>
        prev.map((r) =>
          r.id === replyId ? { ...r, userLiked: result.liked, likesCount: result.likesCount } : r
        )
      );
    }
  }

  async function submitReply(e: React.FormEvent) {
    e.preventDefault();
    if (!replyBody.trim()) return;
    setSubmittingReply(true);
    setReplyError(null);
    try {
      await submitReplyApi(post.id, replyBody);
      // The route only returns { id, created_at } — refetch the full
      // replies list so authorName and like state are populated correctly
      // rather than guessing at the current user's display name here.
      const freshReplies = await fetchReplies(post.id);
      if (freshReplies) setReplies(freshReplies);
      setPost((p) => ({ ...p, replyCount: p.replyCount + 1 }));
      setReplyBody("");
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : "Couldn't post reply. Try again.");
    } finally {
      setSubmittingReply(false);
    }
  }

  async function handlePostDelete() {
    if (deletingPost) return;
    if (!window.confirm("Delete this post? This can't be undone.")) return;
    setDeletingPost(true);
    try {
      await deletePost(post.id);
      router.push(`/community/${post.communitySlug}`);
    } catch {
      setDeletingPost(false);
    }
  }

  async function handleReplyDelete(replyId: string) {
    if (deletingReplyId) return;
    if (!window.confirm("Delete this reply? This can't be undone.")) return;
    setDeletingReplyId(replyId);
    try {
      await deleteReply(replyId);
      setReplies((prev) => prev.filter((r) => r.id !== replyId));
      setPost((p) => ({ ...p, replyCount: Math.max(p.replyCount - 1, 0) }));
    } finally {
      setDeletingReplyId(null);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        {post.isPinned && <Pin className="h-3.5 w-3.5 text-gold-400" strokeWidth={2} />}
        <Badge variant="outline">{post.tag}</Badge>
        <span className="text-xs text-text-tertiary">
          {post.authorName} · {timeAgo(post.createdAt)}
        </span>
      </div>

      <h1 className="font-display text-xl text-text-primary mb-3">{post.title}</h1>
      <p className="text-text-primary text-sm whitespace-pre-wrap mb-4">{post.body}</p>

      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={handlePostLike}
          disabled={likingPost}
          className={cn(
            "flex items-center gap-1.5 text-sm transition-colors ease-premium",
            post.userLiked ? "text-gold-400" : "text-text-tertiary hover:text-text-secondary"
          )}
        >
          <Heart className="h-4 w-4" fill={post.userLiked ? "currentColor" : "none"} strokeWidth={1.75} />
          {post.likesCount}
        </button>

        {currentUserId && post.authorId === currentUserId ? (
          <button
            onClick={handlePostDelete}
            disabled={deletingPost}
            className="flex items-center gap-1.5 text-sm text-text-tertiary hover:text-danger transition-colors ease-premium"
          >
            {deletingPost ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />}
            Delete
          </button>
        ) : (
          <ReportModal communityPostId={post.id} triggerClassName="text-sm gap-1.5" />
        )}
      </div>

      <div className="border-t border-border-hairline pt-5">
        <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">
          Replies ({replies.length})
        </h2>

        <form onSubmit={submitReply} className="mb-5">
          <textarea
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            maxLength={4_000}
            rows={2}
            placeholder="Write a reply…"
            className="w-full rounded-sm bg-base border border-interactive px-4 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-gold-500/60 resize-none"
          />
          {replyError && <p className="text-sm text-danger mt-1.5">{replyError}</p>}
          <div className="flex justify-end mt-2">
            <Button type="submit" size="sm" disabled={submittingReply || !replyBody.trim()}>
              {submittingReply ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reply"}
            </Button>
          </div>
        </form>

        <div className="flex flex-col gap-3">
          {replies.map((r) => (
            <div key={r.id} className="border-l-2 border-border-hairline pl-3">
              <div className="text-xs text-text-tertiary mb-0.5">
                {r.authorName} · {timeAgo(r.createdAt)}
              </div>
              <p className="text-sm text-text-primary whitespace-pre-wrap">{r.body}</p>
              <div className="flex items-center gap-3 mt-1">
                <button
                  onClick={() => handleReplyLike(r.id)}
                  className={cn(
                    "flex items-center gap-1 text-xs",
                    r.userLiked ? "text-gold-400" : "text-text-tertiary hover:text-text-secondary"
                  )}
                >
                  <Heart className="h-3 w-3" fill={r.userLiked ? "currentColor" : "none"} strokeWidth={1.75} />
                  {r.likesCount}
                </button>

                {currentUserId && r.authorId === currentUserId ? (
                  <button
                    onClick={() => handleReplyDelete(r.id)}
                    disabled={deletingReplyId === r.id}
                    className="flex items-center gap-1 text-xs text-text-tertiary hover:text-danger transition-colors ease-premium"
                  >
                    {deletingReplyId === r.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Trash2 className="h-3 w-3" strokeWidth={1.75} />
                    )}
                    Delete
                  </button>
                ) : (
                  <ReportModal communityReplyId={r.id} triggerClassName="text-xs gap-1" />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
