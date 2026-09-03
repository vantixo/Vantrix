/**
 * ARCH-18 — Universe Scene Composition Never Bypasses the Image Router
 *
 * Regression test for the IMAGE-PROVIDER FIX (see scene-composer.ts's own
 * doc comment). composeUniverseScene() used to call generateBaseImage()
 * (lib/fal/lora-pipeline.ts) directly — the old, pre-REROUTE path straight
 * to Fal.ai with no HotAPI/Atlas fallback. Every universe_scenes row was
 * stuck in status: 'failed' as a result (Fal rejecting the request
 * outright, no fallback to fail over to), which is why Home's "Legendary
 * Scenes" row and every location's Scene Gallery were empty — see
 * getFeaturedUniverseScenes() in world-atlas.ts, which only returns
 * status: 'complete' rows.
 *
 * primary-image.ts's own REROUTE comment explicitly lists "batch scenes
 * without a trained LoRA yet" — exactly what scene-composer.ts generates —
 * as a path that must go through generatePrimaryImage() instead of hitting
 * Fal directly. This guards against that call site regressing back to the
 * direct-Fal path the same way arch-08 guards against a Pollinations.ai
 * regression.
 *
 * generateScene() (the LoRA identity-locked path, used for per-character
 * portraits) is intentionally exempt — see primary-image.ts's own doc
 * comment on why that one correctly still calls Fal directly.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SCENE_COMPOSER_PATH = join(__dirname, '..', 'lib', 'universe', 'scene-composer.ts');

describe('ARCH-18 — scene-composer.ts routes image generation through the primary image router', () => {
  const source = readFileSync(SCENE_COMPOSER_PATH, 'utf-8');

  it('imports generatePrimaryImage from lib/media/primary-image', () => {
    expect(source).toMatch(/import\s*{\s*generatePrimaryImage\s*}\s*from\s*["']@\/lib\/media\/primary-image["']/);
  });

  it('does not import generateBaseImage/generateScene from the direct Fal pipeline', () => {
    expect(source).not.toMatch(/from\s*["']@\/lib\/fal\/lora-pipeline["']/);
  });

  it('calls generatePrimaryImage(...), not generateBaseImage(...), to produce the scene image', () => {
    expect(source).toMatch(/await generatePrimaryImage\(/);
    expect(source).not.toMatch(/await generateBaseImage\(/);
  });
});
