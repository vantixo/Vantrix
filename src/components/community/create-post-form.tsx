"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const TAGS = [
  { value: "discussion", label: "Discussion" },
  { value: "question", label: "Question" },
  { value: "theory", label: "Theory" },
  { value: "tips", label: "Tips" },
  { value: "fan-art", label: "Fan Art" },
  { value: "lore", label: "Lore" },
  { value: "milestone", label: "Milestone" },
];

const inputClass =
  "w-full rounded-sm bg-base border border-interactive px-4 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-gold-500/60";

export function CreatePostForm({
  communitySlug,
  onCreated,
  onCancel,
}: {
  communitySlug: string;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tag, setTag] = useState("discussion");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/community/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ communitySlug, title, body, tag }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 429 && data.retryAt) {
          setError(`Too many posts recently. Try again after ${new Date(data.retryAt).toLocaleTimeString()}.`);
        } else {
          setError(data.error ?? "Couldn't create post.");
        }
        return;
      }
      setTitle("");
      setBody("");
      setTag("discussion");
      onCreated();
    } catch {
      setError("Couldn't create post. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card interactive={false} className="p-4 mb-4">
      <form onSubmit={submit} className="space-y-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          placeholder="Title"
          className={cn(inputClass, "h-11")}
          autoFocus
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={10_000}
          rows={4}
          placeholder="What's on your mind?"
          className={cn(inputClass, "py-2.5 resize-none")}
        />
        <select
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          className={cn(inputClass, "h-11 w-auto")}
        >
          {TAGS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={submitting || !title.trim() || !body.trim()}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Post"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
