"use client";

import { useEffect, useState } from "react";
import { Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const inputClass =
  "w-full rounded-sm bg-base border border-interactive px-4 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-gold-500/60";

/**
 * Separate from SettingsForm on purpose: date of birth lives behind its
 * own rate-limited endpoint (GET/PATCH /api/profile/date-of-birth,
 * age-gate.ts) rather than the general profile/settings route, so it
 * gets its own fetch + save cycle instead of being folded into the
 * bigger form's single submit.
 */
export function DateOfBirthField() {
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/profile/date-of-birth")
      .then((res) => res.json())
      .then((body) => {
        if (body?.ageVerification?.dateOfBirth) {
          setDateOfBirth(body.ageVerification.dateOfBirth.slice(0, 10));
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/profile/date-of-birth", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateOfBirth }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Couldn't update your date of birth.");
        return;
      }
      setSaved(true);
    } catch {
      setError("Couldn't update your date of birth. Try again.");
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return null;

  return (
    <form onSubmit={save} className="space-y-2">
      <label className="block text-sm font-medium text-text-secondary mb-1.5">
        Date of birth
      </label>
      <div className="flex items-center gap-3">
        <input
          type="date"
          value={dateOfBirth}
          onChange={(e) => setDateOfBirth(e.target.value)}
          max={new Date().toISOString().slice(0, 10)}
          className={cn(inputClass, "h-11 flex-1 [color-scheme:dark]")}
        />
        <Button type="submit" variant="secondary" disabled={saving || !dateOfBirth}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Update"}
        </Button>
        {saved && !saving && (
          <span className="flex items-center gap-1 text-sm text-gold-400 shrink-0">
            <Check className="h-4 w-4" />
          </span>
        )}
      </div>
      <p className="text-xs text-text-tertiary">
        Limited to a few changes per day. Used only to confirm you&apos;re 18 or older.
      </p>
      {error && <p className="text-sm text-danger">{error}</p>}
    </form>
  );
}
