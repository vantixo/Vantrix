import { notFound } from "next/navigation";
import Link from "next/link";
import { SafeImage as Image } from "@/components/ui/safe-image";
import { ChevronLeft, Sparkles, MessagesSquare, type LucideIcon } from "lucide-react";
import { getCommunityBySlug, getCommunityPosts } from "@/lib/frontend/community";
import { DiscussionFeed } from "@/components/community/discussion-feed";
import { resolveImageSrc } from "@/lib/utils";
import type { CommunityType } from "@/types/community";

export const dynamic = "force-dynamic";

// Same fallback as community-row-card.tsx: general/creator-hub don't carry
// a real image_url, so a community without art gets a type-colored icon
// glyph instead of a broken/blank image.
const TYPE_ICON: Record<CommunityType, LucideIcon> = {
  creator: Sparkles,
  general: MessagesSquare,
};

export default async function CommunityPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;

  const [community, page] = await Promise.all([
    getCommunityBySlug(slug),
    getCommunityPosts(slug, { sort: "new" }),
  ]);

  if (!community) notFound();

  const Icon = TYPE_ICON[community.type];

  return (
    <div className="mx-auto max-w-2xl px-4 md:px-8 py-6">
      <Link
        href="/community"
        className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary mb-4"
      >
        <ChevronLeft className="h-4 w-4" /> Community
      </Link>

      {community.bannerUrl && (
        <div className="relative h-32 w-full overflow-hidden rounded-md mb-4 border border-border-hairline">
          <Image
            src={resolveImageSrc(community.bannerUrl)}
            alt=""
            fill
            sizes="672px"
            className="object-cover"
          />
        </div>
      )}

      <div className="flex items-center gap-3 mb-1">
        <div className="relative h-14 w-14 shrink-0 rounded-full overflow-hidden bg-white/[0.04] border border-border-hairline flex items-center justify-center">
          {community.imageUrl ? (
            <Image
              src={resolveImageSrc(community.imageUrl)}
              alt={community.name}
              fill
              sizes="56px"
              className="object-cover"
            />
          ) : (
            <Icon className="h-6 w-6 text-gold-400" strokeWidth={1.75} />
          )}
        </div>
        <div className="min-w-0">
          <h1 className="font-display text-2xl text-text-primary truncate">{community.name}</h1>
          <p className="text-text-tertiary text-xs">
            {community.memberCount.toLocaleString()} {community.memberCount === 1 ? "member" : "members"} ·{" "}
            {community.postCount.toLocaleString()} {community.postCount === 1 ? "post" : "posts"}
          </p>
        </div>
      </div>
      <p className="text-text-secondary text-sm mb-6">{community.description}</p>

      <DiscussionFeed
        communitySlug={slug}
        initialPosts={page.posts}
        initialNextCursor={page.nextCursor}
      />
    </div>
  );
}
