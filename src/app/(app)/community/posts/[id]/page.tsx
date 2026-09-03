import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getCommunityPost, getCommunityReplies } from "@/lib/frontend/community";
import { getAuthedUser } from "@/lib/auth/get-authed-user";
import { DiscussionThread } from "@/components/community/discussion-thread";

export const dynamic = "force-dynamic";

/**
 * §11: notifications/emit's community_reply ctaUrl points at
 * /community/posts/{id} — this is that route. Previously a 404 for
 * anyone tapping through from a reply notification.
 */
export default async function CommunityPostPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;

  const [post, { user }] = await Promise.all([
    getCommunityPost(id),
    getAuthedUser(),
  ]);
  if (!post) notFound();

  const replies = await getCommunityReplies(id);

  return (
    <div className="mx-auto max-w-2xl px-4 md:px-8 py-6">
      <Link
        href={`/community/${post.communitySlug}`}
        className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary mb-4"
      >
        <ChevronLeft className="h-4 w-4" /> Back
      </Link>

      <DiscussionThread post={post} replies={replies} currentUserId={user?.id ?? null} />
    </div>
  );
}
