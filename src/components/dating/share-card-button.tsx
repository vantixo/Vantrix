"use client";

import { useState } from "react";
import { SafeImage as Image } from "@/components/ui/safe-image";
import { Share2, Copy, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useShareCard, type ShareCardRequest } from "@/hooks/use-share-card";

export function ShareCardButton({
  request,
  label = "Share",
  className,
}: {
  request: ShareCardRequest;
  label?: string;
  className?: string;
}) {
  const { createShareCard, isCreating, error } = useShareCard();
  const [result, setResult] = useState<{ shareUrl: string; ogImageUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleClick() {
    if (result) return;
    const card = await createShareCard(request);
    if (card) setResult(card);
  }

  async function handleCopy() {
    if (!result) return;
    await navigator.clipboard.writeText(result.shareUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={className}>
      <button
        onClick={handleClick}
        disabled={isCreating}
        className={cn(
          "flex items-center gap-1.5 text-xs font-medium text-gold-400 hover:text-gold-300",
          isCreating && "opacity-60"
        )}
      >
        {isCreating ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Share2 className="h-3.5 w-3.5" />
        )}
        {label}
      </button>

      {error && <p className="mt-1.5 text-xs text-danger">{error.error}</p>}

      {result && (
        <div className="mt-2 flex items-center gap-3 rounded-md border border-gold-500/30 bg-gold-500/5 p-2">
          <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-sm">
            <Image src={result.ogImageUrl} alt="Share card" fill sizes="56px" className="object-cover" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-text-secondary">{result.shareUrl}</p>
            <button
              onClick={handleCopy}
              className="mt-1 flex items-center gap-1 text-xs font-medium text-gold-400 hover:text-gold-300"
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3" /> Copied
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" /> Copy link
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
