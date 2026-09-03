"use client";

import { useRef, useState } from "react";
import { Loader2, Send, Copy, Check, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn, safeRandomUUID } from "@/lib/utils";
import type { DigitalTwinProfile } from "@/lib/digital-twin/engine";

type Adjustment = "as_is" | "warmer" | "concise" | "playful" | "direct";

const ADJUSTMENTS: { value: Adjustment; label: string }[] = [
  { value: "as_is", label: "As-is" },
  { value: "warmer", label: "Warmer" },
  { value: "concise", label: "More concise" },
  { value: "playful", label: "Playful" },
  { value: "direct", label: "Direct" },
];

interface Generation {
  id: string;
  prompt: string;
  replies: string[];
  adjustment: Adjustment;
}

export function ChatPanel({ profile }: { profile: DigitalTwinProfile | null }) {
  const [prompt, setPrompt] = useState("");
  const [adjustment, setAdjustment] = useState<Adjustment>("as_is");
  const [variantCount, setVariantCount] = useState<1 | 2 | 3>(1);
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const trained = Boolean(profile?.autoTraits);
  const disabled = trained && profile?.enabled === false;

  async function generate(overridePrompt?: string, overrideAdjustment?: Adjustment) {
    const body = (overridePrompt ?? prompt).trim();
    if (!body || generating) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/digital-twin/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: body,
          adjustment: overrideAdjustment ?? adjustment,
          variantCount,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't generate a reply.");
        return;
      }
      setGenerations((prev) => [
        {
          id: safeRandomUUID(),
          prompt: body,
          replies: data.replies as string[],
          adjustment: overrideAdjustment ?? adjustment,
        },
        ...prev,
      ]);
      if (!overridePrompt) setPrompt("");
    } catch {
      setError("Couldn't generate a reply. Try again.");
    } finally {
      setGenerating(false);
    }
  }

  async function copyReply(key: string, text: string) {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
  }

  if (!trained) {
    return (
      <p className="text-sm text-text-tertiary py-12 text-center">
        Train your twin first — head to the Training tab.
      </p>
    );
  }

  if (disabled) {
    return (
      <p className="text-sm text-text-tertiary py-12 text-center">
        Your twin is currently turned off. Re-enable it from the Training tab to chat.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-secondary">
        Drop in a message someone sent you and your twin will draft a reply the way you&rsquo;d
        actually write it.
      </p>

      <textarea
        ref={textareaRef}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            generate();
          }
        }}
        maxLength={2000}
        rows={3}
        placeholder="Paste the message you're replying to… (⌘/Ctrl + Enter to generate)"
        className={cn(
          "w-full rounded-sm bg-base border border-interactive px-4 py-2.5 text-sm text-text-primary",
          "placeholder:text-text-tertiary focus:outline-none focus:border-gold-500/60 resize-none"
        )}
      />

      <div className="flex flex-wrap items-center gap-2">
        {ADJUSTMENTS.map((a) => (
          <button
            key={a.value}
            type="button"
            onClick={() => setAdjustment(a.value)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs transition-colors",
              adjustment === a.value
                ? "border-gold-500/60 bg-gold-500/10 text-gold-300"
                : "border-interactive text-text-tertiary hover:text-text-secondary"
            )}
          >
            {a.label}
          </button>
        ))}

        <span className="mx-1 h-4 w-px bg-interactive" />

        {([1, 2, 3] as const).map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setVariantCount(n)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs transition-colors",
              variantCount === n
                ? "border-gold-500/60 bg-gold-500/10 text-gold-300"
                : "border-interactive text-text-tertiary hover:text-text-secondary"
            )}
          >
            {n} {n === 1 ? "reply" : "options"}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <Button onClick={() => generate()} disabled={generating || !prompt.trim()} size="sm">
        {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        Generate {variantCount > 1 ? `${variantCount} replies` : "reply"}
      </Button>

      <div className="flex flex-col gap-4 pt-2">
        {generations.map((g) => (
          <div key={g.id} className="space-y-2">
            <p className="text-xs text-text-tertiary">To: {g.prompt}</p>
            <div className={cn("grid gap-2", g.replies.length > 1 && "sm:grid-cols-2")}>
              {g.replies.map((r, i) => {
                const key = `${g.id}:${i}`;
                return (
                  <Card key={key} interactive={false} className="p-4">
                    <p className="text-sm text-text-primary whitespace-pre-wrap">{r}</p>
                    <div className="flex items-center gap-3 mt-3">
                      <button
                        onClick={() => copyReply(key, r)}
                        className="flex items-center gap-1.5 text-xs text-text-tertiary hover:text-text-secondary"
                      >
                        {copiedKey === key ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        {copiedKey === key ? "Copied" : "Copy"}
                      </button>
                    </div>
                  </Card>
                );
              })}
            </div>
            <button
              onClick={() => generate(g.prompt, g.adjustment)}
              disabled={generating}
              className="flex items-center gap-1.5 text-xs text-text-tertiary hover:text-text-secondary disabled:opacity-40"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Regenerate
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
