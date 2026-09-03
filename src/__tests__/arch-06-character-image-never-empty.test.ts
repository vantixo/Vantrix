/**
 * ARCH-06 — Character Images Never Reach next/image With an Empty src
 *
 * Regression test for: characters.image_url is nullable in the database
 * (no NOT NULL constraint existed before the 20260624 migration) even
 * though the TypeScript Character type optimistically claims `string`.
 * next/image's <Image> component throws a hard render error ("Image is
 * missing required 'src' property") on a null/empty/undefined src — caught
 * by the nearest error.tsx boundary as a generic, undiagnosable "Page
 * error" with no detail surfaced to the user. This is exactly what was
 * reported: /chat/[id] crashing for a character with no image yet (e.g. a
 * freshly-created draft whose avatar generation hadn't finished).
 *
 * Two-layer fix:
 *   1. DB: 20260624_character_image_url_default.sql backfills existing
 *      NULL/empty rows and adds a NOT NULL + DEFAULT going forward.
 *   2. App: resolveImageSrc() in lib/utils.ts is defense-in-depth for any
 *      other nullable image field (joined conversation.character, ads,
 *      etc.) the DB fix doesn't cover, and for data from before any future
 *      migration runs.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { resolveImageSrc, CHARACTER_IMAGE_FALLBACK } from '../lib/utils';

describe('ARCH-06 — resolveImageSrc never returns an empty/null src', () => {
  it('returns the fallback for null, undefined, empty, and whitespace-only input', () => {
    expect(resolveImageSrc(null)).toBe(CHARACTER_IMAGE_FALLBACK);
    expect(resolveImageSrc(undefined)).toBe(CHARACTER_IMAGE_FALLBACK);
    expect(resolveImageSrc('')).toBe(CHARACTER_IMAGE_FALLBACK);
    expect(resolveImageSrc('   ')).toBe(CHARACTER_IMAGE_FALLBACK);
  });

  it('passes through a real URL from an allowed host unchanged', () => {
    // cdn.vantrix.ink is on the ALLOWED_IMAGE_HOSTS allowlist (see lib/utils.ts).
    // Arbitrary hosts are intentionally rejected — see the adjacent test below.
    expect(resolveImageSrc('https://cdn.vantrix.ink/real.jpg')).toBe('https://cdn.vantrix.ink/real.jpg');
  });

  it('falls back for a real-looking URL on a host that is not allow-listed', () => {
    // Defense-in-depth: resolveImageSrc must not let next/image fetch from
    // an arbitrary external host (SSRF/hotlink risk), even for well-formed URLs.
    expect(resolveImageSrc('https://example.com/real.jpg')).toBe(CHARACTER_IMAGE_FALLBACK);
  });

  it('the fallback itself is a non-empty path', () => {
    expect(CHARACTER_IMAGE_FALLBACK.length).toBeGreaterThan(0);
  });

  it('the fallback is NOT an SVG — next/image rejects SVG sources with a 400 ' +
     '("image type is not allowed") unless images.dangerouslyAllowSVG is set, ' +
     'which next.config.js deliberately does not set (it would apply to every ' +
     'image flowing through <Image> site-wide, including user/AI-generated ' +
     'character images — a real SVG/XSS surface to take on for a placeholder). ' +
     'Confirmed live: GET /_next/image?url=...character-placeholder.svg returned ' +
     '400 "url parameter is valid but image type is not allowed" before this fix.',
  () => {
    expect(CHARACTER_IMAGE_FALLBACK).not.toMatch(/\.svg$/i);
  });

  it('the fallback asset actually exists in public/', () => {
    const assetPath = join(__dirname, '..', '..', 'public', CHARACTER_IMAGE_FALLBACK.replace(/^\//, ''));
    expect(existsSync(assetPath)).toBe(true);
  });
});

describe('ARCH-06 — the directly-reported crash sites are wrapped', () => {
  function src(...parts: string[]): string {
    return readFileSync(join(__dirname, '..', ...parts), 'utf-8');
  }

  // FRONTEND_DIRECTIVE rebuild (2026-08-17): the chat surface is no longer
  // one monolithic chat-window.tsx that renders the character avatar
  // itself — it's split into chat-header.tsx (character avatar/name/status,
  // rendered once per page) and chat-window.tsx (message list + composer,
  // which never touches character.image_url at all). Checking chat-window.tsx
  // for a pattern that now lives in chat-header.tsx would just be checking
  // the wrong file; this asserts the real current crash site instead.
  it('chat-header.tsx never passes a character image to <Image> unwrapped', () => {
    const file = src('components', 'chat', 'chat-header.tsx');
    expect(file).not.toMatch(/<Image\s+src=\{characterImage\}/);
    expect(file).toMatch(/resolveImageSrc\(characterImage\)/);
  });

  // guest-chat-window.tsx (unauthenticated /api/chat/guest flow) hasn't
  // been rebuilt yet as part of this pass — §12's phased order covers the
  // authenticated chat loop first. Skipped rather than hard-failed so this
  // doesn't block on an out-of-scope file, and re-activates automatically
  // the moment that component exists.
  const guestChatWindowPath = join(__dirname, '..', 'components', 'chat', 'guest-chat-window.tsx');
  const guestChatWindowExists = existsSync(guestChatWindowPath);
  (guestChatWindowExists ? it : it.skip)(
    'guest-chat-window.tsx never passes character.image_url to <Image> unwrapped',
    () => {
      const file = src('components', 'chat', 'guest-chat-window.tsx');
      expect(file).not.toMatch(/<Image\s+src=\{character\.image_url\}/);
      expect(file).toMatch(/resolveImageSrc\(character\.image_url\)/);
    }
  );
});
