"use client";

import { useCallback } from "react";
import type { FeedPostsPage, FeedCommentsPage, FeedLikeResult, FeedFilter } from "@/types/feed";

/**
 * Client-side counterpart to lib/frontend/feed.ts, matching use-community.ts's
 * shape: raw results handed back to the caller (FeedGrid / FeedPostCard own
 * their own optimistic state) rather than a hook-owned cache, since every
 * call here is paired with local state the caller already manages (a like
 * toggle, a cursor-paginated list, a comment being appended).
 */
export function useFeed() {
  const fetchPosts = useCallback(
    async (filter: FeedFilter, cursor?: string, character?: string): Promise<FeedPostsPage | null> => {
      const sp = new URLSearchParams({ filter });
      if (cursor) sp.set("cursor", cursor);
      if (character) sp.set("character", character);
      const res = await fetch(`/api/feed/posts?${sp.toString()}`);
      if (!res.ok) return null;
      return (await res.json()) as FeedPostsPage;
    },
    []
  );

  const toggleLike = useCallback(async (postId: string): Promise<FeedLikeResult | null> => {
    const res = await fetch(`/api/feed/posts/${postId}/like`, { method: "POST" });
    if (!res.ok) return null;
    return (await res.json()) as FeedLikeResult;
  }, []);

  const fetchComments = useCallback(
    async (postId: string, cursor?: string): Promise<FeedCommentsPage | null> => {
      const sp = new URLSearchParams();
      if (cursor) sp.set("cursor", cursor);
      const qs = sp.toString();
      const res = await fetch(`/api/feed/posts/${postId}/comments${qs ? `?${qs}` : ""}`);
      if (!res.ok) return null;
      return (await res.json()) as FeedCommentsPage;
    },
    []
  );

  const submitComment = useCallback(async (postId: string, content: string) => {
    const res = await fetch(`/api/feed/posts/${postId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error ?? "Couldn't post comment.");
    return data.comment;
  }, []);

  return { fetchPosts, toggleLike, fetchComments, submitComment };
}
