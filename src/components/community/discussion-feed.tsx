"use client";

import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { FilterPillGroup } from "@/components/ui/filter-pills";
import { Button } from "@/components/ui/button";
import { PostListItem } from "./post-list-item";
import { CreatePostForm } from "./create-post-form";
import { useCommunity } from "@/hooks/use-community";
import type { CommunityPost, DiscussionSort } from "@/types/community";

const SORT_OPTIONS = [
  { value: "new", label: "New" },
  { value: "trending", label: "Trending" },
  { value: "top", label: "Top" },
];

export function DiscussionFeed({
  communitySlug,
  initialPosts,
  initialNextCursor,
}: {
  communitySlug: string;
  initialPosts: CommunityPost[];
  initialNextCursor: string | null;
}) {
  const [sort, setSort] = useState<DiscussionSort>("new");
  const [posts, setPosts] = useState(initialPosts);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const { fetchPosts } = useCommunity();

  const fetchPage = (targetSort: DiscussionSort, cursor?: string) =>
    fetchPosts(communitySlug, targetSort, cursor);

  async function handleSortChange(value: string) {
    const targetSort = value as DiscussionSort;
    setSort(targetSort);
    setLoading(true);
    const page = await fetchPage(targetSort);
    if (page) {
      setPosts(page.posts);
      setNextCursor(page.nextCursor);
    }
    setLoading(false);
  }

  async function loadMore() {
    if (!nextCursor) return;
    setLoading(true);
    const page = await fetchPage(sort, nextCursor);
    if (page) {
      setPosts((prev) => [...prev, ...page.posts]);
      setNextCursor(page.nextCursor);
    }
    setLoading(false);
  }

  async function handleCreated() {
    setShowCreate(false);
    setSort("new");
    setLoading(true);
    const page = await fetchPage("new");
    if (page) {
      setPosts(page.posts);
      setNextCursor(page.nextCursor);
    }
    setLoading(false);
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <FilterPillGroup options={SORT_OPTIONS} value={sort} onChange={handleSortChange} />
        {!showCreate && (
          <Button size="sm" onClick={() => setShowCreate(true)} className="shrink-0">
            <Plus className="h-4 w-4" /> New post
          </Button>
        )}
      </div>

      {showCreate && (
        <CreatePostForm
          communitySlug={communitySlug}
          onCreated={handleCreated}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {posts.length === 0 && !loading ? (
        <p className="text-sm text-text-tertiary py-16 text-center">
          No discussions yet. Be the first to post.
        </p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {posts.map((p) => (
            <PostListItem key={p.id} post={p} />
          ))}
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" />
        </div>
      )}

      {!loading && sort === "new" && nextCursor && (
        <div className="flex justify-center mt-4">
          <Button variant="secondary" size="sm" onClick={loadMore}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
