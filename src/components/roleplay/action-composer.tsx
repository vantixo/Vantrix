"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { Send, Loader2, MessageCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilterPillGroup } from "@/components/ui/filter-pills";
import type { RoleplayActionType } from "@/types/roleplay";

export function ActionComposer({
  onSend,
  disabled,
  isSending,
}: {
  onSend: (actionType: "say" | "do", text: string) => void;
  disabled?: boolean;
  isSending?: boolean;
}) {
  const [mode, setMode] = useState<"say" | "do">("say");
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function autoGrow() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }

  function handleSend() {
    const trimmed = value.trim();
    if (!trimmed || disabled || isSending) return;
    onSend(mode, trimmed);
    setValue("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    // SAFE-AREA FIX: matches chat-composer.tsx's own fix — now that
    // (app)/layout.tsx hides BottomNav on this route, this bar's box
    // reaches the true viewport edge on mobile, so the home-indicator
    // inset has to live in here (pt-3 / pb-<safe-area> instead of a flat
    // py-3) rather than being incidentally covered by a bottom nav that
    // no longer renders underneath it.
    <div className="sticky bottom-0 border-t border-border-hairline bg-base/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
      {/*
        CHAT-PARITY PASS: this used to be two hand-rolled rounded-xs
        buttons with their own bespoke "bg-gold-500 text-[#160F02]"
        active state — a one-off copy of the exact active-pill treatment
        filter-pills.tsx already owns and documents as the single place
        that combination should be written ("every other single-select
        pill/toggle in the app should render through here"). Routing Say/
        Do through FilterPillGroup instead means it now looks and moves
        exactly like every other mode switch in the app, and stays in
        sync automatically if that active-state styling ever changes.
      */}
      <FilterPillGroup
        className="mb-2.5"
        options={[
          { value: "say", label: "Say", icon: <MessageCircle className="h-3 w-3" /> },
          { value: "do", label: "Do", icon: <Sparkles className="h-3 w-3" /> },
        ]}
        value={mode}
        onChange={(v) => setMode(v as "say" | "do")}
      />

      {/*
        CHAT-PARITY PASS: matches chat-composer.tsx's input row exactly
        (rounded-full pill instead of rounded-md, same px-4 py-2.5
        padding/border/focus treatment) so Story Mode's composer reads
        as the same premium surface as regular chat rather than a
        slightly-narrower bespoke bar living one route over.
      */}
      <div className="flex items-end gap-2 rounded-full border border-border-interactive bg-base px-4 py-2.5 focus-within:border-gold-500/60 transition-colors ease-premium">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            autoGrow();
          }}
          onKeyDown={handleKeyDown}
          rows={1}
          maxLength={800}
          disabled={disabled}
          placeholder={mode === "say" ? "What do you say?" : "What do you do?"}
          className="flex-1 resize-none bg-transparent text-[15px] text-text-primary placeholder:text-text-tertiary outline-none max-h-36 disabled:opacity-50"
        />
        <Button
          size="icon"
          onClick={handleSend}
          disabled={disabled || isSending || !value.trim()}
          aria-label="Send"
        >
          {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

export type { RoleplayActionType };
