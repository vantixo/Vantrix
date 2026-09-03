export interface AdminScenario {
  id: string;
  slug: string;
  title: string;
  genre: string;
  min_tier: string;
  location_slug: string | null;
  faction_slug: string | null;
  cover_image_url: string | null;
  sort_order: number;
}

export async function fetchScenarioImages(): Promise<AdminScenario[]> {
  const res = await fetch("/api/admin?resource=scenario_images");
  if (!res.ok) throw new Error("Failed to load scenario images");
  const data = await res.json();
  return data.scenarios ?? [];
}

export async function saveScenarioImage(id: string, imageUrl: string): Promise<string | null> {
  const res = await fetch("/api/admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "update_scenario_image", data: { id, image_url: imageUrl } }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error ?? "Could not save image");
  }
  return data.scenario?.cover_image_url ?? null;
}
