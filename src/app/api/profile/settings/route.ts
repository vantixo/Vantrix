/**
 * PATCH /api/profile/settings
 * Update user-controlled profile settings.
 *
 * SETTINGS-FIX: Previously there was no way for users to update their
 * preferences (display_name, bio, nsfw_enabled, country). The DB schema
 * had these columns but no API route exposed them.
 *
 * Security:
 *   - Only whitelisted fields can be updated (no tier, tokens, role, etc.)
 *   - All text fields are length-capped and sanitized
 */
import { NextResponse }          from 'next/server';
import { getAuthedUser }         from '@/lib/auth/get-authed-user';
import { supabaseAdmin }         from '@/lib/supabase/admin';
import { isAllowedImageHost }    from '@/lib/utils';
import { z }                     from 'zod';

export const dynamic = 'force-dynamic';

const settingsSchema = z.object({
  // SAVE-FIX: display_name always arrives in the body (the panel sends
  // every field on every save, never just the touched one) — a hard
  // min(1) here used to fail the *entire* PATCH, rejecting unrelated
  // field changes too, the moment a user cleared this field mid-edit.
  display_name: z.string().max(50).optional(),
  bio:          z.string().max(300).optional(),
  // SAVE-FIX: same problem for username — min(3) rejected the whole
  // request whenever the field was blank/short while editing, or for any
  // account whose username was never set. Empty string is normalized to
  // "leave unchanged" below rather than validated as a real value.
  username:     z.union([
    z.literal(''),
    z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/, 'Username may only contain letters, numbers, and underscores'),
  ]).optional(),
  nsfw_enabled: z.boolean().optional(),
  country:      z.string().max(2).optional(),
  // GENDER RESTORED: product decision reversed — the field lives in
  // Profile Information again, driving the avatar's gender-aware
  // placeholder (see UserAvatar). Empty string means "no answer" and is
  // stored as-is (the column is nullable-ish in practice / accepts "").
  gender:       z.enum(['male', 'female', 'non_binary', 'prefer_not_to_say', '']).optional(),
  // Response language — see src/lib/ai/language-engine.ts. 'auto' (default)
  // follows what the user actually types; any other value pins the
  // character's replies to that language. Kept intentionally open to any
  // 2-letter code (not a fixed enum) so language-engine.ts's LANGUAGE_NAMES
  // map can grow without a matching change here.
  preferred_language: z.union([z.literal('auto'), z.string().regex(/^[a-z]{2}$/)]).optional(),
  // Skin Engine selection — see src/components/theme/skin-provider.tsx and
  // 20260817_theme_skin_accent.sql. Kept as a fixed enum (unlike
  // preferred_language's open-ended code) since both value sets are small,
  // closed, and defined entirely in vantrix-skins.ts / vantrix-accents.ts —
  // there's no equivalent of "just add a row to LANGUAGE_NAMES" here.
  theme_skin: z.enum(['obsidian-aether', 'velvet-rouge', 'midnight-sapphire', 'monochrome']).optional(),
  theme_accent: z.enum(['champagne', 'silver', 'rose', 'violet', 'emerald', 'sapphire', 'copper']).optional(),
  // AVATAR-FIX: avatar_url has always existed on `profiles` and been
  // readable via GET here, but was never writable — /api/upload returns
  // a public URL with nowhere for the client to actually save it. Same
  // shape as every other field here (whitelisted, capped), plus a host
  // check below since this one accepts an arbitrary string rather than a
  // closed enum: reuses isAllowedImageHost so "which hosts can serve an
  // avatar" stays defined in exactly one place (lib/utils.ts), same list
  // resolveImageSrc already trusts when rendering it back out.
  avatar_url: z.string().url().max(500).optional(),
});

export async function PATCH(req: Request) {
  const { user } = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const updates = parsed.data;

  // P0-AGE-GATE-FIX: this route previously let any authenticated user set
  // nsfw_enabled=true with no server-side age check at all — the profile
  // preference alone used to be treated as sufficient by several
  // discovery/dating surfaces (see resolveNsfwDiscoveryAccess() in
  // @/lib/access/character-gate). Enforcing the age requirement at the
  // point the preference is *set*, not only at the point it's *read*,
  // means there's no window where nsfw_enabled=true exists on an
  // unverified account.
  if (updates.nsfw_enabled === true) {
    const { data: isAgeVerified, error: ageVerifiedError } = await supabaseAdmin
      .rpc('is_user_age_verified', { p_user_id: user.id });

    if (ageVerifiedError || isAgeVerified !== true) {
      return NextResponse.json(
        { error: 'Age verification required before enabling mature content.', code: 'AGE_VERIFICATION_REQUIRED' },
        { status: 403 }
      );
    }
  }

  // SAVE-FIX: an empty-string username means "field was blank at save
  // time" (see settingsSchema comment above), not "set my username to
  // nothing" — drop it from the write so it's a no-op for that field
  // instead of clobbering the real username or failing uniqueness checks.
  if (updates.username === '') {
    delete updates.username;
  }

  // Reject avatar URLs from hosts we don't already trust for rendering —
  // otherwise a user could point their avatar at an arbitrary external
  // URL (tracking pixel, non-image content, etc.) rather than something
  // that actually went through /api/upload's validation pipeline.
  if (updates.avatar_url) {
    try {
      const hostname = new URL(updates.avatar_url).hostname;
      if (!isAllowedImageHost(hostname)) {
        return NextResponse.json({ error: 'Avatar must be an uploaded image.' }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: 'Invalid avatar URL.' }, { status: 400 });
    }
  }

  // Username uniqueness check
  if (updates.username) {
    const { data: existing } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('username', updates.username)
      .neq('id', user.id)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: 'Username already taken.' }, { status: 409 });
    }
  }

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', user.id)
    .select('id,username,display_name,bio,avatar_url,nsfw_enabled,country,gender,preferred_language,theme_skin,theme_accent')
    .single();

  if (error) {
    return NextResponse.json({ error: 'Update failed', details: error.message }, { status: 500 });
  }

  return NextResponse.json({ profile: data });
}

export async function GET() {
  const { supabase, user } = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id,username,display_name,bio,avatar_url,nsfw_enabled,country,gender,currency,tier,tokens,daily_messages_used,daily_messages_limit,created_at,preferred_language,theme_skin,theme_accent')
    .eq('id', user.id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  return NextResponse.json({ profile: data });
}
