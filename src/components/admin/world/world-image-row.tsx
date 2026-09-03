"use client";

import { useState } from "react";
import { Check, Loader2, Save } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { saveWorldImage } from "@/lib/frontend/admin-world-images";

const inputCls =
  "w-full h-10 px-3 rounded-sm bg-base border border-border-hairline text-sm text-text-primary placeholder:text-text-tertiary focus:border-gold-500/60 outline-none";

/**
 * One row per location/faction. Saves independently (not a single
 * page-wide submit like /admin/login-portraits) — there are 21+ locations
 * plus factions here, so batching every row into one save would mean a
 * typo in row 4 blocks rows 1-3 and 5-21 from persisting too.
 *
 * Plain <img> for the preview, not next/image — same reasoning as
 * LoginPortraitRow: this renders whatever the admin is actively typing,
 * which is expected to be invalid/incomplete mid-edit, and next/image
 * hard-crashes the render tree for an un-allowlisted host instead of just
 * showing a broken-image icon.
 */
export function WorldImageRow({
  type,
  id,
  name,
  subtitle,
  badge,
  imageUrl,
}: {
  type: "location" | "faction";
  id: string;
  name: string;
  subtitle: string;
  badge?: string;
  imageUrl: string | null;
}) {
  const [value, setValue] = useState(imageUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedJustNow, setSavedJustNow] = useState(false);

  const dirty = value !== (imageUrl ?? "");

  async function save() {
    setSaving(true);
    setError(null);
    setSavedJustNow(false);
    try {
      const saved = await saveWorldImage(type, id, value.trim());
      setValue(saved ?? "");
      setSavedJustNow(true);
      setTimeout(() => setSavedJustNow(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card interactive={false} className="p-3.5 flex items-center gap-3.5">
      <div className="relative h-14 w-24 rounded-xs overflow-hidden shrink-0 border border-border-hairline bg-white/5">
        {value.trim() && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value}
            alt=""
            className="h-full w-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.visibility = "hidden";
            }}
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-sm font-medium text-text-primary truncate">{name}</span>
          {badge && <Badge>{badge}</Badge>}
          <span className="text-xs text-text-tertiary truncate">{subtitle}</span>
        </div>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="/images/… or https://…"
          maxLength={500}
          className={inputCls}
        />
        {error && <p className="text-xs text-danger mt-1">{error}</p>}
      </div>
      <button
        type="button"
        onClick={save}
        disabled={saving || !dirty}
        aria-label="Save image"
        className="h-9 w-9 flex items-center justify-center rounded-xs text-text-tertiary hover:text-gold-400 hover:bg-gold-500/10 shrink-0 disabled:opacity-30 disabled:pointer-events-none"
      >
        {saving ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : savedJustNow ? (
          <Check className="h-4 w-4 text-gold-400" />
        ) : (
          <Save className="h-4 w-4" />
        )}
      </button>
    </Card>
  );
}
