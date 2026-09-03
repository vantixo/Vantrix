import { SafeImage as Image } from "@/components/ui/safe-image";
import Link from "next/link";
import { Crown, MessageCircle, Sparkles, Cpu, Headphones } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { resolveImageSrc } from "@/lib/utils";

const FEATURES = [
  { icon: MessageCircle, label: "Unlimited Messages" },
  { icon: Sparkles, label: "Exclusive Companions" },
  { icon: Cpu, label: "Advanced AI Models" },
  { icon: Headphones, label: "Priority Support" },
];

/**
 * §3.5 — crown icon in a circular gold-ringed badge, headline + subtext,
 * gold CTA, row of 4 feature bullets with icons. Links straight into the
 * checkout flow per §12 Phase 7 (billing/payments routes aren't wired
 * yet — that's the next phase this banner sets up, not something to
 * stub out with a fake price here).
 *
 * IMAGE PASS: the card was pure icon/text before — no photography. Now
 * takes an optional `images` prop (real companion portraits, same
 * `allCharacters` pool as the rest of Home) and renders them as a
 * blurred/darkened backdrop behind the copy, plus a small avatar chip
 * next to each feature bullet so "Exclusive Companions" etc. actually
 * shows a companion rather than just an icon.
 */
export function PremiumBanner({ images = [] }: { images?: (string | null)[] }) {
  const backdrop = images[0] ? resolveImageSrc(images[0]) : null;

  return (
    <section className="px-4 md:px-8 py-8">
      <Card
        interactive={false}
        className="relative max-w-7xl mx-auto p-6 md:p-10 border-gold-500/25"
      >
        {backdrop && (
          <>
            <Image
              src={backdrop}
              alt=""
              fill
              sizes="100vw"
              className="object-cover opacity-25 blur-[1px] scale-105"
              aria-hidden
            />
            <div
              className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/85 to-black/95"
              aria-hidden
            />
          </>
        )}
        <div className="relative flex flex-col items-center text-center gap-4">
          <div className="h-14 w-14 rounded-full border border-gold-500/50 flex items-center justify-center bg-black/40">
            <Crown className="h-6 w-6 text-gold-500" strokeWidth={1.75} />
          </div>
          <div>
            <h2 className="font-display text-2xl md:text-3xl text-text-primary">
              Go Premium
            </h2>
            <p className="text-text-secondary mt-2 max-w-md">
              Unlock unlimited conversations, exclusive companions, and the
              full depth of Vantrix&rsquo;s living world.
            </p>
          </div>
          <Button asChild size="lg">
            <Link href="/premium">Upgrade Now</Link>
          </Button>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-4 w-full max-w-2xl">
            {FEATURES.map((f, i) => {
              const avatar = images[i + 1] ?? images[i];
              return (
                <div key={f.label} className="flex flex-col items-center gap-2 text-center">
                  <div className="relative h-10 w-10 rounded-full overflow-hidden border border-gold-500/40">
                    {avatar ? (
                      <Image
                        src={resolveImageSrc(avatar)}
                        alt=""
                        fill
                        sizes="40px"
                        className="object-cover"
                      />
                    ) : (
                      <div className="h-full w-full bg-black/40 flex items-center justify-center">
                        <f.icon className="h-5 w-5 text-gold-500" strokeWidth={1.75} />
                      </div>
                    )}
                    <span className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-black/80 border border-gold-500/50 flex items-center justify-center">
                      <f.icon className="h-2.5 w-2.5 text-gold-400" strokeWidth={2} />
                    </span>
                  </div>
                  <span className="text-xs text-text-secondary">{f.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </Card>
    </section>
  );
}
