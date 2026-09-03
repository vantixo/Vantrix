import Link from "next/link";
import { Heart, MessageCircle, Pin } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, timeAgo } from "@/lib/utils";
import type { CommunityPost } from "@/types/community";

export function PostListItem({ post }: { post: CommunityPost }) {
  return (
    <Card className="p-0">
      <Link href={`/community/posts/${post.id}`} className="block p-4">
        <div className="flex items-center gap-2 mb-1.5">
          {post.isPinned && <Pin className="h-3 w-3 text-gold-400" strokeWidth={2} />}
          <Badge variant="outline">{post.tag}</Badge>
          <span className="text-xs text-text-tertiary">
            {post.authorName} · {timeAgo(post.createdAt)}
          </span>
        </div>

        <h3 className="text-text-primary font-semibold text-[15px] leading-snug mb-1">
          {post.title}
        </h3>
        <p className="text-text-secondary text-sm line-clamp-2">{post.body}</p>

        <div className="flex items-center gap-4 mt-3">
          <span
            className={cn(
              "flex items-center gap-1.5 text-xs",
              post.userLiked ? "text-gold-400" : "text-text-tertiary"
            )}
          >
            <Heart className="h-3.5 w-3.5" fill={post.userLiked ? "currentColor" : "none"} strokeWidth={1.75} />
            {post.likesCount}
          </span>
          <span className="flex items-center gap-1.5 text-xs text-text-tertiary">
            <MessageCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
            {post.replyCount}
          </span>
        </div>
      </Link>
    </Card>
  );
}
