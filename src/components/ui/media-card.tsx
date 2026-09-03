import Link from "next/link";
import { SafeImage } from "./safe-image";
import { Card } from "./card";
import { cn } from "@/lib/utils";

/**
 * FRONTEND_DIRECTIVE §4: "Card — companion card, category card (share
 * one base card primitive)". This is that primitive — a fixed-ratio
 * image with a bottom gradient for text legibility, a badge slot
 * (top-left), and a content slot (bottom, over the gradient). Featured-
 * companion cards and experience cards both compose this rather than
 * duplicating the image/gradient/badge markup.
 */
export function MediaCard({
  href,
  image,
  alt,
  badge,
  cornerBadge,
  children,
  className,
  imageClassName,
  priority,
  onClick,
  fallback,
}: {
  href: string;
  image: string;
  alt: string;
  badge?: React.ReactNode;
  /** Top-RIGHT badge slot, independent of `badge` (top-left) — e.g.
   *  CompanionCard's premium-lock indicator, which needs to coexist with
   *  the New/Hot badge rather than replace it. */
  cornerBadge?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  imageClassName?: string;
  priority?: boolean;
  /** Fired on tap/click, before navigation — e.g. CompanionCard's click-tracking ping. */
  onClick?: () => void;
  /** Placeholder to swap to if `image` 404s. Defaults to the character placeholder (most callers render character art); pass WORLD_IMAGE_FALLBACK / SCENARIO_IMAGE_FALLBACK for other content types. */
  fallback?: string;
}) {
  return (
    <Card className={cn("p-0", className)}>
      <Link href={href} onClick={onClick} className="block group/card">
        <div className={cn("relative aspect-[3/4] w-full", imageClassName)}>
          <SafeImage
            src={image}
            fallback={fallback}
            alt={alt}
            fill
            sizes="(max-width: 640px) 168px, 200px"
            priority={priority}
            className="object-cover transition-transform duration-300 ease-premium group-hover/card:scale-[1.03]"
          />
          <div
            className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/90 via-black/40 to-transparent"
            aria-hidden
          />
          {badge && <div className="absolute top-2 left-2">{badge}</div>}
          {cornerBadge && <div className="absolute top-2 right-2">{cornerBadge}</div>}
          <div className="absolute inset-x-0 bottom-0 p-3">{children}</div>
        </div>
      </Link>
    </Card>
  );
}
