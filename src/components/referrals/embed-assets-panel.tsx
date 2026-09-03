"use client";

import { useEffect, useState } from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { BANNER_SIZES, type BannerSize } from "@/lib/referral-assets";

/**
 * WIRE-FIX (2026-08-20): three fully-built partner-embed routes
 * (GET /api/referrals/assets/badge, /banner/[size], /widget.js) existed
 * with zero references anywhere in the frontend — an approved dev/
 * influencer partner had a payout form and a raw referral link, but no
 * way to actually get the embeddable assets those routes generate. This
 * panel is the missing "copy this snippet" surface, shown only once a
 * partner reaches isApprovedCash (see referrals-dashboard.tsx) — badges/
 * banners/widgets only make sense for a partner who's actually running
 * their own site.
 *
 * Uses window.location.origin rather than the hardcoded "vantrix.ink"
 * seen in /api/referrals/me and the widget.js route's own example
 * comment, so the copy-pasted snippet works correctly in whatever
 * environment (staging/preview/prod) this is actually running in.
 */

const inputClass =
  "w-full h-11 rounded-sm bg-base border border-interactive px-4 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-gold-500/60";

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="flex items-center gap-2">
      <textarea
        readOnly
        value={value}
        rows={2}
        onClick={(e) => e.currentTarget.select()}
        className={cn(inputClass, "h-auto resize-none py-2.5 font-mono text-[12px] leading-snug text-text-secondary")}
      />
      <Button variant="secondary" size="md" onClick={copy} className="shrink-0">
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}

export function EmbedAssetsPanel({ code }: { code: string }) {
  const [origin, setOrigin] = useState("");
  const [bannerSize, setBannerSize] = useState<BannerSize>("300x250");
  const [widgetStyle, setWidgetStyle] = useState<"badge" | "banner">("badge");
  const [widgetPosition, setWidgetPosition] = useState<"bottom-right" | "bottom-left">(
    "bottom-right"
  );

  // Origin isn't known until mount (avoids an SSR/CSR mismatch on a static
  // string) — every snippet below is empty until this resolves, which is
  // fine since the panel mounts client-side only anyway.
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  if (!origin) return null;

  const badgeUrl = `${origin}/api/referrals/assets/badge?code=${encodeURIComponent(code)}`;
  const bannerUrl = `${origin}/api/referrals/assets/banner/${bannerSize}?code=${encodeURIComponent(code)}`;
  const widgetUrl = `${origin}/api/referrals/assets/widget.js?code=${encodeURIComponent(code)}&position=${widgetPosition}&style=${widgetStyle}`;

  return (
    <div className="rounded-md border border-border-hairline p-5 space-y-6">
      <div>
        <div className="text-sm font-medium text-text-primary">Embed assets</div>
        <p className="mt-1 text-xs text-text-tertiary">
          Drop these on your own site — the click, not the image request, is what carries
          attribution.
        </p>
      </div>

      {/* Badge */}
      <div>
        <div className="mb-2 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- server-generated SVG via API route, not a next/image-optimizable static asset */}
          <img src={badgeUrl} alt="Referral badge preview" width={48} height={48} />
          <span className="text-xs uppercase tracking-wide text-text-secondary">
            Circular badge
          </span>
        </div>
        <CopyField value={`<img src="${badgeUrl}" alt="Vantrix" width="120" height="120" />`} />
      </div>

      {/* Banner */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-text-secondary">Banner</span>
          <select
            value={bannerSize}
            onChange={(e) => setBannerSize(e.target.value as BannerSize)}
            className="h-8 rounded-sm bg-base border border-interactive px-2 text-xs text-text-primary focus:outline-none focus:border-gold-500/60"
          >
            {(Object.keys(BANNER_SIZES) as BannerSize[]).map((size) => (
              <option key={size} value={size}>
                {size} — {BANNER_SIZES[size].label}
              </option>
            ))}
          </select>
        </div>
        <div className="mb-2 overflow-hidden rounded-sm border border-border-hairline">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={bannerUrl} alt="Referral banner preview" className="block max-w-full" />
        </div>
        <CopyField
          value={`<a href="${origin}/r/${code}" target="_blank" rel="noopener sponsored"><img src="${bannerUrl}" alt="Vantrix" /></a>`}
        />
      </div>

      {/* Widget */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-text-secondary">
            Floating widget
          </span>
          <div className="flex gap-1">
            {(["badge", "banner"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setWidgetStyle(s)}
                className={cn(
                  "h-8 rounded-sm border px-2.5 text-xs font-medium capitalize transition-colors ease-premium",
                  widgetStyle === s
                    ? "border-gold-500 text-gold-400 bg-gold-500/5"
                    : "border-border-hairline text-text-secondary hover:text-text-primary"
                )}
              >
                {s}
              </button>
            ))}
            {widgetStyle === "badge" &&
              (["bottom-right", "bottom-left"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setWidgetPosition(p)}
                  className={cn(
                    "h-8 rounded-sm border px-2.5 text-xs font-medium transition-colors ease-premium",
                    widgetPosition === p
                      ? "border-gold-500 text-gold-400 bg-gold-500/5"
                      : "border-border-hairline text-text-secondary hover:text-text-primary"
                  )}
                >
                  {p === "bottom-right" ? "Right" : "Left"}
                </button>
              ))}
          </div>
        </div>
        <p className="mb-2 text-xs text-text-tertiary">
          A single script tag — no iframe, no build step, works on any site.
        </p>
        <CopyField value={`<script src="${widgetUrl}" async></script>`} />
      </div>
    </div>
  );
}
