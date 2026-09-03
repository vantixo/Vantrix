"use client";

import { useState, useEffect } from "react";
import { Loader2, Plus, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RevealGroup, RevealItem } from "@/components/admin/motion/reveal";
import { LoginPortraitRow } from "@/components/admin/login-portraits/login-portrait-row";
import {
  fetchLoginPortraits,
  saveLoginPortraits,
  MIN_PORTRAITS,
  MAX_PORTRAITS,
  type AdminLoginPortrait,
} from "@/lib/frontend/admin-login-portraits";

/**
 * The backend for this page (app_config.login_portraits, the
 * loginPortraitsUpdateSchema validation, and this exact GET/POST resource
 * pair on /api/admin) has existed since 20261016_seed_login_portraits_config.sql
 * — this page is the missing consumer. See src/app/login/page.tsx and
 * src/lib/config/login-portraits.ts for the public-facing side that reads
 * what gets saved here.
 */
export default function AdminLoginPortraitsPage() {
  const [portraits, setPortraits] = useState<AdminLoginPortrait[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedJustNow, setSavedJustNow] = useState(false);

  useEffect(() => {
    fetchLoginPortraits()
      .then(({ portraits, updatedAt }) => {
        setPortraits(portraits);
        setUpdatedAt(updatedAt);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setIsLoading(false));
  }, []);

  function updateRow(index: number, next: AdminLoginPortrait) {
    setPortraits((prev) => prev.map((p, i) => (i === index ? next : p)));
  }

  function removeRow(index: number) {
    setPortraits((prev) => prev.filter((_, i) => i !== index));
  }

  function addRow() {
    setPortraits((prev) => [...prev, { src: "", alt: "" }]);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSavedJustNow(false);
    try {
      const saved = await saveLoginPortraits(portraits);
      setPortraits(saved);
      setUpdatedAt(new Date().toISOString());
      setSavedJustNow(true);
      setTimeout(() => setSavedJustNow(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save login portraits");
    } finally {
      setSaving(false);
    }
  }

  const hasEmptySrc = portraits.some((p) => !p.src.trim());
  const canSave = !saving && portraits.length >= MIN_PORTRAITS && !hasEmptySrc;

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-16">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl mb-1">Login Page</h2>
          <p className="text-text-secondary text-sm">
            The portrait collage shown on{" "}
            <a href="/login" target="_blank" rel="noreferrer" className="text-gold-400 hover:text-gold-300">
              /login
            </a>
            {" — "}first portrait doubles as the mobile backdrop.
            {updatedAt && (
              <> Last saved {new Date(updatedAt).toLocaleString()}.</>
            )}
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={save} disabled={!canSave}>
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          Save
        </Button>
      </div>

      {savedJustNow && (
        <p className="text-sm text-gold-400">Saved — live on /login now.</p>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}

      {isLoading ? (
        <p className="text-text-secondary text-sm">Loading…</p>
      ) : (
        <>
          <RevealGroup className="space-y-2.5">
            {portraits.map((portrait, i) => (
              <RevealItem key={i}>
                <LoginPortraitRow
                  portrait={portrait}
                  index={i}
                  canRemove={portraits.length > MIN_PORTRAITS}
                  onChange={updateRow}
                  onRemove={removeRow}
                />
              </RevealItem>
            ))}
          </RevealGroup>

          <Button
            variant="secondary"
            size="sm"
            onClick={addRow}
            disabled={portraits.length >= MAX_PORTRAITS}
          >
            <Plus className="h-3.5 w-3.5" /> Add portrait
          </Button>
          {portraits.length >= MAX_PORTRAITS && (
            <p className="text-xs text-text-tertiary">
              {MAX_PORTRAITS} is the max — only the first 4 render in the desktop grid, the rest are a buffer for future layouts.
            </p>
          )}
        </>
      )}
    </div>
  );
}
