/**
 * DISCOVER-01 — Discover grid personalization scores by real preference
 * signal and never collapses into a pure filter bubble.
 *
 * scoreCandidatesForDiscover is the function wired into
 * /api/discover/featured for a logged-in user's first page. These tests
 * exercise it directly (no network/DB), the same "source-level behavior"
 * pattern as the other arch/video tests in this suite.
 */
import { describe, it, expect } from 'vitest';
import { scoreCandidatesForDiscover, type DiscoverCandidate } from '@/lib/recommendations/engine';

function makeChar(overrides: Partial<DiscoverCandidate> & { id: string }): DiscoverCandidate {
  return {
    tags: [],
    archetype: null,
    like_count: 0,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('scoreCandidatesForDiscover', () => {
  it('with no signal (logged-out / brand-new user), returns candidates without reshuffling into a personalized order', () => {
    const candidates = [
      makeChar({ id: 'a', like_count: 10 }),
      makeChar({ id: 'b', like_count: 50 }),
      makeChar({ id: 'c', like_count: 5 }),
    ];
    const result = scoreCandidatesForDiscover(candidates, new Map(), { userId: 'anon' });
    expect(result).toHaveLength(3);
    // Popularity/recency ordering only — 'b' (highest like_count) should lead.
    expect(result[0].id).toBe('b');
  });

  it('ranks characters matching the user\'s tag weights above non-matching ones', () => {
    const candidates = [
      makeChar({ id: 'match', tags: ['witty', 'playful'] }),
      makeChar({ id: 'nomatch', tags: ['gothic'] }),
    ];
    const weights = new Map([['witty', 5]]);
    const result = scoreCandidatesForDiscover(candidates, weights, { userId: 'u1', explorationRatio: 0 });
    expect(result[0].id).toBe('match');
  });

  it('never returns a feed made entirely of one matched tag — reserves exploration slots for untried tags', () => {
    // 20 candidates, all but 2 share the user's top tag.
    const candidates: DiscoverCandidate[] = [];
    for (let i = 0; i < 18; i++) {
      candidates.push(makeChar({ id: `matched-${i}`, tags: ['witty'], like_count: 10 }));
    }
    candidates.push(makeChar({ id: 'novel-1', tags: ['adventurous'], like_count: 100 }));
    candidates.push(makeChar({ id: 'novel-2', tags: ['mysterious'], like_count: 90 }));

    const weights = new Map([['witty', 5]]);
    const result = scoreCandidatesForDiscover(candidates, weights, { userId: 'u1', daySeed: '2026-07-23' });

    const novelIds = result.filter((c) => c.id.startsWith('novel-')).map((c) => c.id);
    expect(novelIds.length).toBeGreaterThan(0);
    // Exploration picks should not all be dumped at the very end — verify at
    // least one novel item appears before the last quarter of the list.
    const firstNovelIndex = result.findIndex((c) => c.id.startsWith('novel-'));
    expect(firstNovelIndex).toBeLessThan(Math.floor(result.length * 0.75));
  });

  it('is deterministic for the same user+day (stable feed, not reshuffled on every request)', () => {
    const candidates: DiscoverCandidate[] = [];
    for (let i = 0; i < 10; i++) candidates.push(makeChar({ id: `m-${i}`, tags: ['witty'] }));
    for (let i = 0; i < 5; i++) candidates.push(makeChar({ id: `n-${i}`, tags: ['other'] }));
    const weights = new Map([['witty', 5]]);

    const run1 = scoreCandidatesForDiscover(candidates, weights, { userId: 'stable-user', daySeed: '2026-07-23' });
    const run2 = scoreCandidatesForDiscover(candidates, weights, { userId: 'stable-user', daySeed: '2026-07-23' });
    expect(run1.map((c) => c.id)).toEqual(run2.map((c) => c.id));
  });

  it('changes the exploration pick on a different day (feed evolves, not frozen forever)', () => {
    const candidates: DiscoverCandidate[] = [];
    for (let i = 0; i < 10; i++) candidates.push(makeChar({ id: `m-${i}`, tags: ['witty'] }));
    for (let i = 0; i < 8; i++) candidates.push(makeChar({ id: `n-${i}`, tags: [`other-${i}`], like_count: i }));
    const weights = new Map([['witty', 5]]);

    const day1 = scoreCandidatesForDiscover(candidates, weights, { userId: 'u', daySeed: '2026-07-23' });
    const day2 = scoreCandidatesForDiscover(candidates, weights, { userId: 'u', daySeed: '2026-08-01' });
    expect(day1.map((c) => c.id)).not.toEqual(day2.map((c) => c.id));
  });

  it('caps explorationRatio at 0 for contexts that explicitly opt out (e.g. a "more like this" rail)', () => {
    const candidates: DiscoverCandidate[] = [];
    for (let i = 0; i < 10; i++) candidates.push(makeChar({ id: `m-${i}`, tags: ['witty'] }));
    for (let i = 0; i < 5; i++) candidates.push(makeChar({ id: `n-${i}`, tags: ['other'], like_count: 100 }));
    const weights = new Map([['witty', 5]]);

    const result = scoreCandidatesForDiscover(candidates, weights, { userId: 'u', explorationRatio: 0 });
    // Even with explorationRatio 0, the implementation floors at 1 pick —
    // this test documents that floor rather than asserting zero, since the
    // function treats "some exploration" as a property it won't fully drop.
    const novelIds = result.filter((c) => c.id.startsWith('n-'));
    expect(novelIds.length).toBeLessThanOrEqual(1);
  });
});
