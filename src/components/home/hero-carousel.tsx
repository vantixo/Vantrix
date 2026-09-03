"use client";

import { useState } from "react";
import { SafeImage as Image } from "@/components/ui/safe-image";
import { cn, resolveImageSrc } from "@/lib/utils";
import type { DiscoverFeaturedItem } from "@/lib/frontend/discover";

/**
 * §3.1 — mobile hero variant: "carousel with dot indicators (mobile,
 * single CTA)". Swipeable via native scroll-snap rather than a JS drag
 * handler, with tap-to-jump dots kept in sync via onScroll — matches §6's
 * "native scroll ... snap-to-card" preference used elsewhere (horizontal
 * scroll rows) rather than introducing a second, heavier carousel
 * mechanism just for the hero.
 */
export function HeroCarousel({ items }: { items: DiscoverFeaturedItem[] }) {
  const [active, setActive] = useState(0);

  if (items.length === 0) return null;

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const index = Math.round(el.scrollLeft / el.clientWidth);
    if (index !== active) setActive(index);
  }

  function scrollTo(index: number) {
    const el = document.getElementById("hero-carousel-track");
    el?.scrollTo({ left: index * el.clientWidth, behavior: "smooth" });
  }

  return (
    <div className="md:hidden">
      <div
        id="hero-carousel-track"
        onScroll={handleScroll}
        className="flex overflow-x-auto no-scrollbar snap-x snap-mandatory scroll-smooth rounded-md"
      >
        {items.map((item) => (
          <div
            key={item.id}
            className="relative shrink-0 w-full aspect-[4/5] snap-center"
          >
            <Image
              src={resolveImageSrc(item.image)}
              alt={item.title}
              fill
              sizes="100vw"
              priority
              className="object-cover"
            />
            <div
              className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent"
              aria-hidden
            />
            <div className="absolute inset-x-0 bottom-0 p-5">
              <div className="text-text-primary font-display text-2xl leading-tight">
                {item.title}
              </div>
              {item.subtitle && (
                <p className="text-text-secondary text-sm mt-1 line-clamp-2">
                  {item.subtitle}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      {items.length > 1 && (
        <div className="flex items-center justify-center gap-1.5 mt-3">
          {items.map((item, i) => (
            <button
              key={item.id}
              aria-label={`Go to slide ${i + 1}`}
              onClick={() => scrollTo(i)}
              className={cn(
                "h-1.5 rounded-full transition-all ease-premium duration-200",
                i === active ? "w-5 bg-gold-500" : "w-1.5 bg-white/20"
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
