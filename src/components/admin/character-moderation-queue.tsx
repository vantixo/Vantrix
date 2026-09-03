"use client";

import { useState } from "react";
import { RevealGroup } from "@/components/admin/motion/reveal";
import { CharacterModerationCard } from "@/components/admin/character-moderation-card";
import type { PendingCharacter } from "@/lib/frontend/admin-characters";

export function CharacterModerationQueue({
  initial,
}: {
  initial: PendingCharacter[];
}) {
  const [items, setItems] = useState(initial);

  if (items.length === 0) {
    return (
      <p className="text-text-tertiary text-sm py-12 text-center border border-border-hairline rounded-md">
        No characters awaiting review.
      </p>
    );
  }

  return (
    <RevealGroup className="space-y-3">
      {items.map((c) => (
        <CharacterModerationCard
          key={c.id}
          character={c}
          onResolved={(id) => setItems((prev) => prev.filter((i) => i.id !== id))}
        />
      ))}
    </RevealGroup>
  );
}
