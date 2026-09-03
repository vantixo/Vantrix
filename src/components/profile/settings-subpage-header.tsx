import Link from "next/link";
import { ChevronLeft } from "lucide-react";

/** Shared header for every Settings sub-page (Notifications, Security, ...). */
export function SettingsSubpageHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2 mb-6">
      <Link
        href="/profile/settings"
        aria-label="Back to Settings"
        className="text-text-tertiary hover:text-text-primary -ml-1 p-1"
      >
        <ChevronLeft className="h-5 w-5" />
      </Link>
      <h1 className="font-display text-xl text-text-primary">{title}</h1>
    </div>
  );
}
