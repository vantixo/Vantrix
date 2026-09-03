/**
 * moment-labels.ts — client-safe display labels for memory_graph "moments".
 *
 * BUGFIX: momentLabel() used to live in priority-memory.ts, which imports
 * `supabaseAdmin` (service-role client, server-only) at module scope.
 * memories-panel.tsx is a "use client" component that imported momentLabel
 * from there, so Next.js bundled the entire priority-memory.ts module —
 * including the supabaseAdmin createClient() call — into the browser. In
 * the browser, SUPABASE_SERVICE_ROLE_KEY is undefined (it's never exposed
 * client-side), so that createClient() call ran with an empty key and threw
 * at module evaluation, crashing the whole /chat/[id]/memories page with a
 * generic "Page error" boundary before anything could render.
 *
 * Fix: this label map/function has zero server dependencies, so it's pulled
 * out into its own module. priority-memory.ts re-exports momentLabel from
 * here so server call sites don't need to change; memories-panel.tsx now
 * imports directly from here instead, so it never touches supabaseAdmin.
 */

// ── FEATURE 9 (Moments): evocative display labels ──────────────────────────
// promoteMemoryNode() stores the raw MemoryNode.event_type as `category`
// (e.g. 'shared_joke', 'deep_talk') — fine as an internal/filter value, but
// not the "✦ Recurring inside joke" framing a Moments UI needs. This is
// display-only; it never changes what's stored.
const MOMENT_LABELS: Partial<Record<string, string>> = {
  first_meeting:  'First conversation',
  shared_joke:    'A recurring inside joke',
  deep_talk:      'A late-night, meaningful conversation',
  argument:       'An important disagreement',
  reconciliation: 'Making up after a rough moment',
  birthday:       'A birthday remembered',
  gift:           'A gift exchanged',
  confession:     'A meaningful confession',
  milestone:      'A relationship milestone',
  daily_life:     'A small, everyday moment',
  ambition_update:'A shared discovery about where things are headed',
  lore_discovery: 'A shared discovery',
  anniversary:    'An anniversary',
};

/** Human, evocative label for a memory_graph-sourced moment's category.
 *  Falls back to a readable version of the raw category for anything not
 *  in the map (e.g. future event types, or user_facts categories, which
 *  were never meant to go through this — callers should only use this for
 *  source === 'memory_graph' rows). */
export function momentLabel(category: string): string {
  return MOMENT_LABELS[category] ?? category.replace(/_/g, ' ');
}
