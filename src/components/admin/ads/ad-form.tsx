"use client";

import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createAd, type AdRow } from "@/lib/frontend/admin-ads";

const POSITIONS = ["hero", "sidebar", "inline"] as const;
const AUDIENCES = ["all", "female", "male", "anime"] as const;

export function AdForm({ onCreated }: { onCreated: (ad: AdRow) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [link, setLink] = useState("");
  const [position, setPosition] = useState<(typeof POSITIONS)[number]>("inline");
  const [audience, setAudience] = useState<(typeof AUDIENCES)[number]>("all");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" /> New Ad
      </Button>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const ad = await createAd({ title, image_url: imageUrl, link, position, audience });
      onCreated(ad);
      setOpen(false);
      setTitle("");
      setImageUrl("");
      setLink("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create ad");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card interactive={false} className="p-5 mb-5">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            className={inputCls}
          />
          <input
            required
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="Link (e.g. /premium or https://…)"
            className={inputCls}
          />
        </div>
        <input
          required
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          placeholder="Image URL or /public asset path"
          className={inputCls}
        />
        <div className="grid sm:grid-cols-2 gap-3">
          <select
            value={position}
            onChange={(e) => setPosition(e.target.value as typeof position)}
            className={inputCls}
          >
            {POSITIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <select
            value={audience}
            onChange={(e) => setAudience(e.target.value as typeof audience)}
            className={inputCls}
          >
            {AUDIENCES.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" size="sm" disabled={submitting}>
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Create Ad
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

const inputCls =
  "w-full h-10 px-3 rounded-sm bg-base border border-border-hairline text-sm text-text-primary placeholder:text-text-tertiary focus:border-gold-500/60 outline-none";
