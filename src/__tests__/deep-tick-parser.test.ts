/**
 * Deep World Tick — output parsing tests.
 *
 * The deep tick is the one universe job that calls an LLM, so its output
 * is the one piece of this directory that can't be trusted to be
 * well-formed. parseDeepTickOutput() must tolerate markdown fences,
 * leading/trailing commentary, and genuinely broken JSON without throwing
 * — a parse failure should skip the tick, never crash the worker.
 */

import { describe, it, expect } from 'vitest';
import { parseDeepTickOutput, clamp } from '../lib/universe/deep-tick';

describe('parseDeepTickOutput', () => {
  it('parses a clean JSON object', () => {
    const reply = JSON.stringify({
      reasoning: 'short reasoning',
      headline: { title: 'A Thing Happened', description: 'It happened.', weight: 70 },
      story_updates: [],
    });
    const parsed = parseDeepTickOutput(reply);
    expect(parsed?.headline?.title).toBe('A Thing Happened');
    expect(parsed?.story_updates).toEqual([]);
  });

  it('strips markdown code fences before parsing', () => {
    const reply = '```json\n' + JSON.stringify({ headline: { title: 'Fenced', description: 'd' } }) + '\n```';
    const parsed = parseDeepTickOutput(reply);
    expect(parsed?.headline?.title).toBe('Fenced');
  });

  it('tolerates leading/trailing commentary around the JSON object', () => {
    const json = JSON.stringify({ headline: { title: 'Wrapped', description: 'd' } });
    const reply = `Here is my analysis:\n${json}\nLet me know if you need anything else!`;
    const parsed = parseDeepTickOutput(reply);
    expect(parsed?.headline?.title).toBe('Wrapped');
  });

  it('returns null for a headline of null (model explicitly opted out)', () => {
    const reply = JSON.stringify({ reasoning: 'nothing notable', headline: null, story_updates: [] });
    const parsed = parseDeepTickOutput(reply);
    expect(parsed?.headline).toBeNull();
  });

  it('returns null for malformed JSON rather than throwing', () => {
    expect(parseDeepTickOutput('{ this is not valid json')).toBeNull();
  });

  it('returns null when there is no JSON object at all', () => {
    expect(parseDeepTickOutput('I refuse to comply with the format.')).toBeNull();
  });

  it('returns null on empty input', () => {
    expect(parseDeepTickOutput('')).toBeNull();
  });
});

describe('clamp', () => {
  it('keeps in-range values unchanged', () => {
    expect(clamp(70, 1, 100)).toBe(70);
  });

  it('clamps values above the max', () => {
    expect(clamp(150, 1, 100)).toBe(100);
  });

  it('clamps values below the min', () => {
    expect(clamp(-5, 1, 100)).toBe(1);
  });

  it('falls back to min for non-finite input (NaN from a missing field)', () => {
    expect(clamp(Number.NaN, 1, 100)).toBe(1);
  });
});
