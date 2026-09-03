/**
 * City Crisis Engine
 *
 * Distinct from routine political_events logged by governance.ts — a crisis
 * is a sustained, named situation (city_crises row) that stays 'active'
 * across multiple ticks until conditions improve, rather than a one-line
 * log entry. Surfaces in world history / atlas views via city_crises.
 *
 * Trigger: low stability + low approval raises odds of a new crisis.
 * Resolution: active crises resolve when stability recovers past a
 * severity-scaled threshold, or after a hard time cap.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';
import { narrate }       from './narrator';

const HARD_CAP_MS = 10 * 24 * 60 * 60 * 1000; // 10 in-world days

const CRISIS_TEMPLATES: { crisis_type: string; title: string; description: string; severity: number }[] = [
  { crisis_type: 'unrest',   title: 'Civil Unrest',        description: 'Demonstrations have spread across the city, straining local patrols.', severity: 3 },
  { crisis_type: 'scandal',  title: 'Council Scandal',      description: 'Allegations against a senior official have shaken public confidence.', severity: 2 },
  { crisis_type: 'shortage', title: 'Resource Shortage',    description: 'Supply shortages are driving up prices across the market district.', severity: 3 },
  { crisis_type: 'disaster', title: 'Infrastructure Failure', description: 'A major infrastructure failure has disrupted daily life citywide.', severity: 4 },
  { crisis_type: 'uprising', title: 'Faction Uprising',     description: 'An opposition faction has openly challenged the ruling government.', severity: 5 },
];

export async function runCityCrisis(
  locationId: string,
): Promise<{ location_id: string; action: string }> {
  const { data: active } = await supabaseAdmin
    .from('city_crises')
    .select('*')
    .eq('location_id', locationId)
    .eq('status', 'active')
    .order('started_at', { ascending: true })
    .maybeSingle();

  if (active) return tryResolve(active);
  return tryTrigger(locationId);
}

async function tryTrigger(locationId: string): Promise<{ location_id: string; action: string }> {
  const { data: gov } = await supabaseAdmin
    .from('city_governance')
    .select('approval_rating, stability')
    .eq('location_id', locationId)
    .maybeSingle();

  if (!gov) return { location_id: locationId, action: 'skipped_no_governance' };

  const distress = clamp((50 - gov.approval_rating) + (50 - gov.stability), 0, 100) / 100;
  const chance = distress * 0.25; // up to 25% per tick at maximum distress
  if (Math.random() >= chance) return { location_id: locationId, action: 'no_crisis' };

  const template = CRISIS_TEMPLATES[Math.floor(Math.random() * CRISIS_TEMPLATES.length)]!;

  await supabaseAdmin.from('city_crises').insert({
    location_id: locationId,
    crisis_type: template.crisis_type,
    severity:    template.severity,
    title:       template.title,
    description: template.description,
  });

  await supabaseAdmin
    .from('city_governance')
    .update({ stability: clamp(gov.stability - template.severity * 2, 0, 100) })
    .eq('location_id', locationId);

  await logPoliticalEvent(locationId, 'crisis_begins', narrate.crisisBegins(template.title), template.severity);
  return { location_id: locationId, action: 'crisis_triggered' };
}

async function tryResolve(crisis: { id: string; location_id: string; severity: number; started_at: string; title: string }): Promise<{ location_id: string; action: string }> {
  const { data: gov } = await supabaseAdmin
    .from('city_governance')
    .select('stability')
    .eq('location_id', crisis.location_id)
    .maybeSingle();

  const age = Date.now() - new Date(crisis.started_at).getTime();
  const recoveryThreshold = 40 + crisis.severity * 5;
  const shouldResolve = (gov && gov.stability >= recoveryThreshold) || age >= HARD_CAP_MS;

  if (!shouldResolve) return { location_id: crisis.location_id, action: 'crisis_ongoing' };

  await supabaseAdmin
    .from('city_crises')
    .update({ status: 'resolved', resolved_at: new Date().toISOString() })
    .eq('id', crisis.id);

  await logPoliticalEvent(crisis.location_id, 'crisis_resolved', narrate.crisisResolved(crisis.title), Math.max(1, crisis.severity - 2));
  return { location_id: crisis.location_id, action: 'crisis_resolved' };
}

async function logPoliticalEvent(locationId: string, eventType: string, description: string, severity: number): Promise<void> {
  await supabaseAdmin.from('political_events').insert({
    event_type: eventType,
    title: eventType === 'crisis_begins' ? 'Crisis Unfolds' : 'Crisis Resolved',
    description,
    location_id: locationId,
    severity,
  }).then(({ error }) => {
    if (error) logger.warn('crisis:log-event:failed', { locationId, error });
  });
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}
