"use client";

import { useState } from "react";
import { Loader2, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { usePaywall } from "@/components/paywall/paywall-provider";
import type { DigitalTwinProfile, TrainingDepth } from "@/lib/digital-twin/engine";

const DEPTH_LABELS: Record<TrainingDepth, string> = {
  standard: "Standard",
  deep: "Deep",
  master: "Master",
};

const inputClass =
  "w-full rounded-sm bg-base border border-interactive px-4 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-gold-500/60";

export function TrainingPanel({
  profile,
  trainingCosts,
  trainingEtas,
  tokens,
  onProfileChange,
}: {
  profile: DigitalTwinProfile | null;
  trainingCosts: Record<TrainingDepth, number>;
  trainingEtas: Record<TrainingDepth, number>;
  tokens: number;
  onProfileChange: (profile: DigitalTwinProfile) => void;
}) {
  const [depth, setDepth] = useState<TrainingDepth>("standard");
  const [training, setTraining] = useState(false);
  const [trainError, setTrainError] = useState<string | null>(null);
  const [trainNotice, setTrainNotice] = useState<string | null>(null);

  const [notes, setNotes] = useState(profile?.manualNotes ?? "");
  const [phrases, setPhrases] = useState<string[]>(profile?.manualSamplePhrases ?? []);
  const [phraseInput, setPhraseInput] = useState("");
  const [enabled, setEnabled] = useState(profile?.enabled ?? true);
  const [savingManual, setSavingManual] = useState(false);
  const [manualSaved, setManualSaved] = useState(false);
  const { openPaywallForError } = usePaywall();

  const cost = trainingCosts[depth];
  const canAffordDepth = cost === 0 || tokens >= cost;

  async function train() {
    setTraining(true);
    setTrainError(null);
    setTrainNotice(null);
    try {
      const res = await fetch("/api/digital-twin/train", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ depth }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "INSUFFICIENT_HISTORY") {
          setTrainError(
            `Need a bit more history first — you have ${data.messageCount} messages so far. Keep chatting and try again.`
          );
        } else if (data.code === "INSUFFICIENT_TOKENS") {
          // Token-cost gate, not a broken request — same shared paywall
          // every other gated action (LoRA, video, images) uses, so
          // there's a real "buy tokens" CTA instead of a dead-end string.
          // No usageStat here: that prop renders as a daily-reset bar
          // ("X of Y used today"), which doesn't fit a one-time training
          // cost — same reasoning character-actions.tsx already applies
          // to its own openPaywallForError() call for LoRA training.
          if (!openPaywallForError(data.code)) {
            setTrainError(`${DEPTH_LABELS[depth]} training costs ${data.tokensRequired} tokens — you have ${data.tokensAvailable}.`);
          }
        } else if (data.code === "RATE_LIMIT_EXCEEDED") {
          setTrainError("Too many training requests — try again in a moment.");
        } else {
          setTrainError(data.error ?? "Training failed.");
        }
        return;
      }
      if (data.profile) onProfileChange(data.profile);
      setTrainNotice(`Trained on ${data.messageCount} messages.`);
    } catch {
      setTrainError("Training failed. Try again.");
    } finally {
      setTraining(false);
    }
  }

  function addPhrase() {
    const v = phraseInput.trim();
    if (!v || phrases.length >= 10 || phrases.includes(v)) return;
    setPhrases((p) => [...p, v]);
    setPhraseInput("");
  }

  async function saveManual(e: React.FormEvent) {
    e.preventDefault();
    setSavingManual(true);
    setManualSaved(false);
    try {
      const res = await fetch("/api/digital-twin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manualNotes: notes, manualSamplePhrases: phrases, enabled }),
      });
      const data = await res.json();
      if (res.ok && data.profile) {
        onProfileChange(data.profile);
        setManualSaved(true);
      }
    } finally {
      setSavingManual(false);
    }
  }

  const traits = profile?.autoTraits;

  return (
    <div className="space-y-6">
      {/* Trait summary */}
      <Card interactive={false} className="p-4">
        {traits ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
                Learned style
              </h3>
              {profile?.lastTrainedAt && (
                <span className="text-xs text-text-tertiary">
                  Last trained {new Date(profile.lastTrainedAt).toLocaleDateString()} ·{" "}
                  {profile.lastTrainingDepth ? DEPTH_LABELS[profile.lastTrainingDepth] : ""}
                </span>
              )}
            </div>
            {profile?.autoStyleSummary && (
              <p className="text-sm text-text-primary">{profile.autoStyleSummary}</p>
            )}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Row label="Tone" value={traits.tone} />
              <Row label="Formality" value={traits.formality} />
              <Row label="Message length" value={traits.avgMessageLength} />
              <Row label="Emoji usage" value={traits.emojiUsage} />
            </dl>
            {traits.commonPhrases.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {traits.commonPhrases.map((p) => (
                  <Badge key={p} variant="outline">
                    {p}
                  </Badge>
                ))}
              </div>
            )}
            <p className="text-xs text-text-tertiary">
              Trained on {profile?.sourceMessageCount ?? 0} messages
              {profile?.sourceBreakdown
                ? ` (${profile.sourceBreakdown.chat} chat, ${profile.sourceBreakdown.community} community)`
                : ""}
              .
            </p>
          </div>
        ) : (
          <p className="text-sm text-text-tertiary">
            Not trained yet — run a training pass below to build your style profile.
          </p>
        )}
      </Card>

      {/* Train controls */}
      <div>
        <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">
          Train
        </h3>
        <div className="grid sm:grid-cols-3 gap-2.5 mb-3">
          {(Object.keys(DEPTH_LABELS) as TrainingDepth[]).map((d) => {
            const active = depth === d;
            const affordable = trainingCosts[d] === 0 || tokens >= trainingCosts[d];
            return (
              <button
                key={d}
                onClick={() => setDepth(d)}
                className={cn(
                  "rounded-sm border p-3 text-left transition-colors ease-premium",
                  active
                    ? "border-gold-500 bg-gold-500/[0.06]"
                    : "border-border-hairline hover:border-white/20",
                  !affordable && "opacity-60"
                )}
              >
                <div className="text-sm font-semibold text-text-primary">{DEPTH_LABELS[d]}</div>
                <div className="text-xs text-text-tertiary mt-0.5">
                  {trainingCosts[d] === 0 ? "Free" : `${trainingCosts[d]} tokens`} · ~
                  {trainingEtas[d]}s
                </div>
              </button>
            );
          })}
        </div>

        {!canAffordDepth && (
          <p className="text-sm text-danger mb-2">
            You need {cost} tokens for {DEPTH_LABELS[depth]} training — you have {tokens}.
          </p>
        )}
        {trainError && <p className="text-sm text-danger mb-2">{trainError}</p>}
        {trainNotice && !trainError && (
          <p className="text-sm text-gold-400 mb-2 flex items-center gap-1">
            <Check className="h-3.5 w-3.5" /> {trainNotice}
          </p>
        )}

        <Button onClick={train} disabled={training || !canAffordDepth} size="sm">
          {training ? <Loader2 className="h-4 w-4 animate-spin" /> : "Train twin"}
        </Button>
      </div>

      {/* Manual refinement */}
      <form onSubmit={saveManual} className="space-y-4 border-t border-border-hairline pt-5">
        <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
          Manual refinement
        </h3>
        <p className="text-xs text-text-tertiary -mt-2">
          Always takes precedence over what auto-training infers.
        </p>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1.5">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={2000}
            rows={3}
            placeholder="Anything your twin should know about how you write…"
            className={cn(inputClass, "py-2.5 resize-none")}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1.5">
            Sample phrases
          </label>
          <div className="flex gap-2">
            <input
              value={phraseInput}
              onChange={(e) => setPhraseInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addPhrase();
                }
              }}
              maxLength={100}
              placeholder="A phrase you use often"
              className={cn(inputClass, "h-11")}
            />
            <Button type="button" variant="secondary" size="sm" onClick={addPhrase}>
              Add
            </Button>
          </div>
          {phrases.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {phrases.map((p) => (
                <span
                  key={p}
                  className="inline-flex items-center gap-1 rounded-xs border border-border-hairline px-2 py-1 text-xs text-text-secondary"
                >
                  {p}
                  <button
                    type="button"
                    onClick={() => setPhrases((prev) => prev.filter((x) => x !== p))}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <label className="flex items-center justify-between rounded-sm border border-border-hairline px-4 py-3 cursor-pointer">
          <div>
            <div className="text-sm text-text-primary font-medium">Twin enabled</div>
            <div className="text-xs text-text-secondary mt-0.5">
              Turn off to stop generating replies as you without losing training
            </div>
          </div>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-5 w-5 accent-gold-500"
          />
        </label>

        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={savingManual}>
            {savingManual ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </Button>
          {manualSaved && !savingManual && (
            <span className="flex items-center gap-1 text-sm text-gold-400">
              <Check className="h-4 w-4" /> Saved
            </span>
          )}
        </div>
      </form>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-text-tertiary">{label}</dt>
      <dd className="text-text-primary capitalize">{value}</dd>
    </div>
  );
}
