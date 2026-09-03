/**
 * Employment Engine — Aggregate Labor Market
 *
 * Distinct from companion-jobs.ts, which ticks an individual character's
 * career (promotions, lateral moves). This is the market those careers sit
 * inside: per-location, per-industry openings and wage levels, driven by
 * the same GDP/stability signals economy.ts already tracks. economy.ts's
 * unemployment number is the aggregate outcome; this file is the mechanism
 * — openings tightening or expanding is *why* unemployment moves, and
 * wage_trend here is what should eventually inform raises in
 * companion-jobs.ts.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger }        from '@/lib/logger';
import { narrate }       from './narrator';

export const INDUSTRIES = ['finance', 'manufacturing', 'services', 'technology', 'trade', 'culture'] as const;
export type Industry = (typeof INDUSTRIES)[number];

const BASE_WAGE: Record<Industry, number> = {
  finance: 68000, manufacturing: 48000, services: 38000, technology: 82000, trade: 44000, culture: 36000,
};

export interface JobMarketEntry {
  location_id:  string;
  industry:     Industry;
  openings:     number;
  avg_wage:     number;
  wage_trend:   number;
}

// ── Public: Tick ───────────────────────────────────────────────────────────────

/**
 * Drift openings and wages per industry based on the location's GDP/
 * unemployment trend. Called by the world worker alongside economy_tick —
 * reads location_economy but doesn't write to it, keeping economy.ts as
 * the sole owner of the unemployment figure itself.
 */
export async function runEmploymentTick(locationId: string): Promise<{ location_id: string; total_openings: number }> {
  const { data: econ } = await supabaseAdmin
    .from('location_economy')
    .select('gdp, unemployment')
    .eq('location_id', locationId)
    .maybeSingle();

  if (!econ) {
    await bootstrapJobMarket(locationId);
    return { location_id: locationId, total_openings: 0 };
  }

  const { data: entries } = await supabaseAdmin
    .from('job_market')
    .select('*')
    .eq('location_id', locationId);

  if (!entries || entries.length === 0) {
    await bootstrapJobMarket(locationId);
    return { location_id: locationId, total_openings: 0 };
  }

  const laborHealth = (50 - econ.unemployment) / 50; // -0.9..0.9, positive = tight labor market
  let totalOpenings = 0;

  for (const entry of entries) {
    const openingsDrift = Math.round(laborHealth * 4 + (Math.random() - 0.5) * 3);
    const newOpenings = Math.max(0, entry.openings + openingsDrift);

    const wageTrend = round4(laborHealth * 0.01 + (Math.random() - 0.5) * 0.005);
    const newWage = Math.max(entry.avg_wage * 0.7, entry.avg_wage * (1 + wageTrend));

    await supabaseAdmin
      .from('job_market')
      .update({
        openings:   newOpenings,
        avg_wage:   Math.round(newWage),
        wage_trend: wageTrend,
        updated_at: new Date().toISOString(),
      })
      .eq('id', entry.id);

    totalOpenings += newOpenings;

    if (newOpenings === 0 && entry.openings > 0) {
      const { data: loc } = await supabaseAdmin.from('world_locations').select('name').eq('id', locationId).maybeSingle();
      await supabaseAdmin.from('economic_events').insert({
        event_type:  'industry_hiring_freeze',
        title:       `${capitalize(entry.industry)} Hiring Dries Up`,
        description: narrate.economicStatus(`a hiring freeze in ${entry.industry}`, loc?.name ?? 'the area'),
        location_id: locationId,
        severity:    3,
      }).then(({ error }) => {
        if (error) logger.warn('employment-engine:log-event-failed', { locationId, error });
      });
    }
  }

  return { location_id: locationId, total_openings: totalOpenings };
}

// ── Public: Read ───────────────────────────────────────────────────────────────

export async function getJobMarket(locationId: string): Promise<JobMarketEntry[]> {
  const { data, error } = await supabaseAdmin
    .from('job_market')
    .select('*')
    .eq('location_id', locationId)
    .order('openings', { ascending: false });

  if (error) return [];
  return (data ?? []) as JobMarketEntry[];
}

export async function getWageFor(locationId: string, industry: Industry): Promise<number> {
  const { data } = await supabaseAdmin
    .from('job_market')
    .select('avg_wage')
    .eq('location_id', locationId)
    .eq('industry', industry)
    .maybeSingle();

  return data?.avg_wage ?? BASE_WAGE[industry];
}

// ── Public: Prompt Formatter ───────────────────────────────────────────────────

export async function formatEmploymentForPrompt(locationId: string): Promise<string> {
  const entries = await getJobMarket(locationId);
  if (entries.length === 0) return '';

  const tightest = [...entries].sort((a, b) => b.openings - a.openings)[0];
  const tightestClosed = [...entries].sort((a, b) => a.openings - b.openings)[0];

  const lines: string[] = [];
  if (tightest && tightest.openings > 15) lines.push(`${capitalize(tightest.industry)} is hiring aggressively right now.`);
  if (tightestClosed && tightestClosed.openings === 0) lines.push(`${capitalize(tightestClosed.industry)} jobs are essentially frozen right now.`);

  if (lines.length === 0) return '';
  return `[Job Market]\n${lines.join('\n')}`;
}

// ── Internal ──────────────────────────────────────────────────────────────────

async function bootstrapJobMarket(locationId: string): Promise<void> {
  const rows = INDUSTRIES.map((industry) => ({
    location_id: locationId,
    industry,
    openings:    5 + Math.floor(Math.random() * 20),
    avg_wage:    BASE_WAGE[industry],
    wage_trend:  0,
  }));

  await supabaseAdmin.from('job_market').upsert(rows, { onConflict: 'location_id,industry', ignoreDuplicates: true });
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function round4(val: number): number {
  return Math.round(val * 10000) / 10000;
}
