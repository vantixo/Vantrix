/**
 * detectPhotoRequest — pure client-safe trigger detection.
 *
 * CHAT-CRASH-FIX: this used to live only in in-chat-image.ts, which also
 * imports src/lib/logger.ts. logger.ts does `import { AsyncLocalStorage }
 * from 'async_hooks'` at module scope — a Node-only API. chat-window.tsx
 * ("use client") imported detectPhotoRequest from in-chat-image.ts, which
 * pulled logger.ts (and async_hooks) into the browser bundle. Webpack's
 * browser polyfill for async_hooks has no real AsyncLocalStorage
 * constructor, so evaluating that module in the browser threw
 * "TypeError: o.AsyncLocalStorage is not a constructor" — crashing the
 * entire chunk and taking down /chat/[id] with Next's generic "Page error"
 * boundary.
 *
 * detectPhotoRequest() itself is pure regex matching with zero server
 * dependencies, so it's extracted here with no imports at all. Server code
 * (in-chat-image.ts) re-exports it so every existing server-side import
 * site keeps working unchanged.
 */

const PHOTO_TRIGGERS = [
  /send\s+(me\s+)?(a\s+)?(photo|pic(ture)?|selfie|image|shot)/i,
  /can\s+i\s+see\s+(you|ur)/i,
  /show\s+me\s+(a\s+)?(photo|pic|yourself)/i,
  /take\s+(a\s+)?(pic|photo|selfie)/i,
  /got\s+any\s+(pic|photo)/i,
  /what\s+do\s+you\s+look\s+like/i,
  /sends?\s+(a\s+)?(photo|pic|selfie|image)/i,
  /\*.*?(pulls?\s+out|holds?\s+up).*?phone.*?\*/i,
];

export function detectPhotoRequest(message: string): boolean {
  return PHOTO_TRIGGERS.some(re => re.test(message));
}
