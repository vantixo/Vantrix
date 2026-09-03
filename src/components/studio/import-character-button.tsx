"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Counterpart to the Export button on the edit page (GET
 * /api/characters/:id/export). Reads the package client-side with
 * FileReader rather than a multipart upload — import/route.ts takes
 * plain JSON in the request body, not a file field.
 */
export function ImportCharacterButton() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setLoading(true);
    setError(null);
    try {
      const text = await file.text();
      const pkg = JSON.parse(text);
      const res = await fetch("/api/characters/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pkg),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(
          body.code === "FORBIDDEN"
            ? "Importing characters requires Premium."
            : body.error ?? "Couldn't import that file."
        );
        return;
      }
      router.push(`/studio/${body.character.id}`);
      router.refresh();
    } catch {
      setError("That file isn't a valid Vantrix character package.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        onChange={onFileSelected}
        className="hidden"
      />
      <Button variant="ghost" onClick={() => inputRef.current?.click()} disabled={loading}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        Import
      </Button>
      {error && <p className="text-xs text-danger mt-1">{error}</p>}
    </div>
  );
}
