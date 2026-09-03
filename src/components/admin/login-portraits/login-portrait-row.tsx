"use client";

import { GripVertical, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { AdminLoginPortrait } from "@/lib/frontend/admin-login-portraits";

const inputCls =
  "w-full h-10 px-3 rounded-sm bg-base border border-border-hairline text-sm text-text-primary placeholder:text-text-tertiary focus:border-gold-500/60 outline-none";

/**
 * Deliberately a plain <img>, not next/image: this preview renders whatever
 * the admin is actively typing into the src field, keystroke by keystroke.
 * next/image hard-crashes the whole render tree for a host outside
 * next.config.js's images.remotePatterns (see this same concern documented
 * in loginPortraitSchema's comment in api/admin/route.ts) — acceptable for
 * the public login page, which only ever renders already-validated data,
 * but not here, where an in-progress edit is expected to be invalid at
 * times. A plain <img> just shows a broken-image icon instead of taking
 * down the editor.
 */
export function LoginPortraitRow({
  portrait,
  index,
  canRemove,
  onChange,
  onRemove,
}: {
  portrait: AdminLoginPortrait;
  index: number;
  canRemove: boolean;
  onChange: (index: number, next: AdminLoginPortrait) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <Card interactive={false} className="p-3.5 flex items-center gap-3.5">
      <GripVertical className="h-4 w-4 text-text-tertiary shrink-0" aria-hidden="true" />
      <div className="relative h-14 w-14 rounded-xs overflow-hidden shrink-0 border border-border-hairline bg-white/5">
        {portrait.src.trim() && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={portrait.src}
            alt=""
            className="h-full w-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.visibility = "hidden";
            }}
          />
        )}
      </div>
      <div className="min-w-0 flex-1 grid sm:grid-cols-2 gap-2.5">
        <input
          required
          value={portrait.src}
          onChange={(e) => onChange(index, { ...portrait, src: e.target.value })}
          placeholder="/images/characters/… or https://…"
          maxLength={500}
          className={inputCls}
        />
        <input
          value={portrait.alt}
          onChange={(e) => onChange(index, { ...portrait, alt: e.target.value })}
          placeholder="Alt text (optional)"
          maxLength={200}
          className={inputCls}
        />
      </div>
      <button
        type="button"
        onClick={() => onRemove(index)}
        disabled={!canRemove}
        aria-label="Remove portrait"
        className="h-7 w-7 flex items-center justify-center rounded-xs text-text-tertiary hover:text-danger hover:bg-danger/10 shrink-0 disabled:opacity-30 disabled:pointer-events-none"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </Card>
  );
}
