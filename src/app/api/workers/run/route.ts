/**
 * GET/POST /api/workers/run  — v2
 *
 * DROP-IN REPLACEMENT for the original /api/workers/run/route.ts shipped
 * in the World Expansion package. Same behavior, same exports, with three
 * additional job types dispatched: status_tick, history_aggregate,
 * visual_identity_backfill.
 *
 * If you customised the original worker route, port your changes into
 * the processJob() switch below before overwriting.
 */

import { NextRequest, NextResponse }  from 'next/server';
import { requireCronAuth }            from '@/lib/security';
import { logger }                     from '@/lib/logger';
import { env }                        from '@/env';
import { supabaseAdmin }              from '@/lib/supabase/admin';
import {
  claimNextJob, completeJob, failJob, hasWorkerSignal, clearWorkerSignal,
} from '@/lib/workers';
import { runGovernanceTick }          from '@/lib/universe/governance';
import { runEconomyTick }             from '@/lib/universe/economy';
import { tickSociety }                from '@/lib/universe/society-engine';
import { tickAging }                  from '@/lib/universe/aging-engine';
import { tickCompanionCareers }       from '@/lib/universe/companion-jobs';
import { tickEvents }                 from '@/lib/universe/event-engine';
import { tickStories }                from '@/lib/universe/story-engine';
import { tickReputation }             from '@/lib/universe/reputation';
import { recomputeTitles }            from '@/lib/universe/reputation-titles';
import { tickUserFeeds }              from '@/lib/universe/feed-builder';
import { getUniverseState }           from '@/lib/universe/world-engine';
// New in legacy systems:
import { tickStatusAndLegends }       from '@/lib/universe/status-legend';
import { tickCharacterEvolution }     from '@/lib/universe/character-evolution';
import { tickHistoryAggregate }       from '@/lib/universe/world-history';
import { tickVisualIdentityBackfill } from '@/lib/universe/visual-identity';
import { tickScarcityAudit }          from '@/lib/universe/scarcity';
import { runDeepWorldTick }           from '@/lib/universe/deep-tick';
// ── New: multi-agent organization layer ─────────────────────────────────────
import { runOrganizationTick }        from '@/lib/universe/organization-engine';
import { runLeadershipTick }          from '@/lib/universe/leadership-engine';
import { resolveExpiredProposals }    from '@/lib/universe/consensus-engine';
import { deliverPendingMessages }     from '@/lib/universe/agent-communication';
import { decayCollectiveMemories }    from '@/lib/universe/collective-memory';
import { runTradeTick }               from '@/lib/universe/trade-engine';
import { runCommunityTick }           from '@/lib/universe/community-engine';
// New: employment/housing/taxation — previously implemented but never wired
// into the job dispatcher (see AUDIT_FINDINGS_LOG.md follow-up, Phase 4).
import { runEmploymentTick }          from '@/lib/universe/employment-engine';
import { runHousingTick }             from '@/lib/universe/housing-engine';
import { runTaxPolicyTick }           from '@/lib/universe/taxation-engine';
// New: government engines
import { runLawVote }                 from '@/lib/universe/laws';
import { runElectionProcess }         from '@/lib/universe/elections';
import { runDiplomaticEvent }         from '@/lib/universe/diplomacy';
import { runCityCrisis }              from '@/lib/universe/crisis';
import { runGlobalPoliticsTick }      from '@/lib/universe/politics-engine';
import { tickPublicPerception }       from '@/lib/universe/reputation-engine';
import { runCompanyTick }             from '@/lib/universe/company-engine';
// New: culture, faith, justice, movement, knowledge & climate engines
import { tickCulture }                from '@/lib/universe/culture-engine';
import { tickReligion }               from '@/lib/universe/religion-engine';
import { tickLaw }                    from '@/lib/universe/law-engine';
import { tickCrime }                  from '@/lib/universe/crime-engine';
import { tickCourt }                  from '@/lib/universe/court-engine';
import { tickMigration }              from '@/lib/universe/migration-engine';
import { tickTechnology }             from '@/lib/universe/technology-engine';
import { tickScience }                from '@/lib/universe/science-engine';
import { tickEducation }              from '@/lib/universe/education-engine';
import { tickWeather }                from '@/lib/universe/weather-engine';
import { tickSeason }                 from '@/lib/universe/season-engine';
import { tickDisaster }               from '@/lib/universe/disaster-engine';
import type { UniverseJob, WorldWorkerResult } from '@/types/world-expansion';
import type { Json } from '@/types/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 280;

const MAX_JOBS_PER_RUN = 40;
const TIME_BUDGET_MS   = 250_000;

export async function GET(req: NextRequest)  { return handleRun(req); }
export async function POST(req: NextRequest) { return handleRun(req); }

async function handleRun(req: NextRequest): Promise<NextResponse> {
  if (!requireCronAuth(req, env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  const runRecord = await startWorkerRun('world-worker');

  let claimed   = 0;
  let completed = 0;
  let failed    = 0;
  let governance_ticks  = 0;
  let economy_ticks     = 0;
  let companion_updates = 0;

  try {
    await hasWorkerSignal();

    while (claimed < MAX_JOBS_PER_RUN && (Date.now() - startedAt) < TIME_BUDGET_MS) {
      const job = await claimNextJob();
      if (!job) break;

      claimed++;
      logger.info('world-worker:job:claimed', { id: job.id, type: job.job_type });

      try {
        const result = await processJob(job);
        await completeJob(job.id, result as Record<string, unknown>);
        completed++;

        if (job.job_type === 'governance_tick') governance_ticks++;
        if (job.job_type === 'economy_tick')     economy_ticks++;
        if (job.job_type === 'companion_life')   companion_updates++;

      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('world-worker:job:failed', { id: job.id, type: job.job_type, error: message });
        await failJob(job.id, message);
        failed++;
      }
    }

    if (claimed === 0) {
      await clearWorkerSignal();
    }

    const result: WorldWorkerResult = {
      jobs_claimed:      claimed,
      jobs_completed:    completed,
      jobs_failed:       failed,
      governance_ticks,
      economy_ticks,
      companion_updates,
      duration_ms:       Date.now() - startedAt,
    };

    await finishWorkerRun(runRecord, 'success', completed, result);
    logger.info('world-worker:run:complete', result);
    return NextResponse.json({ ok: true, ...result });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishWorkerRun(runRecord, 'failed', completed, { error: message });
    logger.error('world-worker:run:failed', { error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// ── Job dispatch ───────────────────────────────────────────────────────────────

async function processJob(job: UniverseJob): Promise<unknown> {
  const payload = job.payload as Record<string, any>;

  switch (job.job_type) {
    case 'governance_tick':
      if (!payload.location_id) throw new Error('governance_tick requires location_id');
      return runGovernanceTick(payload.location_id);

    case 'economy_tick':
      if (!payload.location_id) throw new Error('economy_tick requires location_id');
      return runEconomyTick(payload.location_id);

    // Same per-location, GDP/unemployment-driven cadence tier as
    // economy_tick — enqueued alongside it by economy-tick cron. Previously
    // implemented but never dispatched (Phase 4 wiring fix).
    case 'employment_tick':
      if (!payload.location_id) throw new Error('employment_tick requires location_id');
      return runEmploymentTick(payload.location_id);

    case 'housing_tick':
      if (!payload.location_id) throw new Error('housing_tick requires location_id');
      return runHousingTick(payload.location_id);

    // Slower cadence — nudged by governance approval, so it rides the
    // governance_tick (4h) tier rather than the hourly economy tier.
    // Previously implemented but never dispatched (Phase 4 wiring fix).
    case 'tax_policy_tick':
      if (!payload.location_id) throw new Error('tax_policy_tick requires location_id');
      return runTaxPolicyTick(payload.location_id);

    case 'companion_life':
      return tickSociety();

    case 'event_generate': {
      const state = await getUniverseState();
      return tickEvents({ season: state.season, mood: state.world_mood, tickCount: state.tick_count });
    }

    case 'story_advance':
      return tickStories();

    case 'reputation_update': {
      const [reputation, titles, perception] = await Promise.all([tickReputation(), recomputeTitles(), tickPublicPerception()]);
      return { reputation, titles, perception };
    }

    case 'public_perception_tick':
      return tickPublicPerception();

    case 'feed_build':
      return tickUserFeeds();

    case 'faction_evolve': {
      const [careers, politics, companies] = await Promise.all([tickCompanionCareers(), runGlobalPoliticsTick(), runCompanyTick()]);
      return { careers, politics, companies };
    }

    case 'company_tick':
      // Not enqueued by the governance-tick cron (that would double-run it —
      // see faction_evolve above, which already bundles runCompanyTick()).
      // This job_type exists so it can be dispatched standalone, e.g. by an
      // admin tool that wants company effects without careers/politics.
      return runCompanyTick();

    case 'community_tick':
      // Neighborhoods/organizations/clubs — same 4h cadence tier as
      // faction_evolve/company_tick (companion-life-adjacent, not
      // per-message). See src/lib/universe/community-engine.ts.
      return runCommunityTick();

    // ── New: culture, faith, justice, movement, knowledge & climate engines ──
    case 'culture_tick':
      return tickCulture();

    case 'religion_tick':
      return tickReligion();

    case 'law_tick':
      return tickLaw();

    case 'crime_tick':
      // Crime incidents are generated first, then courts work the backlog
      // in the same pass — mirrors how governance/economy already pair up.
      return { crime: await tickCrime(), court: await tickCourt() };

    case 'court_tick':
      // Standalone dispatch (e.g. clearing backlog without generating new
      // incidents) — crime_tick above already bundles this by default.
      return tickCourt();

    case 'migration_tick':
      return tickMigration();

    case 'technology_tick':
      return tickTechnology();

    case 'science_tick':
      return tickScience();

    case 'education_tick':
      return tickEducation();

    case 'weather_tick':
      return tickWeather();

    case 'season_tick':
      return tickSeason();

    case 'disaster_tick':
      return tickDisaster();

    case 'civic_and_climate_tick': {
      // Bundled cadence tier for the new engines, same shape as
      // faction_evolve — one job type enqueued on a schedule that fans
      // out to everything below in a single pass.
      const [culture, religion, law, crime, court, migration, technology, science, education, weather, season, disaster] = await Promise.all([
        tickCulture(),
        tickReligion(),
        tickLaw(),
        tickCrime(),
        tickCourt(),
        tickMigration(),
        tickTechnology(),
        tickScience(),
        tickEducation(),
        tickWeather(),
        tickSeason(),
        tickDisaster(),
      ]);
      return { culture, religion, law, crime, court, migration, technology, science, education, weather, season, disaster };
    }

    // ── New: legacy systems ──────────────────────────────────────────────────
    case 'status_tick': {
      const [status, evolution, scarcity] = await Promise.all([
        tickStatusAndLegends(),
        tickCharacterEvolution(),
        tickScarcityAudit(),
      ]);
      return { status, evolution, scarcity };
    }

    case 'history_aggregate':
      return tickHistoryAggregate();

    case 'visual_identity_backfill':
      return tickVisualIdentityBackfill();

    case 'legend_check':
      // Folded into status_tick; reserved for future fine-grained dispatch.
      return tickStatusAndLegends();

    case 'market_value_tick': {
      const { tickMarketValue } = await import('@/lib/universe/market-value');
      return tickMarketValue();
    }

    case 'world_provisioning_sweep': {
      const { sweepUnprovisionedCharacters } = await import('@/lib/universe/provisioning');
      return sweepUnprovisionedCharacters();
    }

    case 'aging_tick':
      return tickAging();

    // ── Deep tick: single LLM orchestrator call, daily cadence ────────────────
    case 'deep_tick':
      return runDeepWorldTick();

    case 'full_universe_tick': {
      const { enqueueJobsForAllCities } = await import('@/lib/workers');
      const [govCount, ecoCount, electionCount, lawCount, crisisCount, tradeResult] = await Promise.all([
        enqueueJobsForAllCities('governance_tick', 6),
        enqueueJobsForAllCities('economy_tick', 6),
        enqueueJobsForAllCities('election_process', 4),
        enqueueJobsForAllCities('law_vote', 4),
        enqueueJobsForAllCities('city_crisis', 3),
        // trade_process isn't per-city (it matches surplus/shortage across
        // every location and company in one pass), so it's run directly
        // here rather than enqueued per city like the jobs above.
        runTradeTick(),
      ]);
      const [lives, careers, politics, companies, events, stories, reputation, feeds, status, history, titles, perception, aging, community] = await Promise.all([
        tickSociety(),
        tickCompanionCareers(),
        runGlobalPoliticsTick(),
        runCompanyTick(),
        (async () => {
          const state = await getUniverseState();
          return tickEvents({ season: state.season, mood: state.world_mood, tickCount: state.tick_count });
        })(),
        tickStories(),
        tickReputation(),
        tickUserFeeds(),
        tickStatusAndLegends(),
        tickHistoryAggregate(),
        recomputeTitles(),
        tickPublicPerception(),
        tickAging(),
        runCommunityTick(),
      ]);

      // season/weather run before crime so justice-posture-aware engines
      // (crime/court via law-engine) see the freshest governance state,
      // and weather can escalate into disaster the same pass it fires.
      const season = await tickSeason();
      const weather = await tickWeather();
      const [culture, religion, law, crime, court, migration, technology, science, education, disaster] = await Promise.all([
        tickCulture(),
        tickReligion(),
        tickLaw(),
        tickCrime(),
        tickCourt(),
        tickMigration(),
        tickTechnology(),
        tickScience(),
        tickEducation(),
        tickDisaster(),
      ]);

      // Organization layer: message delivery/leadership/consensus first (so
      // a directive or ouster from this pass is visible immediately), then
      // organization cohesion + memory decay, which should reflect
      // whatever leadership/consensus just resolved.
      const [messagesDelivered, leadershipResult, proposalsResolved] = await Promise.all([
        deliverPendingMessages(),
        runLeadershipTick(),
        resolveExpiredProposals(),
      ]);
      const [organizations, memories] = await Promise.all([
        runOrganizationTick(),
        decayCollectiveMemories(),
      ]);

      return {
        govCount, ecoCount, electionCount, lawCount, crisisCount, tradeResult,
        lives, careers, politics, companies, events, stories, reputation, feeds, status, history, titles, perception, aging, community,
        culture, religion, law, crime, court, migration, technology, science, education, weather, season, disaster,
        messagesDelivered, leadershipResult, proposalsResolved, organizations, memories,
      };
    }

    case 'election_process':
      if (!payload.location_id) throw new Error('election_process requires location_id');
      return runElectionProcess(payload.location_id);

    case 'law_vote':
      if (!payload.location_id) throw new Error('law_vote requires location_id');
      return runLawVote(payload.location_id);

    case 'diplomatic_event':
      return runDiplomaticEvent();

    case 'city_crisis':
      if (!payload.location_id) throw new Error('city_crisis requires location_id');
      return runCityCrisis(payload.location_id);

    case 'trade_process':
      // Was previously folded into economy_tick as a no-op. Now runs the
      // real resource-trade engine: production/consumption + decay for
      // every location and active company, then surplus/shortage matching
      // across Iron/Food/Water/Energy/Technology. See
      // src/lib/universe/trade-engine.ts and resource-engine.ts.
      return runTradeTick();

    case 'organization_tick': {
      // Bundled cadence tier for the multi-agent organization layer, same
      // shape as civic_and_climate_tick — one job type enqueued on a
      // schedule that fans out to every organization-layer engine in a
      // single pass. Order matters here: messages deliver before
      // leadership/consensus resolve so a directive/ouster-notice sent
      // this same tick is visible immediately rather than a tick late,
      // and organization cohesion drifts last so it reflects any
      // leadership change that just happened.
      const [delivered, ousted, resolvedProposals] = await Promise.all([
        deliverPendingMessages(),
        runLeadershipTick(),
        resolveExpiredProposals(),
      ]);
      const [orgResult, memoryResult] = await Promise.all([
        runOrganizationTick(),
        decayCollectiveMemories(),
      ]);
      return { delivered, ousted, resolvedProposals, orgResult, memoryResult };
    }

    case 'leadership_tick':
      return runLeadershipTick();

    case 'consensus_sweep':
      return resolveExpiredProposals();

    case 'message_delivery':
      return deliverPendingMessages();

    case 'memory_decay':
      return decayCollectiveMemories();

    case 'world_mood_update':
      // Handled by advanceUniverseTick() in world-engine.ts, called from
      // narrative-tick cron rather than the job queue.
      return { noop: true, reason: 'handled within parent tick' };

    default:
      throw new Error(`Unknown job type: ${job.job_type}`);
  }
}

// ── Worker run tracking ─────────────────────────────────────────────────────────

async function startWorkerRun(name: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('worker_runs')
    .insert({ worker_name: name, status: 'running' })
    .select('id')
    .single();

  if (error) {
    logger.warn('world-worker:run-tracking:start-failed', { error });
    return null;
  }
  return data.id;
}

async function finishWorkerRun(
  runId: string | null,
  status: 'success' | 'failed',
  jobsProcessed: number,
  meta: Record<string, unknown>,
): Promise<void> {
  if (!runId) return;
  await supabaseAdmin
    .from('worker_runs')
    .update({
      status,
      jobs_processed: jobsProcessed,
      duration_ms:    meta.duration_ms as number ?? null,
      error:          (meta.error as string) ?? null,
      meta:           meta as unknown as Json,
      finished_at:    new Date().toISOString(),
    })
    .eq('id', runId);
}
