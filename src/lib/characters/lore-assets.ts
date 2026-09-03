// src/lib/characters/lore-assets.ts
// Archive of Echoes — asset storage helpers (Part III of the mythology
// expansion doc). Slots under the existing gallery_image_urls convention;
// no schema change required, just a consistent R2 key prefix so
// mythology-Wing assets don't collide with existing canon-character keys.
//
// STATUS: DORMANT — no production caller yet. The wider lore-canon system
// (lore-canon.ts) is live and actively used by chat/prompt/story-engine;
// these two functions are the storage half of the not-yet-shipped
// "Archive of Echoes" image-generation feature (Act scenes + Wing covers).
// Keep this file until that feature's generation call site (an admin route
// or content-engine job that produces sourceUrl images to pass in here)
// ships. If the mythology expansion is scrapped, delete this alongside
// loreSceneKey/loreWingCoverKey in lore-canon.ts.

import { uploadUrlToR2 } from '@/lib/storage/r2';
import { loreSceneKey, loreWingCoverKey } from '@/lib/characters/lore-canon';

export async function storeActSceneImage(
  slug: string,
  act: 1 | 2 | 3,
  sceneId: string,
  sourceUrl: string,
) {
  const key = loreSceneKey(slug, act, sceneId);
  return uploadUrlToR2(sourceUrl, key, 'image/jpeg');
}

export async function storeWingCoverImage(wingSlug: string, sourceUrl: string) {
  const key = loreWingCoverKey(wingSlug);
  return uploadUrlToR2(sourceUrl, key, 'image/jpeg');
}
