export interface AdminLoginPortrait {
  src: string;
  alt: string;
}

export async function fetchLoginPortraits(): Promise<{
  portraits: AdminLoginPortrait[];
  updatedAt: string | null;
}> {
  const res = await fetch("/api/admin?resource=login_portraits");
  if (!res.ok) throw new Error("Failed to load login portraits");
  const data = await res.json();
  return { portraits: data.portraits ?? [], updatedAt: data.updated_at ?? null };
}

// Mirrors loginPortraitsUpdateSchema in api/admin/route.ts (1-6 entries) —
// kept here as a plain constant rather than importing zod client-side just
// to read two numbers.
export const MIN_PORTRAITS = 1;
export const MAX_PORTRAITS = 6;

export async function saveLoginPortraits(
  portraits: AdminLoginPortrait[]
): Promise<AdminLoginPortrait[]> {
  const res = await fetch("/api/admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "update_login_portraits", data: portraits }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error ?? "Could not save login portraits");
  }
  return data.portraits ?? portraits;
}
