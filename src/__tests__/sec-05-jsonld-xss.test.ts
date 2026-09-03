/**
 * SEC-05 — JSON-LD Script-Breakout XSS Tests
 *
 * src/app/(main)/chat/[id]/page.tsx and src/app/(main)/premium/page.tsx embed
 * schema.org JSON-LD via dangerouslySetInnerHTML inside a
 * <script type="application/ld+json"> tag. The character schema includes
 * user/creator-supplied fields (name, description) — JSON.stringify alone
 * does NOT escape "<", so a description containing a literal "</script>"
 * could prematurely close the tag and inject arbitrary HTML/script into
 * the page.
 *
 * safeJsonLd() (src/lib/seo/structured.ts) must escape <, >, and & to their
 * \uXXXX form so the payload can never break out of the surrounding tag,
 * while still round-tripping to the exact original data through JSON.parse.
 */

import { describe, it, expect } from 'vitest';
import {
  safeJsonLd,
  generateCharacterSchema,
  generateFAQSchema,
} from '@/lib/seo/structured';

describe('SEC-05 — safeJsonLd script-breakout prevention', () => {
  it('escapes a literal </script> sequence so it cannot close the surrounding tag', () => {
    const payload = { description: 'Hi</script><script>alert(1)</script>' };
    const serialized = safeJsonLd(payload);

    expect(serialized).not.toContain('</script>');
    expect(serialized).not.toContain('<script>');
  });

  it('escapes bare < and > characters', () => {
    const serialized = safeJsonLd({ text: '<img src=x onerror=alert(1)>' });

    expect(serialized).not.toContain('<');
    expect(serialized).not.toContain('>');
  });

  it('escapes & to prevent HTML entity / comment trickery', () => {
    const serialized = safeJsonLd({ text: 'foo & bar' });

    expect(serialized).not.toMatch(/&(?!amp;|#x0026;|u0026)/);
  });

  it('round-trips back to the exact original data through JSON.parse', () => {
    const original = { description: 'Hi</script><script>alert(1)</script>', n: 42, ok: true };
    const serialized = safeJsonLd(original);

    expect(JSON.parse(serialized)).toEqual(original);
  });

  it('a malicious character name/description cannot break out via generateCharacterSchema', () => {
    const character = {
      name:        'Aria</script><script>document.location="https://evil.example"</script>',
      description: 'Friendly</script><img src=x onerror=alert(document.cookie)>',
      image_url:   'https://example.com/aria.png',
    };

    const serialized = safeJsonLd(generateCharacterSchema(character));

    expect(serialized).not.toContain('</script>');
    expect(serialized).not.toContain('<img');

    // And the data is still intact once parsed back out.
    const parsed = JSON.parse(serialized) as { name: string; description: string };
    expect(parsed.name).toContain('document.location');
    expect(parsed.description).toContain('onerror=alert');
  });

  it('FAQ schema (static today, but defense-in-depth) is also safe to embed', () => {
    const faqs = [{ question: 'Q</script>', answer: 'A<script>alert(1)</script>' }];
    const serialized = safeJsonLd(generateFAQSchema(faqs));

    expect(serialized).not.toContain('</script>');
  });
});
