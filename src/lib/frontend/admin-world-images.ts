export interface AdminWorldLocation {
  id: string;
  name: string;
  slug: string;
  archetype: string;
  is_capital: boolean;
  image_url: string | null;
}

export interface AdminWorldFaction {
  id: string;
  name: string;
  slug: string;
  is_ruling: boolean;
  image_url: string | null;
}

export async function fetchWorldImages(): Promise<{
  locations: AdminWorldLocation[];
  factions: AdminWorldFaction[];
}> {
  const res = await fetch("/api/admin?resource=world_images");
  if (!res.ok) throw new Error("Failed to load world images");
  const data = await res.json();
  return { locations: data.locations ?? [], factions: data.factions ?? [] };
}

export async function saveWorldImage(
  type: "location" | "faction",
  id: string,
  imageUrl: string,
): Promise<string | null> {
  const res = await fetch("/api/admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "update_world_image", data: { type, id, image_url: imageUrl } }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error ?? "Could not save image");
  }
  const row = type === "location" ? data.location : data.faction;
  return row?.image_url ?? null;
}
