import { Heart } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { RevealGroup, RevealItem } from "@/components/admin/motion/reveal";
import type { TopPost } from "@/lib/admin/analytics";

export function TopPostsList({ posts }: { posts: TopPost[] }) {
  if (posts.length === 0) {
    return <p className="text-xs text-text-tertiary py-6 text-center">No community posts in this window yet.</p>;
  }

  return (
    <RevealGroup className="divide-y divide-border-hairline -mx-1">
      {posts.map((p) => (
        <RevealItem key={p.post_id}>
          <div className="flex items-start gap-3 px-1 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-gold-400 font-medium">{p.character_name}</p>
              <p className="text-sm text-text-primary truncate">{p.caption || "(no caption)"}</p>
              <p className="text-[11px] text-text-tertiary mt-0.5">
                {formatDistanceToNowStrict(new Date(p.created_at), { addSuffix: true })}
              </p>
            </div>
            <div className="flex items-center gap-1 text-xs text-text-secondary shrink-0 tabular-nums">
              <Heart className="h-3 w-3" strokeWidth={1.75} />
              {p.likes_count}
            </div>
          </div>
        </RevealItem>
      ))}
    </RevealGroup>
  );
}
