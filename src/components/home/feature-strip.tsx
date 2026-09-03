import { SafeImage as Image } from "@/components/ui/safe-image";
import { Brain, Mail, Phone, ImageIcon, Users2, Box, type LucideIcon } from "lucide-react";
import { resolveImageSrc } from "@/lib/utils";

interface Feature {
  title: string;
  blurb: string;
  icon: LucideIcon;
}

/**
 * Reference-image parity: the 6-item capability strip that closes the
 * screenshot's page ("Persistent Memory" … "Custom Worlds"). Static
 * marketing copy — these map 1:1 to real shipped systems (memories,
 * notifications/push, voice-playback,
 * images, group chat rooms, world-expansion) but this strip itself is
 * a summary band, not a query.
 *
 * IMAGE PASS: previously rendered as a plain icon-in-circle + text row
 * (no photography at all). Now each tile gets a real companion portrait
 * as its backdrop — pulled from the same `allCharacters` pool the rest
 * of Home already queries (see HomePage), not stock/placeholder art —
 * so the strip actually shows the product instead of describing it.
 * The lucide icon is kept as a small badge over the photo (gold-ringed,
 * same treatment as before) purely as a category marker; it's no longer
 * carrying the tile's entire visual weight on its own.
 */
const FEATURES: Feature[] = [
  { title: "Persistent Memory", blurb: "They remember everything about you", icon: Brain },
  { title: "Proactive Messages", blurb: "They message you first", icon: Mail },
  { title: "Voice & Calls", blurb: "Real voice, real connection", icon: Phone },
  { title: "Images & Selfies", blurb: "Photos, selfies and special moments", icon: ImageIcon },
  { title: "Group Chats", blurb: "Talk together in shared rooms", icon: Users2 },
  { title: "Custom Worlds", blurb: "Build and explore endless worlds", icon: Box },
];

export function FeatureStrip({ images = [] }: { images?: (string | null)[] }) {
  return (
    <section className="px-4 md:px-8 py-10 border-t border-border-hairline">
      <div className="max-w-7xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {FEATURES.map(({ title, blurb, icon: Icon }, i) => {
          const src = resolveImageSrc(images[i % Math.max(images.length, 1)]);
          return (
            <div
              key={title}
              className="relative rounded-md overflow-hidden border border-border-hairline h-40 group"
            >
              <Image
                src={src}
                alt=""
                fill
                sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                className="object-cover transition-transform duration-300 ease-premium group-hover:scale-105"
              />
              <div
                className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/10"
                aria-hidden
              />
              <span className="absolute top-3 left-3 h-9 w-9 rounded-full bg-black/50 backdrop-blur-sm border border-gold-500/40 flex items-center justify-center">
                <Icon className="h-4 w-4 text-gold-400" />
              </span>
              <div className="absolute inset-x-0 bottom-0 p-4">
                <div className="text-text-primary text-sm font-semibold">{title}</div>
                <div className="text-text-secondary text-xs mt-0.5">{blurb}</div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
