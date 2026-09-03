/**
 * Shared loader for the site footer's support/contact email.
 *
 * Previously hardcoded as a `mailto:` link directly in
 * src/components/home/footer.tsx. Extracted here, following the same
 * shape as getLoginPortraits() (fetch by app_config key -> validate ->
 * fall back to a hardcoded constant if the row is missing or malformed),
 * so support can update the address from the app_config table without a
 * redeploy.
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

export const FALLBACK_CONTACT_EMAIL = 'vantrix@vantrix.ink';

// Confirmed live server invite (2026-09-02) — app_config.discord_invite_url
// (see 20261221_fix_discord_invite_url.sql) is the source of truth and can
// be rotated without a redeploy; this is just the fallback if that row is
// ever missing or fails validation.
export const FALLBACK_DISCORD_URL = 'https://discord.gg/py7JQNqqz';

// Conservative check, not full RFC 5322 — just enough to reject a corrupted
// or empty config value before it ends up in a mailto: href.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && EMAIL_PATTERN.test(value);
}

function isValidDiscordUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 300) return false;
  try {
    const u = new URL(value);
    return (u.hostname === 'discord.gg' || u.hostname === 'discord.com') && u.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function getDiscordUrl(): Promise<string> {
  try {
    const { data, error } = await supabaseAdmin
      .from('app_config')
      .select('value')
      .eq('key', 'discord_invite_url')
      .maybeSingle();

    if (error || !data?.value) {
      return FALLBACK_DISCORD_URL;
    }

    const value = data.value.trim();
    if (!isValidDiscordUrl(value)) {
      logger.warn('discord_invite_url config invalid, using fallback', { value: data.value });
      return FALLBACK_DISCORD_URL;
    }

    return value;
  } catch (err) {
    logger.error('Failed to load discord_invite_url config', { err: String(err) });
    return FALLBACK_DISCORD_URL;
  }
}

export async function getContactEmail(): Promise<string> {
  try {
    const { data, error } = await supabaseAdmin
      .from('app_config')
      .select('value')
      .eq('key', 'contact_email')
      .maybeSingle();

    if (error || !data?.value) {
      return FALLBACK_CONTACT_EMAIL;
    }

    const value = data.value.trim();
    if (!isValidEmail(value)) {
      logger.warn('contact_email config invalid, using fallback', { value: data.value });
      return FALLBACK_CONTACT_EMAIL;
    }

    return value;
  } catch (err) {
    logger.error('Failed to load contact_email config', { err: String(err) });
    return FALLBACK_CONTACT_EMAIL;
  }
}
