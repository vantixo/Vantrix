/**
 * SEC-13 — Privileged RPC Authorization Regression Suite
 *
 * P0 gap (audit item #1/#3): a set of SECURITY DEFINER Postgres functions
 * were GRANTed EXECUTE to `authenticated`, and every one of them accepts a
 * caller-controlled id (user_id / match_id / session_id) with no auth.uid()
 * check inside the function body. Any logged-in browser client could call
 * them directly over PostgREST, completely bypassing the Next.js API
 * route auth checks, e.g.:
 *
 *   supabase.rpc('deduct_tokens', { user_id: '<victim>', amount: 999999 })
 *
 * Migration 20260930b_lock_privileged_rpcs.sql revokes EXECUTE from
 * anon/authenticated on all of these and leaves them service_role-only.
 * This suite is the regression test the audit asked for: it runs against
 * a real (test/staging) Supabase project, creates two ephemeral users,
 * and asserts that EVERY privileged RPC is unreachable from an
 * authenticated browser-style client — whether the target id belongs to
 * the caller or to another user. (They must be unreachable in both
 * cases: the intended architecture is "server-only via supabaseAdmin",
 * not "self-service allowed".)
 *
 * This is an INTEGRATION test, not a unit test — it needs real network
 * access to a Postgres/PostgREST instance and will not run against mocks.
 * It is gated behind env vars so `npm test` stays fast and offline by
 * default; wire it into CI as a separate `test:integration` step against
 * a disposable Supabase branch/project (see Supabase:create_branch).
 *
 * Required env:
 *   SUPABASE_TEST_URL              - project URL (staging/branch, NEVER prod)
 *   SUPABASE_TEST_ANON_KEY         - anon/publishable key
 *   SUPABASE_TEST_SERVICE_ROLE_KEY - service role key, used only to
 *                                    provision/clean up the two test users
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL       = process.env.SUPABASE_TEST_URL;
const ANON_KEY  = process.env.SUPABASE_TEST_ANON_KEY;
const SR_KEY    = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;

const hasEnv = Boolean(URL && ANON_KEY && SR_KEY);

// Postgres error code for "insufficient_privilege" (what a REVOKEd EXECUTE
// surfaces as through PostgREST) — 42501. PostgREST wraps it as a 401/403
// with this code in most configurations; some deployments instead return a
// generic PGRST-prefixed error. Accept either so the test isn't brittle
// against PostgREST version differences, but a *successful* call (data
// returned, no error) is always a hard failure.
function isAuthorizationDenial(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? '';
  const msg  = (error.message ?? '').toLowerCase();
  return (
    code === '42501' ||
    code.startsWith('PGRST') ||
    msg.includes('permission denied') ||
    msg.includes('insufficient_privilege') ||
    msg.includes('not find the function') // PostgREST hides revoked fns from schema cache in some configs
  );
}

describe.skipIf(!hasEnv)('SEC-13 — privileged RPCs reject direct client calls', () => {
  let admin: SupabaseClient;
  let userAClient: SupabaseClient;
  let userA: { id: string; email: string };
  let userB: { id: string; email: string };
  let matchId: string;
  let sessionId: string;

  beforeAll(async () => {
    admin = createClient(URL!, SR_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

    const mkUser = async (tag: string) => {
      const email = `sec13-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: 'Sec13-Test-Password-1!',
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`failed to provision test user: ${error?.message}`);
      await admin.from('profiles').upsert({ id: data.user.id, tokens: 1000 });
      return { id: data.user.id, email };
    };

    userA = await mkUser('a');
    userB = await mkUser('b');

    // A dating match + date session owned by userB, so we can test that
    // userA cannot manipulate userB's match/session via the RPCs either.
    const { data: character } = await admin.from('characters').select('id').limit(1).single();
    const { data: match } = await admin
      .from('dating_matches')
      .insert({ user_id: userB.id, character_id: character!.id })
      .select('id')
      .single();
    matchId = match!.id;

    const { data: session } = await admin
      .from('date_sessions')
      .insert({
        match_id: matchId,
        user_id: userB.id,
        character_id: character!.id,
        date_type: 'cafe',
        status: 'active',
        opening_scene: 'test',
        token_cost: 0,
        bond_bonus: 0,
      })
      .select('id')
      .single();
    sessionId = session!.id;

    userAClient = createClient(URL!, ANON_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error: signInErr } = await userAClient.auth.signInWithPassword({
      email: userA.email,
      password: 'Sec13-Test-Password-1!',
    });
    if (signInErr) throw new Error(`failed to sign in test user A: ${signInErr.message}`);
  });

  afterAll(async () => {
    if (!hasEnv) return;
    await admin.from('date_sessions').delete().eq('match_id', matchId);
    await admin.from('dating_matches').delete().eq('id', matchId);
    await admin.auth.admin.deleteUser(userA.id);
    await admin.auth.admin.deleteUser(userB.id);
  });

  it('deduct_tokens: cannot debit another user, and cannot even debit self', async () => {
    const { error: crossUser } = await userAClient.rpc('deduct_tokens', { user_id: userB.id, amount: 1 });
    expect(isAuthorizationDenial(crossUser)).toBe(true);

    const { error: selfCall } = await userAClient.rpc('deduct_tokens', { user_id: userA.id, amount: 1 });
    expect(isAuthorizationDenial(selfCall)).toBe(true);
  });

  it('increment_xp: cannot grant/manipulate XP for another user', async () => {
    const { error } = await userAClient.rpc('increment_xp', {
      p_user_id: userB.id, p_amount: 999999, p_source: 'sec13_probe',
    });
    expect(isAuthorizationDenial(error)).toBe(true);
  });

  it('update_psychology: cannot manipulate another user\'s character psychology', async () => {
    const { error } = await userAClient.rpc('update_psychology', {
      p_user_id: userB.id, p_character_id: '00000000-0000-0000-0000-000000000000', p_event: 'compliment',
    });
    expect(isAuthorizationDenial(error)).toBe(true);
  });

  it('apply_personality_drift: cannot manipulate another user\'s drift state', async () => {
    const { error } = await userAClient.rpc('apply_personality_drift', {
      p_user_id: userB.id, p_character_id: '00000000-0000-0000-0000-000000000000',
      p_openness: 50, p_warmth: 50, p_confidence: 50,
    });
    expect(isAuthorizationDenial(error)).toBe(true);
  });

  it('check_and_update_streak: cannot manipulate another user\'s streak', async () => {
    const { error } = await userAClient.rpc('check_and_update_streak', { p_user_id: userB.id });
    expect(isAuthorizationDenial(error)).toBe(true);
  });

  it('increment_daily_messages: cannot inflate/reset another user\'s message count', async () => {
    const { error } = await userAClient.rpc('increment_daily_messages', { p_user_id: userB.id });
    expect(isAuthorizationDenial(error)).toBe(true);
  });

  it('get_or_create_daily_quests / progress_daily_quest: cannot touch another user\'s quests', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { error: e1 } = await userAClient.rpc('get_or_create_daily_quests', {
      p_user_id: userB.id, p_date: today, p_default_quests: [],
    });
    expect(isAuthorizationDenial(e1)).toBe(true);

    const { error: e2 } = await userAClient.rpc('progress_daily_quest', {
      p_user_id: userB.id, p_date: today, p_quest_type: 'chat', p_amount: 1,
    });
    expect(isAuthorizationDenial(e2)).toBe(true);
  });

  it('consume_streak_shield: cannot consume another user\'s shield', async () => {
    const { error } = await userAClient.rpc('consume_streak_shield', { p_user_id: userB.id });
    expect(isAuthorizationDenial(error)).toBe(true);
  });

  it('update_bond_score / update_dating_streak: cannot inflate bond on another user\'s match', async () => {
    const { error: e1 } = await userAClient.rpc('update_bond_score', { p_match_id: matchId, p_delta: 100 });
    expect(isAuthorizationDenial(e1)).toBe(true);

    const { error: e2 } = await userAClient.rpc('update_dating_streak', { p_match_id: matchId });
    expect(isAuthorizationDenial(e2)).toBe(true);
  });

  it('send_gift: cannot send a "gift" against another user\'s match/tokens for free bond', async () => {
    const { error } = await userAClient.rpc('send_gift', {
      p_user_id: userB.id, p_match_id: matchId, p_char_id: '00000000-0000-0000-0000-000000000000',
      p_gift_type: 'rose', p_gift_name: 'Rose', p_bond_bonus: 100, p_token_cost: 0, p_message: null,
    });
    expect(isAuthorizationDenial(error)).toBe(true);
  });

  it('start_date_session / complete_date_session: cannot start or force-complete another user\'s date', async () => {
    const { error: e1 } = await userAClient.rpc('start_date_session', {
      p_user_id: userB.id, p_match_id: matchId, p_char_id: '00000000-0000-0000-0000-000000000000',
      p_date_type: 'cafe', p_opening_scene: 'x', p_token_cost: 0, p_bond_bonus: 0,
    });
    expect(isAuthorizationDenial(e1)).toBe(true);

    const { error: e2 } = await userAClient.rpc('complete_date_session', {
      p_session_id: sessionId, p_user_id: userB.id,
    });
    expect(isAuthorizationDenial(e2)).toBe(true);
  });

  it('mark_all_notifications_read: cannot mark another user\'s notifications read', async () => {
    const { error } = await userAClient.rpc('mark_all_notifications_read', { p_user_id: userB.id });
    expect(isAuthorizationDenial(error)).toBe(true);
  });

  it('spend_tokens / credit_subscription_tokens: cannot spend or mint tokens for another user', async () => {
    const { error: e1 } = await userAClient.rpc('spend_tokens', { p_user_id: userB.id, p_amount: 1 });
    expect(isAuthorizationDenial(e1)).toBe(true);

    const { error: e2 } = await userAClient.rpc('credit_subscription_tokens', { p_user_id: userB.id, p_amount: 999999 });
    expect(isAuthorizationDenial(e2)).toBe(true);
  });

  it('add_tokens: cannot mint tokens for self or another user from the client', async () => {
    const { error } = await userAClient.rpc('add_tokens', { p_user_id: userA.id, p_amount: 999999 });
    expect(isAuthorizationDenial(error)).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────
// SEC-13b — coverage for 20261121_security_definer_privilege_lockdown.sql
//
// Same architecture, same test shape as SEC-13 above: everything here was
// EXECUTE-able by PUBLIC/anon/authenticated by default (Postgres grants
// EXECUTE to PUBLIC on function creation unless explicitly revoked) until
// that migration. Reuses the userA/userB/admin fixtures from the SEC-13
// beforeAll above rather than re-provisioning.
// ───────────────────────────────────────────────────────────────────────
describe.skipIf(!hasEnv)('SEC-13b — newly locked-down SECURITY DEFINER functions reject direct client calls', () => {
  let admin: SupabaseClient;
  let userAClient: SupabaseClient;
  let userA: { id: string; email: string };
  let userB: { id: string; email: string };

  beforeAll(async () => {
    admin = createClient(URL!, SR_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

    const mkUser = async (tag: string) => {
      const email = `sec13b-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: 'Sec13b-Test-Password-1!',
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`failed to provision test user: ${error?.message}`);
      await admin.from('profiles').upsert({ id: data.user.id, tokens: 1000 });
      return { id: data.user.id, email };
    };

    userA = await mkUser('a');
    userB = await mkUser('b');

    userAClient = createClient(URL!, ANON_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error: signInErr } = await userAClient.auth.signInWithPassword({
      email: userA.email,
      password: 'Sec13b-Test-Password-1!',
    });
    if (signInErr) throw new Error(`failed to sign in test user A: ${signInErr.message}`);
  });

  afterAll(async () => {
    if (!hasEnv) return;
    await admin.auth.admin.deleteUser(userA.id);
    await admin.auth.admin.deleteUser(userB.id);
  });

  it('add_tokens / token & subscription lifecycle: none are reachable from an authenticated client', async () => {
    const calls: Array<[string, Record<string, unknown>]> = [
      ['expire_subscriptions', {}],
      ['expire_trials', {}],
      ['reset_daily_messages', {}],
      ['daily_reset_message_counts', {}],
      ['purge_old_webhooks', {}],
    ];
    for (const [fn, args] of calls) {
      const { error } = await userAClient.rpc(fn, args);
      expect(isAuthorizationDenial(error), `${fn} should reject a direct client call`).toBe(true);
    }
  });

  it('purge_user_data_remediate: cannot trigger account deletion for another user', async () => {
    const { error } = await userAClient.rpc('purge_user_data_remediate', { p_user_id: userB.id });
    expect(isAuthorizationDenial(error)).toBe(true);
  });

  it('private character media: append/remove are server-only', async () => {
    const { error: e1 } = await userAClient.rpc('append_character_private_media', {
      p_character_id: '00000000-0000-0000-0000-000000000000', p_column: 'gallery_urls', p_url: 'https://example.test/x.jpg',
    });
    expect(isAuthorizationDenial(e1)).toBe(true);

    const { error: e2 } = await userAClient.rpc('remove_character_private_media', {
      p_character_id: '00000000-0000-0000-0000-000000000000', p_column: 'gallery_urls', p_url: 'https://example.test/x.jpg',
    });
    expect(isAuthorizationDenial(e2)).toBe(true);
  });

  it('prune_old_messages: cannot prune an arbitrary conversation', async () => {
    const { error } = await userAClient.rpc('prune_old_messages', {
      p_conversation_id: '00000000-0000-0000-0000-000000000000', p_keep: 0,
    });
    expect(isAuthorizationDenial(error)).toBe(true);
  });

  it('increment: cannot manipulate share_cards.views / referral_codes.uses for an arbitrary row', async () => {
    const { error } = await userAClient.rpc('increment', {
      x: 999999, row_id: '00000000-0000-0000-0000-000000000000', table_name: 'share_cards', field_name: 'views',
    });
    expect(isAuthorizationDenial(error)).toBe(true);
  });

  it('age verification: is_user_age_verified / get_user_verified_age cannot be queried for another user', async () => {
    const { error: e1 } = await userAClient.rpc('is_user_age_verified', { p_user_id: userB.id });
    expect(isAuthorizationDenial(e1)).toBe(true);

    const { error: e2 } = await userAClient.rpc('get_user_verified_age', { p_user_id: userB.id });
    expect(isAuthorizationDenial(e2)).toBe(true);
  });

  it('mark_character_status_viewed: cannot mark a status viewed under another user\'s id (was explicitly GRANTed to authenticated)', async () => {
    const { error } = await userAClient.rpc('mark_character_status_viewed', {
      p_character_id: '00000000-0000-0000-0000-000000000000', p_user_id: userB.id,
    });
    expect(isAuthorizationDenial(error)).toBe(true);
  });

  it('toggle_scenario_vote: cannot cast a vote under another user\'s id', async () => {
    const { error } = await userAClient.rpc('toggle_scenario_vote', {
      p_scenario_id: '00000000-0000-0000-0000-000000000000', p_user_id: userB.id, p_vote_type: 'like',
    });
    expect(isAuthorizationDenial(error)).toBe(true);
  });

  it('community reply counters: increment/decrement are server-only', async () => {
    const { error: e1 } = await userAClient.rpc('increment_community_reply_count', {
      p_post_id: '00000000-0000-0000-0000-000000000000',
    });
    expect(isAuthorizationDenial(e1)).toBe(true);

    const { error: e2 } = await userAClient.rpc('decrement_community_reply_count', {
      p_post_id: '00000000-0000-0000-0000-000000000000',
    });
    expect(isAuthorizationDenial(e2)).toBe(true);
  });

  it('admin analytics dashboards: none are reachable by a non-admin authenticated client', async () => {
    const fns = [
      'admin_activity_series', 'admin_wau_mau', 'admin_revenue_series', 'admin_mrr_snapshot',
      'admin_tier_breakdown', 'admin_retention_cohorts', 'admin_top_characters',
      'admin_report_category_breakdown', 'admin_abuse_signal_trend', 'admin_crisis_event_summary',
      'admin_top_community_posts', 'admin_churn_trend', 'admin_message_volume_series',
      'admin_engagement_summary', 'admin_dating_funnel_series', 'admin_referral_funnel_summary',
      'admin_geo_breakdown', 'admin_content_pipeline_summary', 'admin_feature_adoption',
      'admin_gamification_summary',
    ];
    for (const fn of fns) {
      const { error } = await userAClient.rpc(fn);
      expect(isAuthorizationDenial(error), `${fn} should reject a direct client call`).toBe(true);
    }
  });

  it('is_admin(): cannot be used to probe another user\'s admin status, but self-checks and RLS-default calls still work', async () => {
    // Promote userB to a real admin so a "leak" would be observable if the
    // hardening weren't in place.
    await admin.from('profiles').update({ is_admin: true }).eq('id', userB.id);

    // userA (non-admin) asking about userB (an actual admin) must get back
    // false, not the true answer — this is the probe the hardening closes.
    const { data: crossUser, error: crossErr } = await userAClient.rpc('is_admin', { p_uid: userB.id });
    expect(crossErr).toBeNull();
    expect(crossUser).toBe(false);

    // userA asking about themselves (accurate, not-admin) still works.
    const { data: selfCheck, error: selfErr } = await userAClient.rpc('is_admin', { p_uid: userA.id });
    expect(selfErr).toBeNull();
    expect(selfCheck).toBe(false);

    // The bare, no-arg call every RLS policy actually uses (defaults
    // p_uid to auth.uid()) must remain unaffected.
    const { data: bareCall, error: bareErr } = await userAClient.rpc('is_admin');
    expect(bareErr).toBeNull();
    expect(bareCall).toBe(false);
  });
});

describe.skipIf(hasEnv)('SEC-13 — skipped (no live test project configured)', () => {
  it('reminder: set SUPABASE_TEST_URL / SUPABASE_TEST_ANON_KEY / SUPABASE_TEST_SERVICE_ROLE_KEY to run', () => {
    expect(true).toBe(true);
  });
});
