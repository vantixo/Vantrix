export interface AdRow {
  id: string;
  title: string;
  image_url: string;
  link: string;
  position: "hero" | "sidebar" | "inline";
  audience: "all" | "female" | "male" | "anime";
  active: boolean;
  impressions: number;
  clicks: number;
  created_at: string;
}

export async function fetchAds(): Promise<AdRow[]> {
  const res = await fetch("/api/admin?resource=ads");
  if (!res.ok) throw new Error("Failed to load ads");
  const data = await res.json();
  return data.ads ?? [];
}

export async function createAd(input: {
  title: string;
  image_url: string;
  link: string;
  position: "hero" | "sidebar" | "inline";
  audience?: "all" | "female" | "male" | "anime";
  active?: boolean;
}): Promise<AdRow> {
  const res = await fetch("/api/admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "create_ad", data: input }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Could not create ad");
  // The route's create_ad case only selects back id/title/position/active
  // (see admin/route.ts) — merge that with what we already know we sent
  // rather than asserting the partial response as a full AdRow.
  return {
    id: data.ad.id,
    title: data.ad.title,
    position: data.ad.position,
    active: data.ad.active,
    image_url: input.image_url,
    link: input.link,
    audience: input.audience ?? "all",
    impressions: 0,
    clicks: 0,
    created_at: new Date().toISOString(),
  };
}

export async function toggleAd(id: string, active: boolean): Promise<void> {
  const res = await fetch("/api/admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "toggle_ad", id, active }),
  });
  if (!res.ok) throw new Error("Failed to toggle ad");
}

export async function deleteAd(id: string): Promise<void> {
  const res = await fetch("/api/admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "delete_ad", id }),
  });
  if (!res.ok) throw new Error("Failed to delete ad");
}
