import { SafeImage as Image } from "@/components/ui/safe-image";
import Link from "next/link";
import { resolveImageSrc } from "@/lib/utils";

export interface CreatorSummary {
  id: string;
  handle: string;
  avatar_url: string | null;
}

/**
 * Reference-image parity: "Creators You Follow" circular-avatar row
 * (mirrors the same visual language as the sidebar's account menu
 * avatar). Renders nothing for signed-out visitors — there is no
 * "creators you follow" concept without an account, same guard
 * WhileYouWereAway uses for its own empty state.
 */
export function CreatorsYouFollow({ creators }: { creators: CreatorSummary[] }) {
  if (creators.length === 0) return null;

  return (
    <section className="px-4 md:px-8 py-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-lg md:text-xl text-text-primary">
            Creators You Follow
          </h2>
          <Link href="/studio" className="text-xs text-gold-400 hover:underline">
            See all
          </Link>
        </div>
        <div className="flex gap-6 overflow-x-auto no-scrollbar">
          {creators.map((creator) => (
            <Link
              key={creator.id}
              href={`/studio/${creator.id}`}
              className="flex flex-col items-center gap-2 shrink-0 group"
            >
              <div className="relative h-16 w-16 rounded-full overflow-hidden border border-border-hairline group-hover:border-gold-500/50 transition-colors ease-premium">
                <Image
                  src={resolveImageSrc(creator.avatar_url)}
                  alt={creator.handle}
                  fill
                  sizes="64px"
                  className="object-cover"
                />
              </div>
              <span className="text-xs text-text-secondary truncate max-w-[76px]">
                @{creator.handle}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
