"use client";

import { useState } from "react";
import { Download, Trash2, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

const CONFIRM_PHRASE = "delete my account";

/**
 * /api/user/export (POST) and /api/user/delete (DELETE) were both fully
 * built server-side with no frontend caller at all. This wires both into
 * Settings under a single "Privacy & data" section.
 */
export function DataPrivacyPanel() {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    try {
      const res = await fetch("/api/user/export", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setExportError(body.error ?? "Couldn't export your data.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `vantrix-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setExportError("Couldn't export your data. Try again.");
    } finally {
      setExporting(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch("/api/user/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmPhrase: confirmText }),
      });
      const body = await res.json();
      if (!res.ok || body.ok === false) {
        setDeleteError(
          body.error ?? "Deletion couldn't be completed. Please try again or contact support."
        );
        return;
      }
      setDeleted(true);
      setTimeout(() => {
        window.location.href = "/";
      }, 2500);
    } catch {
      setDeleteError("Deletion failed. Try again.");
    } finally {
      setDeleting(false);
    }
  }

  if (deleted) {
    return (
      <div className="py-3">
        <p className="text-sm text-text-primary">
          Your account has been deleted. Redirecting you now&hellip;
        </p>
      </div>
    );
  }

  return (
    <div className="py-3 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-text-primary">Export your data</p>
          <p className="text-xs text-text-tertiary mt-0.5">
            Download a copy of your profile, conversations, and memories.
          </p>
        </div>
        <Button onClick={handleExport} disabled={exporting} variant="secondary" size="sm" className="shrink-0">
          {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Export
        </Button>
      </div>
      {exportError && <p className="text-xs text-danger">{exportError}</p>}

      <div className="border-t border-border-hairline pt-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-text-primary">Delete account</p>
            <p className="text-xs text-text-tertiary mt-0.5">
              Permanently deletes your account and all associated data. This cannot be undone.
            </p>
          </div>
          {!confirming && (
            <Button
              onClick={() => setConfirming(true)}
              variant="destructive"
              size="sm"
              className="shrink-0"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          )}
        </div>

        {confirming && (
          <div className="mt-3 rounded-sm border border-danger/30 bg-danger/5 p-3 space-y-3">
            <p className="flex items-start gap-2 text-xs text-danger">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              Type &ldquo;{CONFIRM_PHRASE}&rdquo; to confirm. This is irreversible.
            </p>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={CONFIRM_PHRASE}
              className="w-full rounded-sm bg-base border border-interactive px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-gold-500/60"
            />
            {deleteError && <p className="text-xs text-danger">{deleteError}</p>}
            <div className="flex gap-2">
              <Button
                onClick={handleDelete}
                disabled={confirmText !== CONFIRM_PHRASE || deleting}
                variant="destructive"
                size="sm"
              >
                {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Permanently delete
              </Button>
              <Button
                onClick={() => {
                  setConfirming(false);
                  setConfirmText("");
                  setDeleteError(null);
                }}
                disabled={deleting}
                variant="ghost"
                size="sm"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
