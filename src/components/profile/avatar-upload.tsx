"use client";

import { useEffect, useRef, useState } from "react";
import { SafeImage as Image } from "@/components/ui/safe-image";
import { useRouter } from "next/navigation";
import { Camera, Loader2 } from "lucide-react";
import { resolveImageSrc, cn } from "@/lib/utils";

/**
 * PROFILE GAP FIX — /api/upload has existed since the backend-only pass
 * (see FRONTEND_DIRECTIVE §13: it's an existing route, not new backend
 * work) but had zero frontend consumers, and avatar_url wasn't even
 * writable via /api/profile/settings until this change (see that route's
 * own comment). This closes both ends: pick a file → validate client-side
 * (mirrors the server's own checks in api/upload/route.ts so bad files
 * fail fast instead of round-tripping) → upload → save the returned URL.
 *
 * Lives on /profile/settings next to the rest of SettingsForm's fields,
 * but is its own component rather than folded into that form: upload is
 * a distinct two-step async flow (POST file, then PATCH the URL) with
 * its own loading/error states, and account-menu.tsx / the top bar read
 * avatarUrl from the server-rendered shell session, so a successful
 * upload has to router.refresh() the way SettingsForm's save already
 * does — same pattern, separate concern.
 */
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

export function AvatarUpload({
  currentUrl,
  displayName,
}: {
  currentUrl: string | null;
  displayName: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initials = displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";

  // Once a save succeeds, router.refresh() eventually re-renders this
  // component with the new `currentUrl` prop pointing at the permanent
  // uploaded URL. Only *then* is it safe to drop the local blob preview —
  // revoking it any earlier (e.g. in the upload handler's own finally
  // block) would race the refresh and flash a broken image between "blob
  // revoked" and "server data arrived."
  useEffect(() => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    // Only re-run when the server-confirmed URL changes, not on every
    // previewUrl update (this effect is what clears previewUrl).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUrl]);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow picking the same file again after an error
    if (!file) return;

    setError(null);

    if (!ALLOWED_TYPES.has(file.type)) {
      setError("Use a JPEG, PNG, WebP, or GIF image.");
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      setError("Image must be under 5MB.");
      return;
    }

    const localPreview = URL.createObjectURL(file);
    setPreviewUrl(localPreview);
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
      const uploadBody = await uploadRes.json();
      if (!uploadRes.ok || !uploadBody.url) {
        setError(uploadBody.error ?? "Couldn't upload image.");
        return;
      }

      const saveRes = await fetch("/api/profile/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatar_url: uploadBody.url }),
      });
      const saveBody = await saveRes.json();
      if (!saveRes.ok) {
        setError(saveBody.error ?? "Uploaded, but couldn't save it to your profile.");
        return;
      }

      router.refresh();
    } catch {
      setError("Couldn't upload image. Try again.");
    } finally {
      setUploading(false);
    }
  }

  const shownUrl = previewUrl ?? resolveImageSrc(currentUrl);

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="group relative h-16 w-16 shrink-0 rounded-full overflow-hidden border border-border-hairline disabled:pointer-events-none"
        aria-label="Change avatar"
      >
        {currentUrl || previewUrl ? (
          <Image
            src={shownUrl}
            alt=""
            fill
            sizes="64px"
            className="object-cover"
            // The local preview is a blob: URL, valid only in this tab —
            // Next's default loader tries to fetch it server-side via
            // /_next/image and would 400. Skip optimization for that case
            // only; the real, already-uploaded avatar_url still goes
            // through the normal optimized path.
            unoptimized={Boolean(previewUrl)}
          />
        ) : (
          <span className="h-full w-full flex items-center justify-center bg-white/5 text-lg font-semibold text-gold-400">
            {initials}
          </span>
        )}
        <span
          className={cn(
            "absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity ease-premium",
            uploading && "opacity-100"
          )}
        >
          {uploading ? (
            <Loader2 className="h-5 w-5 text-white animate-spin" />
          ) : (
            <Camera className="h-5 w-5 text-white" />
          )}
        </span>
      </button>

      <div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="text-sm text-gold-400 hover:text-gold-300 font-semibold disabled:opacity-40"
        >
          {uploading ? "Uploading…" : "Change photo"}
        </button>
        <p className="text-xs text-text-tertiary mt-0.5">JPEG, PNG, WebP, or GIF. Up to 5MB.</p>
        {error && <p className="text-xs text-danger mt-1">{error}</p>}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={handleFile}
        className="hidden"
      />
    </div>
  );
}
