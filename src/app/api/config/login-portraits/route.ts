/**
 * GET /api/config/login-portraits
 *
 * Public, unauthenticated read of the /login page's portrait collage.
 * Backed by app_config (key: 'login_portraits') so admins can change which
 * character images appear there without a code deploy — see
 * /admin/login-portraits and its API actions in /api/admin/route.ts.
 *
 * The login page itself now reads getLoginPortraits() directly (server
 * component, no HTTP round trip — see src/lib/config/login-portraits.ts's
 * header for why) — this route stays as the public read for any
 * client-side consumer, kept in sync with the page by sharing the same
 * loader/validation instead of duplicating it.
 *
 * Falls back to the original hardcoded set if the config row is missing,
 * empty, or malformed, so a bad admin edit can never blank the login page.
 */
import { NextResponse } from 'next/server';
import { getLoginPortraits } from '@/lib/config/login-portraits';

export const dynamic = 'force-dynamic';

export async function GET() {
  const portraits = await getLoginPortraits();
  return NextResponse.json({ portraits });
}
