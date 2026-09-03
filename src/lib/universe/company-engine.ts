/**
 * Company Engine — Character-Founded Businesses
 *
 * "A job is something you have. A company is something you built — and
 * something someone else might be trying to take market share from this
 * week."
 *
 * companion-jobs.ts already models individual careers (promotions, salary
 * drift, employer as a free-text string). economy.ts already models the
 * city-wide aggregate (GDP, unemployment, trade volume). Neither models the
 * thing in between: an actual firm, founded by a specific character, that
 * can hire other characters and that has rivals.
 *
 * Three ticks, run in order by runCompanyTick():
 *
 *   1. FOUNDING     — a small chance per tick that an eligible, currently-
 *                      employed character with no active company of their
 *                      own founds one, seeded from their current occupation
 *                      (industry, starting capital scaled off prestige/salary).
 *   2. HIRING        — active companies with capital to spare occasionally
 *                      hire an unemployed ("Independent") character in the
 *                      same location, moving them into companion_occupations
 *                      with company_id set.
 *   3. COMPETITION   — within each (location, industry) bucket, active
 *                      companies compete pairwise for market_share. It's
 *                      zero-sum by construction: nothing is created or
 *                      destroyed, only redistributed, so the bucket always
 *                      sums to <=100 and a rival's gain is always someone
 *                      else's loss. A company that loses enough, enough
 *                      times, can go bankrupt — its employees are laid off
 *                      back to "Independent," not silently deleted.
 *
 * Called by the world worker on 'company_tick' jobs (see
 * src/app/api/workers/run/route.ts), enqueued on the same 4h cadence as
 * faction_evolve (see src/app/api/cron/governance-tick/route.ts) — company
 * fortunes are a career-adjacent, slow-moving signal, not a per-message one.
 */

import { supabaseAdmin }   from '@/lib/supabase/admin';
import { logger }          from '@/lib/logger';
import { logOfflineEntry } from './life-engine';
import type { Company } from '@/types/world-expansion';

// ── Config ──────────────────────────────────────────────────────────────────

const FOUNDING_CHANCE_PER_TICK = 0.02;   // 2% per eligible character per tick — founding a company is rare and should feel earned
const HIRING_CHANCE_PER_COMPANY = 0.15;  // 15% per active company per tick, gated further by capital/headcount checks below
const MIN_PRESTIGE_TO_FOUND = 55;        // below this, "founding a company" doesn't fit the character's current standing
const MIN_CAPITAL_TO_HIRE = 8_000;       // must have runway beyond the new hire's first-year salary
const MAX_EMPLOYEES_PER_COMPANY = 12;    // keeps a single company from swallowing an entire location's labor pool
const BANKRUPTCY_MARKET_SHARE = 1;       // a company this far below its rivals, out of capital, folds
const BANKRUPTCY_CAPITAL = 500;

const INDUSTRY_STARTUP_COST: Record<string, number> = {
  technology: 40_000,
  finance:    50_000,
  manufacturing: 30_000,
  trade:      15_000,
  services:   12_000,
  culture:    8_000,
  scavenging: 3_000,
};

// ── Public: Tick ──────────────────────────────────────────────────────────────

export interface CompanyTickResult {
  founded:      number;
  hires:        number;
  competitions: number;
  bankruptcies: number;
}

export async function runCompanyTick(): Promise<CompanyTickResult> {
  const [founded, hires, competitionResult] = await Promise.all([
    tickFounding(),
    tickHiring(),
    tickCompetition(),
  ]);

  return {
    founded,
    hires,
    competitions: competitionResult.competitions,
    bankruptcies: competitionResult.bankruptcies,
  };
}

// ── Founding ──────────────────────────────────────────────────────────────────

async function tickFounding(): Promise<number> {
  // Eligible: has an occupation with prestige >= threshold, is not already
  // the founder of an active company, and has a location to found in.
  const { data: candidates, error } = await supabaseAdmin
    .from('companion_occupations')
    .select(`
      character_id, employer, salary, location_id, company_id,
      occupation:occupations(title, prestige, category),
      character:characters(name)
    `)
    .not('location_id', 'is', null)
    .limit(500);

  if (error || !candidates) {
    logger.warn('company-engine:founding:fetch-failed', { error });
    return 0;
  }

  let founded = 0;

  for (const row of candidates) {
    if (Math.random() > FOUNDING_CHANCE_PER_TICK) continue;
    if (row.company_id) continue; // already runs a company they're employed by (as founder or otherwise)

    const prestige = row.occupation?.prestige ?? 0;
    if (prestige < MIN_PRESTIGE_TO_FOUND) continue;
    if (!row.character || !row.location_id) continue;

    // Already founded an active company elsewhere? Don't stack founders.
    const { data: existing } = await supabaseAdmin
      .from('companies')
      .select('id')
      .eq('founder_character_id', row.character_id)
      .eq('status', 'active')
      .maybeSingle();
    if (existing) continue;

    const industry = mapCategoryToIndustry(row.occupation?.category ?? 'services');
    const startupCost = INDUSTRY_STARTUP_COST[industry] ?? INDUSTRY_STARTUP_COST.services!;
    const capital = Math.round(startupCost * (0.6 + Math.random() * 0.8));

    const name = generateCompanyName(row.character.name, industry);

    const { data: company, error: insertErr } = await supabaseAdmin
      .from('companies')
      .insert({
        name,
        founder_character_id: row.character_id,
        location_id: row.location_id,
        industry,
        capital,
        market_share: 5,
        reputation: Math.min(70, 40 + Math.round(prestige / 5)),
        employee_count: 1,
      })
      .select('id, name')
      .single();

    if (insertErr || !company) {
      logger.warn('company-engine:founding:insert-failed', { characterId: row.character_id, error: insertErr });
      continue;
    }

    // Move the founder's own occupation onto the new company.
    await supabaseAdmin
      .from('companion_occupations')
      .update({ employer: company.name, company_id: company.id })
      .eq('character_id', row.character_id);

    await logOfflineEntry(
      row.character_id,
      'activity',
      `${row.character.name} founded ${company.name}. It's still just an idea with a bank account, but it's real now.`,
    );

    await supabaseAdmin.from('economic_events').insert({
      event_type: 'company_founded',
      title: `${company.name} Founded`,
      description: `${row.character.name} has founded ${company.name}, a new ${industry} venture.`,
      location_id: row.location_id,
      severity: 2,
    });

    founded++;
  }

  return founded;
}

// ── Hiring ────────────────────────────────────────────────────────────────────

async function tickHiring(): Promise<number> {
  const { data: companies, error } = await supabaseAdmin
    .from('companies')
    .select('id, name, location_id, capital, employee_count, industry')
    .eq('status', 'active')
    .gte('capital', MIN_CAPITAL_TO_HIRE)
    .lt('employee_count', MAX_EMPLOYEES_PER_COMPANY)
    .limit(200);

  if (error || !companies) {
    logger.warn('company-engine:hiring:fetch-failed', { error });
    return 0;
  }

  let hires = 0;

  for (const company of companies) {
    if (Math.random() > HIRING_CHANCE_PER_COMPANY) continue;

    // Find one "Independent" character based in the same location to poach into the role.
    const { data: candidate } = await supabaseAdmin
      .from('companion_occupations')
      .select('character_id, employer, salary, character:characters(name)')
      .eq('location_id', company.location_id)
      .eq('employer', 'Independent')
      .is('company_id', null)
      .limit(1)
      .maybeSingle();

    if (!candidate?.character) continue;

    const salary = Math.max(2_000, Math.round(company.capital * 0.02));
    // Hiring is a real cost — the company commits roughly a year's salary as runway.
    const capitalCost = salary;

    const { data: updated } = await supabaseAdmin
      .from('companion_occupations')
      .update({ employer: company.name, company_id: company.id, salary })
      .eq('character_id', candidate.character_id)
      .select('character_id')
      .maybeSingle();

    if (!updated) continue;

    await supabaseAdmin
      .from('companies')
      .update({
        capital: Math.max(0, company.capital - capitalCost),
        employee_count: company.employee_count + 1,
      })
      .eq('id', company.id);

    await logOfflineEntry(
      candidate.character_id,
      'activity',
      `${candidate.character.name} was hired at ${company.name}. New job, new people, new problems to learn.`,
    );

    hires++;
  }

  return hires;
}

// ── Competition ───────────────────────────────────────────────────────────────

type CompanySummary = Pick<
  Company,
  'id' | 'name' | 'location_id' | 'industry' | 'capital' | 'market_share' | 'reputation' | 'employee_count' | 'status'
>;

async function tickCompetition(): Promise<{ competitions: number; bankruptcies: number }> {
  const { data: companies, error } = await supabaseAdmin
    .from('companies')
    .select('id, name, location_id, industry, capital, market_share, reputation, employee_count, status')
    .eq('status', 'active')
    .limit(500);

  if (error || !companies || companies.length < 2) {
    return { competitions: 0, bankruptcies: 0 };
  }

  const buckets = groupByLocationIndustry(companies as CompanySummary[]);

  let competitions = 0;
  let bankruptcies = 0;

  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;

    // One pairwise contest per bucket per tick — keeps this proportionate
    // to founding/hiring cadence rather than churning every company every tick.
    const [a, b] = pickTwo(bucket);
    if (!a || !b) continue;

    const strengthA = companyStrength(a);
    const strengthB = companyStrength(b);
    const total = strengthA + strengthB;
    if (total <= 0) continue;

    // Stronger company is favored but the outcome stays probabilistic —
    // an underdog can still win a given round.
    const aWins = Math.random() < strengthA / total;
    const winner = aWins ? a : b;
    const loser  = aWins ? b : a;

    const shareShift = Math.min(loser.market_share, Math.round(1 + Math.random() * 4));
    const newWinnerShare = Math.min(100, winner.market_share + shareShift);
    const newLoserShare  = Math.max(0, loser.market_share - shareShift);

    await Promise.all([
      supabaseAdmin.from('companies').update({
        market_share: newWinnerShare,
        reputation: Math.min(100, winner.reputation + 1),
      }).eq('id', winner.id),
      supabaseAdmin.from('companies').update({
        market_share: newLoserShare,
        reputation: Math.max(0, loser.reputation - 1),
        capital: Math.max(0, loser.capital - Math.round(loser.capital * 0.03)),
      }).eq('id', loser.id),
    ]);

    await supabaseAdmin.from('economic_events').insert({
      event_type: 'company_competition',
      title: `${winner.name} Gains Ground on ${loser.name}`,
      description: `${winner.name} pulled ahead of ${loser.name} in the ${winner.industry} market this cycle, taking a slice of their share.`,
      location_id: winner.location_id,
      severity: 1,
    });

    competitions++;

    const loserAfter = { ...loser, market_share: newLoserShare, capital: Math.max(0, loser.capital - Math.round(loser.capital * 0.03)) };
    if (loserAfter.market_share <= BANKRUPTCY_MARKET_SHARE && loserAfter.capital <= BANKRUPTCY_CAPITAL) {
      await bankruptCompany(loserAfter);
      bankruptcies++;
    }
  }

  return { competitions, bankruptcies };
}

async function bankruptCompany(company: CompanySummary): Promise<void> {
  await supabaseAdmin
    .from('companies')
    .update({ status: 'bankrupt', capital: 0, employee_count: 0 })
    .eq('id', company.id);

  // Lay off every employee back to "Independent" — the invariant that
  // companion_occupations always has exactly one row per character stays
  // intact; only the employer/company_id/salary reset.
  const { data: employees } = await supabaseAdmin
    .from('companion_occupations')
    .select('character_id, character:characters(name)')
    .eq('company_id', company.id);

  if (employees?.length) {
    await supabaseAdmin
      .from('companion_occupations')
      .update({ employer: 'Independent', company_id: null, salary: 2_000 })
      .eq('company_id', company.id);

    for (const emp of employees) {
      if (!emp.character) continue;
      await logOfflineEntry(
        emp.character_id,
        'activity',
        `${company.name} shut its doors. ${emp.character.name} is looking for what's next.`,
      );
    }
  }

  await supabaseAdmin.from('economic_events').insert({
    event_type: 'company_bankruptcy',
    title: `${company.name} Closes`,
    description: `${company.name} could not hold its ground in the ${company.industry} market and has folded.`,
    location_id: company.location_id,
    severity: 3,
  });
}

// ── Public: Read ──────────────────────────────────────────────────────────────

export async function getCharacterCompany(characterId: string): Promise<{
  company: Company;
  role: 'founder' | 'employee';
} | null> {
  const [{ data: founded }, { data: occupation }] = await Promise.all([
    supabaseAdmin.from('companies').select('*').eq('founder_character_id', characterId).eq('status', 'active').maybeSingle(),
    supabaseAdmin.from('companion_occupations').select('company_id, company:companies(*)').eq('character_id', characterId).maybeSingle(),
  ]);

  if (founded) return { company: founded as Company, role: 'founder' };

  const employedCompany = (occupation as unknown as { company: Company | null } | null)?.company;
  if (employedCompany) return { company: employedCompany, role: 'employee' };

  return null;
}

// ── Public: Prompt Formatter ─────────────────────────────────────────────────

export async function formatCompanyForPrompt(characterId: string): Promise<string> {
  const result = await getCharacterCompany(characterId);
  if (!result) return '';

  const { company, role } = result;
  const lines: string[] = [];

  if (role === 'founder') {
    lines.push(`You founded ${company.name}, a ${company.industry} company.`);
    lines.push(`It employs ${company.employee_count} ${company.employee_count === 1 ? 'person' : 'people'} and holds roughly ${Math.round(company.market_share)}% of the local ${company.industry} market.`);
  } else {
    lines.push(`You work at ${company.name}, a ${company.industry} company — not your own, but a real job with real stakes for the person who runs it.`);
  }

  lines.push(companyStandingLine(company));

  return `[Company]\n${lines.join('\n')}`;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function companyStrength(company: Pick<Company, 'market_share' | 'reputation' | 'capital' | 'employee_count'>): number {
  // Weighted composite — market share dominates (it's the thing being
  // contested), reputation and headcount contribute meaningfully, capital
  // matters least directly (it's a resource, not a competitive edge on its own).
  return (
    company.market_share * 2 +
    company.reputation * 0.5 +
    company.employee_count * 3 +
    Math.log10(Math.max(1, company.capital))
  );
}

function groupByLocationIndustry(companies: CompanySummary[]): Map<string, CompanySummary[]> {
  const buckets = new Map<string, CompanySummary[]>();
  for (const c of companies) {
    const key = `${c.location_id}::${c.industry}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(c);
    buckets.set(key, bucket);
  }
  return buckets;
}

function pickTwo<T>(arr: T[]): [T | undefined, T | undefined] {
  if (arr.length < 2) return [undefined, undefined];
  const i = Math.floor(Math.random() * arr.length);
  let j = Math.floor(Math.random() * arr.length);
  while (j === i) j = Math.floor(Math.random() * arr.length);
  return [arr[i], arr[j]];
}

function mapCategoryToIndustry(category: string): string {
  const map: Record<string, string> = {
    technology: 'technology',
    technical: 'technology',
    academic: 'services',
    creative: 'culture',
    food: 'trade',
    trade: 'trade',
    medical: 'services',
    legal: 'services',
    government: 'services',
    media: 'culture',
    design: 'manufacturing',
    education: 'services',
    professional: 'finance',
    independent: 'services',
  };
  return map[category.toLowerCase()] ?? 'services';
}

function generateCompanyName(founderName: string, industry: string): string {
  const suffixByIndustry: Record<string, string[]> = {
    technology: ['Systems', 'Labs', 'Works', 'Collective'],
    finance: ['Capital', 'Partners', 'Group', 'Holdings'],
    manufacturing: ['Foundry', 'Works', 'Industries'],
    trade: ['Trading Co.', 'Exchange', '& Co.'],
    services: ['Consulting', 'Group', 'Practice'],
    culture: ['Studio', 'House', 'Collective'],
    scavenging: ['Salvage', 'Reclamation Co.'],
  };
  const options = suffixByIndustry[industry] ?? ['& Co.'];
  const suffix = options[Math.floor(Math.random() * options.length)];
  const firstName = founderName.split(' ')[0];
  return `${firstName} ${suffix}`;
}

function companyStandingLine(company: Pick<Company, 'status' | 'market_share' | 'reputation' | 'name'>): string {
  if (company.status === 'struggling') return 'The company is going through a rough stretch right now.';
  if (company.market_share >= 40) return `${company.name} is a dominant player in its market.`;
  if (company.market_share >= 15) return `${company.name} is well established and holding its ground.`;
  if (company.reputation >= 70) return `${company.name} is small but well-regarded.`;
  return `${company.name} is still finding its footing.`;
}
