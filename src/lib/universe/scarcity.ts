/**
 * Scarcity Engine — Vantrix Legacy Systems
 *
 * "Not everything is available. Scarcity creates value. Accessibility
 * destroys prestige."
 *
 * Manages finite assets — artifacts, titles, offices, historic properties,
 * relics, council seats. Each asset has at most one holder. Transfers are
 * logged permanently in the asset's own history array (nothing is forgotten),
 * and surface through the offline log / feed pipeline so users learn about
 * changes of hand the same way they learn about everything else in the world.
 */

import { supabaseAdmin }   from '@/lib/supabase/admin';
import { logger }          from '@/lib/logger';
import { narrate }         from './narrator';
import { logOfflineEntry } from './life-engine';
import type { ScarceAsset, AssetType, AssetRarity } from '@/types/legacy-systems';

// ── Read ───────────────────────────────────────────────────────────────────────

export async function getAllScarceAssets(): Promise<ScarceAsset[]> {
  const { data, error } = await supabaseAdmin
    .from('scarce_assets')
    .select(`
      *,
      holder:characters( id, name, image_url ),
      location:world_locations( id, name, slug )
    `)
    .order('rarity', { ascending: false });

  if (error) return [];
  return (data ?? []) as ScarceAsset[];
}

export async function getUnclaimedAssets(): Promise<ScarceAsset[]> {
  const { data, error } = await supabaseAdmin
    .from('scarce_assets')
    .select('*, location:world_locations( id, name, slug )')
    .is('holder_character_id', null);

  if (error) return [];
  return (data ?? []) as ScarceAsset[];
}

export async function getCharacterAssets(characterId: string): Promise<ScarceAsset[]> {
  const { data, error } = await supabaseAdmin
    .from('scarce_assets')
    .select('*, location:world_locations( id, name, slug )')
    .eq('holder_character_id', characterId);

  if (error) return [];
  return (data ?? []) as ScarceAsset[];
}

export async function getAsset(id: string): Promise<ScarceAsset | null> {
  const { data, error } = await supabaseAdmin
    .from('scarce_assets')
    .select(`*, holder:characters( id, name, image_url ), location:world_locations( id, name, slug )`)
    .eq('id', id)
    .single();

  if (error || !data) return null;
  return data as ScarceAsset;
}

// ── Write ──────────────────────────────────────────────────────────────────────

export async function createAsset(params: {
  name:        string;
  description: string;
  assetType:   AssetType;
  rarity:      AssetRarity;
  locationId?: string;
}): Promise<ScarceAsset | null> {
  const { data, error } = await supabaseAdmin
    .from('scarce_assets')
    .insert({
      name:         params.name,
      description:  params.description,
      asset_type:   params.assetType,
      rarity:       params.rarity,
      location_id:  params.locationId ?? null,
    })
    .select()
    .single();

  if (error) {
    logger.error('scarcity:create:error', { error });
    return null;
  }
  return data as ScarceAsset;
}

export async function transferAsset(
  assetId:        string,
  newHolderId:    string,
  reason:         string,
): Promise<boolean> {
  const asset = await getAsset(assetId);
  if (!asset) return false;

  const { data: newHolder } = await supabaseAdmin
    .from('characters').select('name').eq('id', newHolderId).single();
  const newHolderName = newHolder?.name ?? 'someone new';

  const previousHolderName = (asset.holder as { name?: string } | null)?.name;

  await supabaseAdmin.from('scarce_assets').update({
    holder_character_id: newHolderId,
    acquired_at:          new Date().toISOString(),
    history: [...asset.history, reason].slice(-30),
  }).eq('id', assetId);

  await logOfflineEntry(
    newHolderId,
    'discovery',
    narrate.assetClaimed(asset.name, newHolderName),
    { emotionalTone: 'momentous' },
  );

  if (asset.holder_character_id && previousHolderName) {
    await logOfflineEntry(
      asset.holder_character_id,
      'discovery',
      narrate.assetLost(asset.name, previousHolderName),
      { emotionalTone: 'significant' },
    );
  }

  logger.info('scarcity:transferred', { assetId, newHolderId, name: asset.name });
  return true;
}

export async function releaseAsset(assetId: string, reason: string): Promise<void> {
  const asset = await getAsset(assetId);
  if (!asset) return;

  await supabaseAdmin.from('scarce_assets').update({
    holder_character_id: null,
    history: [...asset.history, reason].slice(-30),
  }).eq('id', assetId);
}

// ── Tick: occasional claim opportunities ──────────────────────────────────────
// Unclaimed legendary/epic assets occasionally surface as claimable through
// high-status characters acting on opportunity — rare by design.

export async function tickScarcityAudit(): Promise<{ claims: number }> {
  const unclaimed = await getUnclaimedAssets();
  if (!unclaimed.length) return { claims: 0 };

  let claims = 0;

  for (const asset of unclaimed) {
    // Very low probability per tick — these should feel like genuine events
    const chance = asset.rarity === 'unique' ? 0.01 : asset.rarity === 'legendary' ? 0.02 : 0.04;
    if (Math.random() > chance) continue;

    // Find a high-status candidate located near the asset
    const { data: candidates } = await supabaseAdmin
      .from('social_status')
      .select('character_id, status_score')
      .gte('status_score', 700)
      .order('status_score', { ascending: false })
      .limit(10);

    if (!candidates?.length) continue;

    const winner = candidates[Math.floor(Math.random() * candidates.length)]!;

    await transferAsset(
      asset.id,
      winner.character_id,
      `Claimed after a period without a holder.`,
    );
    claims++;
  }

  return { claims };
}

// ── Prompt context ─────────────────────────────────────────────────────────────

export async function formatAssetsForPrompt(characterId: string): Promise<string> {
  const assets = await getCharacterAssets(characterId);
  if (!assets.length) return '';

  const lines = [`[WHAT YOU HOLD]`];
  for (const a of assets) {
    lines.push(`You hold ${a.name} — ${a.description.slice(0, 100)}`);
  }
  return lines.join(' ');
}
