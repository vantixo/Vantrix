import { describe, it, expect } from 'vitest';
import { renderBanner, renderQlinkBadge, BANNER_SIZES } from '../referral-assets';

describe('renderBanner', () => {
  it('produces valid SVG with the correct declared dimensions for every size', () => {
    for (const size of Object.keys(BANNER_SIZES) as (keyof typeof BANNER_SIZES)[]) {
      const { w, h } = BANNER_SIZES[size];
      const svg = renderBanner(size);
      expect(svg).toContain('<svg');
      expect(svg).toContain(`width="${w}"`);
      expect(svg).toContain(`height="${h}"`);
      expect(svg.trim().endsWith('</svg>')).toBe(true);
    }
  });

  it('escapes XML-unsafe characters in custom headline/CTA text', () => {
    const svg = renderBanner('300x250', { headline: 'A & B <script>', cta: '"quoted"' });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&amp;');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('&quot;quoted&quot;');
  });

  it('uses default copy when none is provided', () => {
    const svg = renderBanner('728x90');
    expect(svg).toContain('Meet your AI companion');
  });
});

describe('renderQlinkBadge', () => {
  it('produces a circular badge sized to the requested diameter', () => {
    const svg = renderQlinkBadge({ diameter: 200 });
    expect(svg).toContain('width="200"');
    expect(svg).toContain('height="200"');
    expect(svg).toContain('<circle');
  });

  it('defaults to a 120px diameter when none is given', () => {
    const svg = renderQlinkBadge();
    expect(svg).toContain('width="120"');
  });

  it('escapes a custom label', () => {
    const svg = renderQlinkBadge({ label: '<b>Top</b>' });
    expect(svg).not.toContain('<b>Top</b>');
    expect(svg).toContain('&lt;b&gt;Top&lt;/b&gt;');
  });
});
