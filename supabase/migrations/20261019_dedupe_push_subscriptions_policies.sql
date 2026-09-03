-- 20261019_dedupe_push_subscriptions_policies.sql
--
-- push_subscriptions has two full sets of owner-scoped policies from two
-- different migrations ("_own" suffix and "_owner_" naming), each checking
-- the identical (select auth.uid()) = user_id condition for the same
-- command. Postgres ORs all permissive policies together for a given
-- role/action, so every SELECT/INSERT/DELETE on this table currently
-- evaluates the same check twice for no behavioral difference.
--
-- Keeping the "_owner_*" set since it's the only one that also covers
-- UPDATE (there's no "*_own" UPDATE policy), giving symmetric CRUD naming.
-- Dropping the redundant "_own" trio.

DROP POLICY IF EXISTS "push_subscriptions_select_own" ON public.push_subscriptions;
DROP POLICY IF EXISTS "push_subscriptions_insert_own" ON public.push_subscriptions;
DROP POLICY IF EXISTS "push_subscriptions_delete_own" ON public.push_subscriptions;
