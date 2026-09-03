"use client";

import { useCallback } from "react";
import type { CommunityPost, CommunityReply, DiscussionSort } from "@/types/community";

/**
 * FRONTEND_DIRECTIVE §10 — domain hook for community/*. Previously
 * discussion-feed.tsx and discussion-thread.tsx each hand-rolled their own
 * fetch calls against /api/community/*. Pulled out here so both share one
 * typed surface, matching the pattern already used by use-dating-deck.ts.
 *
 * Deliberately NOT the generic `{ data, isLoading, error }` SWR shape:
 * every one of these calls is paired with local optimistic state the
 * caller owns (a like toggle, a cursor-paginated list, a reply being
 * appended) exactly like use-dating-deck.ts's swipe() — the caller needs
 * the raw result back to merge into its own state, not a hook-owned cache.
 */

export interface PostsPage {
  posts: CommunityPost[];
  nextCursor: string | null;
}

export interface LikeResult {
  liked: boolean;
  likesCount: number;
}

export function useCommunity() {
  const fetchPosts = useCallback(
    async (communitySlug: string, sort: DiscussionSort, cursor?: string): Promise<PostsPage | null> => {
      const sp = new URLSearchParams({ slug: communitySlug, sort });
      if (cursor) sp.set("cursor", cursor);
      const res = await fetch(`/api/community/posts?${sp.toString()}`);
      if (!res.ok) return null;
      return (await res.json()) as PostsPage;
    },
    []
  );

  const createPost = useCallback(
    async (communitySlug: string, input: { title: string; body: string; tag?: string }) => {
      // FIX: was sending { slug, ...input } — POST /api/community/posts
      // destructures body.communitySlug (see route.ts), not body.slug, so
      // every call through this hook 422'd with "communitySlug, title, and
      // body are required" regardless of what the caller passed. Currently
      // dead code (create-post-form.tsx does its own inline fetch with the
      // correct key instead of using this hook), so it shipped unnoticed —
      // fixed so the shared hook is actually correct for whenever something
      // does call it.
      const res = await fetch(`/api/community/posts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ communitySlug, ...input }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Couldn't create post.");
      return body;
    },
    []
  );

  const toggleLike = useCallback(
    async (kind: "posts" | "replies", id: string): Promise<LikeResult | null> => {
      const res = await fetch(`/api/community/${kind}/${id}/like`, { method: "POST" });
      if (!res.ok) return null;
      return (await res.json()) as LikeResult;
    },
    []
  );

  const fetchReplies = useCallback(async (postId: string): Promise<CommunityReply[] | null> => {
    const res = await fetch(`/api/community/posts/${postId}/replies`);
    if (!res.ok) return null;
    const body = await res.json();
    return body.replies as CommunityReply[];
  }, []);

  const submitReply = useCallback(async (postId: string, body: string) => {
    const res = await fetch(`/api/community/posts/${postId}/replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error ?? "Couldn't post reply.");
    return data;
  }, []);

  const deletePost = useCallback(async (postId: string): Promise<void> => {
    const res = await fetch(`/api/community/posts/${postId}`, { method: "DELETE" });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error ?? "Couldn't delete post.");
  }, []);

  const deleteReply = useCallback(async (replyId: string): Promise<void> => {
    const res = await fetch(`/api/community/replies/${replyId}`, { method: "DELETE" });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error ?? "Couldn't delete reply.");
  }, []);

  const reportContent = useCallback(
    async (input: {
      communityPostId?: string;
      communityReplyId?: string;
      category: string;
      detail?: string;
    }): Promise<void> => {
      const res = await fetch(`/api/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.error ?? "Couldn't submit report.");
    },
    []
  );

  return {
    fetchPosts,
    createPost,
    toggleLike,
    fetchReplies,
    submitReply,
    deletePost,
    deleteReply,
    reportContent,
  };
}
