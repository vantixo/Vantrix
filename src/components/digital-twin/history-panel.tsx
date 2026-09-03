"use client";

import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { timeAgo } from "@/lib/utils";
import { useDigitalTwinHistory } from "@/hooks/use-digital-twin";

export function HistoryPanel() {
  const { data: entries, isLoading, deleteEntry, clearAll } = useDigitalTwinHistory();

  if (isLoading || entries === null) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" />
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <p className="text-sm text-text-tertiary py-12 text-center">
        No generated replies yet — try the Chat tab.
      </p>
    );
  }

  return (
    <div>
      <div className="flex justify-end mb-3">
        <Button variant="ghost" size="sm" onClick={clearAll}>
          Clear all
        </Button>
      </div>
      <div className="flex flex-col gap-2.5">
        {entries.map((e) => (
          <Card key={e.id} interactive={false} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-text-tertiary mb-1">To: {e.prompt}</p>
                <p className="text-sm text-text-primary whitespace-pre-wrap">{e.reply}</p>
                <p className="text-[11px] text-text-tertiary mt-2">{timeAgo(e.createdAt)}</p>
              </div>
              <button
                onClick={() => deleteEntry(e.id)}
                className="shrink-0 text-text-tertiary hover:text-danger"
                aria-label="Delete"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
