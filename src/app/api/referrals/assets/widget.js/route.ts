import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/referrals/assets/widget.js?code=PARTNERCODE&position=bottom-right&style=badge
 *
 * A single <script> tag a dev can drop into their site:
 *
 *   <script src="https://vantrix.ink/api/referrals/assets/widget.js?code=MIRA20" async></script>
 *
 * Injects a small, self-contained floating CTA (all styles inline, no
 * external CSS/font dependency, no iframe — so it can't be blocked by a
 * host site's CSP the way an iframe embed sometimes is) that links out
 * through /r/<code>. Two visual styles:
 *   style=badge  (default) — small circular Qlink-style pin, bottom corner
 *   style=banner            — slim bottom bar across the page width
 *
 * This is intentionally plain vanilla JS (no framework, no build step) so
 * it works unmodified on literally any site — static HTML, WordPress,
 * Shopify, whatever a partner's audience runs.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code') ?? '';
  const position = req.nextUrl.searchParams.get('position') ?? 'bottom-right';
  const style = req.nextUrl.searchParams.get('style') === 'banner' ? 'banner' : 'badge';

  if (!code) {
    return new NextResponse('console.error("[Vantrix widget] missing ?code= parameter");', {
      headers: { 'Content-Type': 'application/javascript' },
      status: 400,
    });
  }

  const safeCode = code.replace(/[^a-zA-Z0-9_-]/g, '');
  const posCss = position === 'bottom-left' ? 'left:16px;' : 'right:16px;';

  const js = `
(function () {
  var CODE = ${JSON.stringify(safeCode)};
  var LINK = "https://vantrix.ink/r/" + CODE;
  var STYLE = ${JSON.stringify(style)};

  if (document.getElementById('vtx-ref-widget')) return; // avoid double-injection

  var el = document.createElement('a');
  el.id = 'vtx-ref-widget';
  el.href = LINK;
  el.target = '_blank';
  el.rel = 'noopener sponsored';
  el.setAttribute('aria-label', 'Chat with an AI companion on Vantrix');

  if (STYLE === 'banner') {
    el.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:999999;' +
      'display:flex;align-items:center;justify-content:center;gap:10px;' +
      'padding:12px 16px;background:linear-gradient(90deg,#6B6B74,#3A3A40);' +
      'color:#fff;font-family:Arial,sans-serif;font-size:14px;font-weight:600;' +
      'text-decoration:none;box-shadow:0 -2px 12px rgba(0,0,0,.25);';
    el.innerHTML = 'Meet your AI companion on Vantrix <span style="color:#fbbf24;margin-left:4px;">Chat free →</span>';
  } else {
    el.style.cssText = 'position:fixed;bottom:16px;' + ${JSON.stringify(posCss)} + 'z-index:999999;' +
      'width:56px;height:56px;border-radius:50%;' +
      'background:linear-gradient(135deg,#6B6B74,#3A3A40);' +
      'display:flex;align-items:center;justify-content:center;' +
      'color:#fff;font-family:Arial,sans-serif;font-weight:700;font-size:20px;' +
      'text-decoration:none;box-shadow:0 4px 16px rgba(0,0,0,.3);' +
      'border:2px solid #fbbf24;transition:transform .15s ease;';
    el.textContent = 'V';
    el.onmouseenter = function () { el.style.transform = 'scale(1.08)'; };
    el.onmouseleave = function () { el.style.transform = 'scale(1)'; };
  }

  function mount() { document.body.appendChild(el); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
`.trim();

  return new NextResponse(js, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=3600',
    },
  });
}
