/**
 * referral-assets.ts
 *
 * Generates the actual pixel/vector content for partner marketing assets —
 * banners, circular "Qlink" badges — server-side as SVG. SVG keeps this
 * dependency-free (no canvas/sharp needed) and crisp at any size, and every
 * asset bakes the partner's code into the click-through URL so no dev
 * integration step can accidentally drop attribution.
 */

export const BANNER_SIZES = {
  '300x250': { w: 300, h: 250, label: 'Medium Rectangle' },
  '728x90':  { w: 728, h: 90,  label: 'Leaderboard' },
  '160x600': { w: 160, h: 600, label: 'Wide Skyscraper' },
  '320x50':  { w: 320, h: 50,  label: 'Mobile Banner' },
  '336x280': { w: 336, h: 280, label: 'Large Rectangle' },
} as const;

export type BannerSize = keyof typeof BANNER_SIZES;

const BRAND = {
  bg1: '#6B6B74',   // gray
  bg2: '#3A3A40',   // dark gray
  text: '#ffffff',
  accent: '#fbbf24', // amber CTA
};

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] as string));
}

/**
 * Renders a promotional banner at one of the standard IAB sizes. Layout
 * scales by aspect ratio bucket rather than a formula per exact size, so
 * new sizes can be added to BANNER_SIZES without new layout code.
 */
export function renderBanner(size: BannerSize, opts: { headline?: string; cta?: string } = {}): string {
  const { w, h } = BANNER_SIZES[size];
  const headline = escapeXml(opts.headline ?? 'Meet your AI companion');
  const cta = escapeXml(opts.cta ?? 'Chat free →');
  const isWide = w / h > 2;       // leaderboard / mobile banner
  const isTall = h / w > 1.5;     // skyscraper

  const fontSize = isTall ? 22 : isWide ? 20 : 26;
  const ctaFontSize = Math.max(12, fontSize * 0.55);

  let headlineY: number, ctaY: number, textAnchor: string, textX: number;
  if (isTall) {
    textAnchor = 'middle'; textX = w / 2;
    headlineY = h * 0.42; ctaY = h * 0.62;
  } else {
    textAnchor = 'start'; textX = w * 0.06;
    headlineY = h * 0.42; ctaY = h * 0.72;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${BRAND.bg1}"/>
      <stop offset="100%" stop-color="${BRAND.bg2}"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/>
  <text x="${textX}" y="${headlineY}" font-family="Arial, sans-serif" font-weight="700" font-size="${fontSize}" fill="${BRAND.text}" text-anchor="${textAnchor}">${headline}</text>
  <text x="${textX}" y="${ctaY}" font-family="Arial, sans-serif" font-weight="600" font-size="${ctaFontSize}" fill="${BRAND.accent}" text-anchor="${textAnchor}">${cta}</text>
  <text x="${w - 8}" y="${h - 8}" font-family="Arial, sans-serif" font-size="10" fill="${BRAND.text}" fill-opacity="0.5" text-anchor="end">vantrix.ink</text>
</svg>`;
}

/**
 * Renders a circular "Qlink" badge — a small round profile-style asset
 * (think "verified partner" pin) meant to sit in a sidebar, footer, or
 * next to a dev's bio, linking out through their referral code. Named
 * "Qlink" per the request — a quick-link circular badge, distinct from
 * the rectangular banners above.
 */
export function renderQlinkBadge(opts: { label?: string; diameter?: number } = {}): string {
  const d = opts.diameter ?? 120;
  const r = d / 2;
  const label = escapeXml(opts.label ?? 'Vantrix Partner');
  const fontSize = Math.max(9, d * 0.09);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${d}" height="${d}" viewBox="0 0 ${d} ${d}">
  <defs>
    <linearGradient id="qg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${BRAND.bg1}"/>
      <stop offset="100%" stop-color="${BRAND.bg2}"/>
    </linearGradient>
  </defs>
  <circle cx="${r}" cy="${r}" r="${r - 2}" fill="url(#qg)" stroke="${BRAND.accent}" stroke-width="2"/>
  <text x="${r}" y="${r - fontSize * 0.2}" font-family="Arial, sans-serif" font-weight="700" font-size="${fontSize * 1.6}" fill="${BRAND.text}" text-anchor="middle">V</text>
  <text x="${r}" y="${r + fontSize * 1.4}" font-family="Arial, sans-serif" font-weight="600" font-size="${fontSize}" fill="${BRAND.text}" text-anchor="middle">${label}</text>
</svg>`;
}
