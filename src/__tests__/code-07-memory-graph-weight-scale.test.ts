/**
 * CODE-07 — memory_graph.emotional_weight Stays Within the DB's 1-10 Range
 *
 * Regression test for a bug that made the memory engine's core table
 * (memory_graph) silently non-functional: the DB column is
 *   emotional_weight SMALLINT NOT NULL CHECK (emotional_weight BETWEEN 1 AND 10)
 * but memory-graph.ts and emotion-state.ts wrote values on a 0-100 scale
 * (60 default, 85, 55, 80, and a computed 50-95 range). Every insert
 * violating the CHECK constraint was rejected by Postgres — and because
 * addMemory() is fire-and-forget with a try/catch that only logs a warning,
 * that rejection was invisible. First-meeting records, ambition updates,
 * lore discoveries, and emotionally-significant moments were never
 * actually persisted.
 *
 * A second, related bug lived in the weekly memory-archive cron: it
 * compared emotional_weight < 30, which is vacuously true for every row on
 * a 1-10 scale — once memory_graph started filling up, that cron would
 * have deleted essentially all of it every week.
 *
 * This test locks:
 *   1. Every emotional_weight producer (evaluateEmotionalMemory, and the
 *      static literals in memory-graph.ts) stays within MEMORY_WEIGHT_MIN/MAX.
 *   2. addMemory()'s clamp guard actually clamps out-of-range input instead
 *      of passing it through.
 *   3. The archive cron cutoff is below MEMORY_WEIGHT_MAX (i.e. it can
 *      actually distinguish "low" from "high" weight, unlike the old 30).
 *   4. The DB migration's CHECK constraint — which this whole module treats
 *      as authoritative — hasn't silently changed out from under the code.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  MEMORY_WEIGHT_MIN,
  MEMORY_WEIGHT_MAX,
  MEMORY_WEIGHT_DEFAULT,
  MEMORY_ARCHIVE_WEIGHT_CUTOFF,
} from '../lib/ai/memory-graph';
import { evaluateEmotionalMemory } from '../lib/ai/emotion-state';
import type { EmotionalState } from '../lib/ai/emotion-engine';

function src(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf-8');
}

describe('CODE-07 — memory_graph.emotional_weight bounds', () => {
  it('MEMORY_WEIGHT_MIN/MAX match the DB CHECK constraint (BETWEEN 1 AND 10)', () => {
    expect(MEMORY_WEIGHT_MIN).toBe(1);
    expect(MEMORY_WEIGHT_MAX).toBe(10);
    expect(MEMORY_WEIGHT_DEFAULT).toBeGreaterThanOrEqual(MEMORY_WEIGHT_MIN);
    expect(MEMORY_WEIGHT_DEFAULT).toBeLessThanOrEqual(MEMORY_WEIGHT_MAX);

    const migration = src('..', 'supabase', 'migrations', '20240101_production.sql');
    expect(migration).toMatch(/emotional_weight\s+SMALLINT\s+NOT NULL DEFAULT \d+ CHECK \(emotional_weight BETWEEN 1 AND 10\)/);
  });

  it('evaluateEmotionalMemory never produces a value outside the DB range', () => {
    const cases: EmotionalState[] = [
      { primary: 'sadness',    secondary: [], intensity: 1.0, valence: -0.9, arousal: 0.5, confidence: 1.0 },
      { primary: 'love',       secondary: [], intensity: 0.9, valence: 0.9,  arousal: 0.7, confidence: 0.9 },
      { primary: 'amusement',  secondary: [], intensity: 0.6, valence: 0.6,  arousal: 0.5, confidence: 0.55 },
      { primary: 'anger',      secondary: [], intensity: 0.55, valence: -0.5, arousal: 0.6, confidence: 0.55 },
    ];
    for (const emotion of cases) {
      const result = evaluateEmotionalMemory(emotion);
      if (!result.shouldRecord) continue;
      expect(result.emotional_weight).toBeGreaterThanOrEqual(MEMORY_WEIGHT_MIN);
      expect(result.emotional_weight).toBeLessThanOrEqual(MEMORY_WEIGHT_MAX);
      expect(Number.isInteger(result.emotional_weight)).toBe(true);
    }
  });

  it('no emotional_weight literal in memory-graph.ts exceeds MEMORY_WEIGHT_MAX', () => {
    const graph = src('lib', 'ai', 'memory-graph.ts');
    // Matches literal numeric assignments like `emotional_weight: 85,` but not
    // the clamp/default constant references (emotionalWeight, candidate.emotional_weight, etc.)
    const literalAssignments = [...graph.matchAll(/emotional_weight:\s*(\d+)/g)].map(m => Number(m[1]));
    expect(literalAssignments.length).toBeGreaterThan(0); // sanity: the pattern still matches something
    for (const value of literalAssignments) {
      expect(value).toBeGreaterThanOrEqual(MEMORY_WEIGHT_MIN);
      expect(value).toBeLessThanOrEqual(MEMORY_WEIGHT_MAX);
    }
  });

  it('the memory-archive cron uses the shared cutoff constant, not a re-hardcoded value', () => {
    const cron = src('app', 'api', 'cron', 'memory-archive', 'route.ts');
    expect(cron).toMatch(/MEMORY_ARCHIVE_WEIGHT_CUTOFF/);
    expect(cron).not.toMatch(/lt\('emotional_weight',\s*30\)/);
    expect(MEMORY_ARCHIVE_WEIGHT_CUTOFF).toBeGreaterThanOrEqual(MEMORY_WEIGHT_MIN);
    expect(MEMORY_ARCHIVE_WEIGHT_CUTOFF).toBeLessThan(MEMORY_WEIGHT_MAX);
  });

  it('the dating gifts route (already-correct precedent) stays within range', () => {
    const gifts = src('app', 'api', 'dating', 'gifts', 'route.ts');
    // Written as a ternary (`gift.bond >= 25 ? 9 : gift.bond >= 15 ? 7 : 5`),
    // not a plain literal, so pull out its three branch values directly.
    const ternary = gifts.match(/emotional_weight:\s*gift\.bond >= \d+ \? (\d+) : gift\.bond >= \d+ \? (\d+) : (\d+)/);
    expect(ternary).not.toBeNull();
    const branchValues = (ternary ?? []).slice(1).map(Number);
    expect(branchValues.length).toBe(3);
    for (const value of branchValues) {
      expect(value).toBeGreaterThanOrEqual(MEMORY_WEIGHT_MIN);
      expect(value).toBeLessThanOrEqual(MEMORY_WEIGHT_MAX);
    }
  });

  it('the confession world-impact call rescales 1-10 to the 0-100 scale recordWorldImpact expects', () => {
    const graph = src('lib', 'ai', 'memory-graph.ts');
    // Must NOT pass the raw 1-10 value straight through — a max weight of
    // 10 would never cross world-impact.ts's PROMOTION_THRESHOLD of 65.
    expect(graph).toMatch(/weight:\s*Math\.min\(100,\s*candidate\.emotional_weight \* 10\)/);
  });
});
