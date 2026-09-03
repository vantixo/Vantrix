-- 20261018_dedupe_indexes_and_rls_initplan_fix.sql
--
-- Two independent, low-risk fixes surfaced by the Supabase performance
-- advisor:
--
-- 1) duplicate_index: three tables have two functionally identical indexes
--    (same table, same columns, same predicate). Neither of the dropped
--    indexes backs a constraint (verified against pg_constraint), so
--    dropping is a pure no-op for correctness and just removes redundant
--    write overhead + storage.
--
-- 2) auth_rls_initplan: policies calling auth.uid() / auth.role() directly
--    re-evaluate the function per row. Wrapping the call as
--    (select auth.uid()) lets Postgres evaluate it once per query (initPlan)
--    instead of once per row. This changes evaluation strategy only —
--    every USING/WITH CHECK expression below is semantically identical to
--    the current one, just wrapped.

-- ── 1) Drop duplicate indexes ────────────────────────────────────────────

DROP INDEX IF EXISTS public.idx_push_subscriptions_user_id;          -- dupe of push_subscriptions_user_id_idx
DROP INDEX IF EXISTS public.idx_push_subscriptions_endpoint_unique;  -- dupe of push_subscriptions_endpoint_key
DROP INDEX IF EXISTS public.idx_world_locations_parent;              -- dupe of world_locations_parent_idx

-- ── 2) Wrap auth.<function>() calls so they run once per query ─────────

ALTER POLICY "date_sessions_own_read" ON public.date_sessions
  USING (user_id = (select auth.uid()));

ALTER POLICY "characters_read" ON public.characters
  USING (
    ((active = true) AND (moderation_status = 'approved'::text) AND (visibility <> 'private'::text))
    OR ((select auth.uid()) = creator_id)
    OR is_admin()
  );

ALTER POLICY "universe_scenes_service_write" ON public.universe_scenes
  USING ((select auth.role()) = 'service_role'::text)
  WITH CHECK ((select auth.role()) = 'service_role'::text);

ALTER POLICY "profiles_own_update" ON public.profiles
  USING ((select auth.uid()) = id)
  WITH CHECK (
    ((select auth.uid()) = id)
    AND (tier = (SELECT profiles_1.tier FROM profiles profiles_1 WHERE profiles_1.id = (select auth.uid())))
    AND (tokens = (SELECT profiles_1.tokens FROM profiles profiles_1 WHERE profiles_1.id = (select auth.uid())))
    AND (role = (SELECT profiles_1.role FROM profiles profiles_1 WHERE profiles_1.id = (select auth.uid())))
    AND (is_admin = (SELECT profiles_1.is_admin FROM profiles profiles_1 WHERE profiles_1.id = (select auth.uid())))
    AND (is_disabled = (SELECT profiles_1.is_disabled FROM profiles profiles_1 WHERE profiles_1.id = (select auth.uid())))
  );

ALTER POLICY "messages_archive_own" ON public.messages_archive
  USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages_archive.conversation_id
        AND c.user_id = (select auth.uid())
    )
  );

ALTER POLICY "Users can view their own evolution traits" ON public.character_evolution_traits
  USING ((select auth.uid()) = user_id);

ALTER POLICY "secret_moments_own" ON public.secret_moments
  USING ((select auth.uid()) = user_id);

ALTER POLICY "partners read own volume bonuses" ON public.referral_volume_bonuses
  USING (
    partner_id IN (
      SELECT referral_partners.id FROM referral_partners
      WHERE referral_partners.user_id = (select auth.uid())
    )
  );

ALTER POLICY "users read own digital twin" ON public.digital_twin_profiles
  USING (user_id = (select auth.uid()));

ALTER POLICY "users update own digital twin" ON public.digital_twin_profiles
  USING (user_id = (select auth.uid()));

ALTER POLICY "users read own digital twin messages" ON public.digital_twin_messages
  USING (user_id = (select auth.uid()));

ALTER POLICY "safety_staff_read_crisis_events" ON public.crisis_events
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = (select auth.uid())
        AND (profiles.role = 'safety_reviewer'::text OR profiles.role = 'admin'::text OR profiles.is_admin = true)
    )
  );

ALTER POLICY "safety_staff_update_crisis_events" ON public.crisis_events
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = (select auth.uid())
        AND (profiles.role = 'safety_reviewer'::text OR profiles.role = 'admin'::text OR profiles.is_admin = true)
    )
  );

ALTER POLICY "push_subscriptions_owner_select" ON public.push_subscriptions
  USING ((select auth.uid()) = user_id);

ALTER POLICY "push_subscriptions_owner_insert" ON public.push_subscriptions
  WITH CHECK ((select auth.uid()) = user_id);

ALTER POLICY "push_subscriptions_owner_update" ON public.push_subscriptions
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

ALTER POLICY "push_subscriptions_owner_delete" ON public.push_subscriptions
  USING ((select auth.uid()) = user_id);
