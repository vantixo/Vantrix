import Link from "next/link";
import { SafeImage as Image } from "@/components/ui/safe-image";
import { Sparkles, MessagesSquare, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { resolveImageSrc } from "@/lib/utils";
import type { Community, CommunityType } from "@/types/community";

const TYPE_ICON: Record<CommunityType, LucideIcon> = {
  creator: Sparkles,
  general: MessagesSquare,
};

/**
 * General/Creator Hub don't carry a real image_url — a community without
 * one gets a plain icon glyph instead of running through resolveImageSrc's
 * generic character-art fallback (which would put a companion headshot on
 * rows that aren't about any one companion).
 */
export function CommunityRowCard({ community }: { community: Community }) {
  const Icon = TYPE_ICON[community.type];

  return (
    <Card className="p-0">
      <Link href={`/community/${community.slug}`} className="flex items-center gap-3 p-3">
        <div className="relative h-12 w-12 shrink-0 rounded-full overflow-hidden bg-white/[0.04] border border-border-hairline flex items-center justify-center">
          {community.imageUrl ? (
            <Image
              src={resolveImageSrc(community.imageUrl)}
              alt={community.name}
              fill
              sizes="48px"
              className="object-cover"
            />
          ) : (
            <Icon className="h-5 w-5 text-gold-400" strokeWidth={1.75} />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-text-primary font-semibold text-sm truncate">
            {community.name}
          </div>
          <div className="text-text-secondary text-xs truncate mt-0.5">
            {community.description}
          </div>
        </div>

        <div className="shrink-0 text-right text-xs text-text-tertiary">
          {community.postCount} {community.postCount === 1 ? "post" : "posts"}
        </div>
      </Link>
    </Card>
  );
}
