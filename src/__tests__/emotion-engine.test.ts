/**
 * Emotion engine tests.
 *
 * Covers:
 *   - 28-state keyword detection across representative messages
 *   - Linguistic signal boosts (exclamations, caps, ellipsis, emoji)
 *   - Valence/arousal mapping consistency
 *   - Transition model (abrupt drop, healing arc)
 *   - emotionToPsychologyEvent mapping
 *   - applyEmotionBias re-ranking (stable, non-destructive)
 *   - evaluateEmotionalMemory gating thresholds
 */

import { describe, it, expect } from 'vitest';
import { emotionEngine, NEUTRAL_EMOTION, type EmotionalState } from '../lib/ai/emotion-engine';
import {
  emotionToPsychologyEvent,
  applyEmotionBias,
  evaluateEmotionalMemory,
} from '../lib/ai/emotion-state';
import type { MemoryNode } from '../lib/ai/memory-graph';

describe('emotionEngine.detectFromText', () => {
  it('detects loneliness from explicit keywords', () => {
    const state = emotionEngine.detectFromText("I feel so alone lately, nobody gets me.");
    expect(state.primary).toBe('loneliness');
    expect(state.valence).toBeLessThan(0);
  });

  it('detects love from affectionate language', () => {
    const state = emotionEngine.detectFromText("I love you, I've been thinking of you all day.");
    expect(state.primary).toBe('love');
    expect(state.valence).toBeGreaterThan(0);
  });

  it('detects excitement with high arousal', () => {
    const state = emotionEngine.detectFromText("I can't wait, I'm so excited, this is incredible news!!!");
    expect(state.primary).toBe('excitement');
    expect(state.arousal).toBeGreaterThan(0.7);
  });

  it('falls back to neutral for plain factual statements', () => {
    const state = emotionEngine.detectFromText("The meeting is at 3pm tomorrow.");
    expect(state.primary).toBe('neutral');
    expect(state.intensity).toBeLessThan(0.5);
  });

  it('falls back to valence-derived contentment/sadness when no keyword matches', () => {
    const positive = emotionEngine.detectFromText("Today was good and pleasant and calm.");
    expect(positive.primary).toBe('contentment');

    const negative = emotionEngine.detectFromText("Everything feels broken and empty and stuck.");
    expect(negative.primary).toBe('sadness');
  });

  it('boosts anger from ALL CAPS', () => {
    const state = emotionEngine.detectFromText("THIS IS SO FRUSTRATING I CANT EVEN");
    // anger or frustration both plausible depending on which keyword wins —
    // assert it is not neutral and valence is negative
    expect(state.primary).not.toBe('neutral');
    expect(state.valence).toBeLessThanOrEqual(0);
  });

  it('handles negation correctly in valence scoring', () => {
    // "not happy" should not be scored as strongly positive
    const negated = emotionEngine.detectFromText("I am not happy about this at all, it's not good.");
    expect(negated.valence).toBeLessThanOrEqual(0);
  });

  it('detects amusement from laughter emoji', () => {
    const state = emotionEngine.detectFromText("lol that's hilarious 😂");
    expect(state.primary).toBe('amusement');
  });
});

describe('emotionEngine.buildPromptInstructions', () => {
  it('returns empty string for confident neutral with no extra context', () => {
    const out = emotionEngine.buildPromptInstructions(NEUTRAL_EMOTION);
    expect(out).toBe('');
  });

  it('includes a distress warning for high-intensity negative valence', () => {
    const distressed: EmotionalState = {
      primary: 'sadness', secondary: [], intensity: 0.8, valence: -0.7, arousal: 0.3, confidence: 0.8,
    };
    const out = emotionEngine.buildPromptInstructions(distressed);
    expect(out).toContain('High-distress signal');
    expect(out).toContain('sadness');
  });

  it('includes personalisation context when memories are provided', () => {
    const state: EmotionalState = {
      primary: 'joy', secondary: [], intensity: 0.6, valence: 0.8, arousal: 0.6, confidence: 0.7,
    };
    const out = emotionEngine.buildPromptInstructions(state, [{ label: 'User name', value: 'Alex' }]);
    expect(out).toContain('Alex');
  });
});

describe('emotionEngine.transition', () => {
  const happy: EmotionalState     = { primary: 'joy',     secondary: [], intensity: 0.7, valence: 0.8,  arousal: 0.7, confidence: 0.8 };
  const sad: EmotionalState       = { primary: 'sadness', secondary: [], intensity: 0.7, valence: -0.8, arousal: 0.3, confidence: 0.7 };
  const milderSad: EmotionalState = { primary: 'sadness', secondary: [], intensity: 0.4, valence: -0.6, arousal: 0.25, confidence: 0.7 };

  it('boosts confidence on an abrupt happy → distress drop within early turns', () => {
    const out = emotionEngine.transition(happy, sad, 1);
    expect(out.primary).toBe('sadness');
    expect(out.confidence).toBeGreaterThanOrEqual(sad.confidence);
  });

  it('preserves emotion identity on a gradual healing arc (decreasing intensity)', () => {
    const out = emotionEngine.transition(sad, milderSad, 5);
    expect(out.primary).toBe('sadness');
    expect(out.intensity).toBeLessThan(sad.intensity);
  });

  it('passes through unchanged for unrelated transitions', () => {
    const curious: EmotionalState = { primary: 'curiosity', secondary: [], intensity: 0.5, valence: 0.3, arousal: 0.5, confidence: 0.7 };
    const out = emotionEngine.transition(NEUTRAL_EMOTION, curious, 4);
    expect(out).toEqual(curious);
  });
});

describe('emotionToPsychologyEvent', () => {
  it('maps high-intensity sadness/loneliness to deep_conversation', () => {
    const incoming: EmotionalState = { primary: 'loneliness', secondary: [], intensity: 0.7, valence: -0.6, arousal: 0.2, confidence: 0.7 };
    expect(emotionToPsychologyEvent(NEUTRAL_EMOTION, incoming)).toBe('deep_conversation');
  });

  it('maps negative → positive transition to reconciliation', () => {
    const prev: EmotionalState     = { primary: 'sadness', secondary: [], intensity: 0.6, valence: -0.5, arousal: 0.3, confidence: 0.7 };
    const incoming: EmotionalState = { primary: 'joy',      secondary: [], intensity: 0.5, valence: 0.5,  arousal: 0.6, confidence: 0.7 };
    expect(emotionToPsychologyEvent(prev, incoming)).toBe('reconciliation');
  });

  it('maps high-intensity anger to argument', () => {
    const incoming: EmotionalState = { primary: 'anger', secondary: [], intensity: 0.6, valence: -0.75, arousal: 0.9, confidence: 0.8 };
    expect(emotionToPsychologyEvent(NEUTRAL_EMOTION, incoming)).toBe('argument');
  });

  it('maps love/gratitude toward character to compliment', () => {
    const incoming: EmotionalState = { primary: 'gratitude', secondary: [], intensity: 0.5, valence: 0.85, arousal: 0.5, confidence: 0.8 };
    expect(emotionToPsychologyEvent(NEUTRAL_EMOTION, incoming)).toBe('compliment');
  });

  it('returns null for low-intensity neutral exchanges', () => {
    expect(emotionToPsychologyEvent(NEUTRAL_EMOTION, NEUTRAL_EMOTION)).toBeNull();
  });
});

describe('applyEmotionBias', () => {
  const memories: MemoryNode[] = [
    { id: '1', event_type: 'milestone',  title: 'A', description: '', emotional_weight: 90, tags: [], created_at: new Date().toISOString() },
    { id: '2', event_type: 'confession', title: 'B', description: '', emotional_weight: 50, tags: [], created_at: new Date().toISOString() },
    { id: '3', event_type: 'shared_joke',title: 'C', description: '', emotional_weight: 70, tags: [], created_at: new Date().toISOString() },
  ];

  it('returns memories unchanged for neutral/low-confidence emotion', () => {
    expect(applyEmotionBias(memories, NEUTRAL_EMOTION)).toEqual(memories);
  });

  it('surfaces affinity-matching memories first for a strong emotion', () => {
    const sad: EmotionalState = { primary: 'sadness', secondary: [], intensity: 0.7, valence: -0.6, arousal: 0.3, confidence: 0.7 };
    const ranked = applyEmotionBias(memories, sad);
    expect(ranked[0]!.event_type).toBe('confession'); // 'confession' is in sadness affinity
  });

  it('returns an empty array unchanged', () => {
    expect(applyEmotionBias([], NEUTRAL_EMOTION)).toEqual([]);
  });
});

describe('evaluateEmotionalMemory', () => {
  it('does not record low-intensity emotions', () => {
    const mild: EmotionalState = { primary: 'sadness', secondary: [], intensity: 0.3, valence: -0.4, arousal: 0.3, confidence: 0.6 };
    expect(evaluateEmotionalMemory(mild).shouldRecord).toBe(false);
  });

  it('records high-intensity, high-confidence sadness as a confession', () => {
    const strong: EmotionalState = { primary: 'sadness', secondary: [], intensity: 0.8, valence: -0.7, arousal: 0.3, confidence: 0.8 };
    const result = evaluateEmotionalMemory(strong);
    expect(result.shouldRecord).toBe(true);
    expect(result.event_type).toBe('confession');
    // memory_graph.emotional_weight is a SMALLINT CHECK (BETWEEN 1 AND 10) —
    // see 20240101_production.sql. Anything outside this range gets silently
    // dropped by the fire-and-forget insert in memory-graph.ts's addMemory().
    expect(result.emotional_weight).toBeGreaterThanOrEqual(1);
    expect(result.emotional_weight).toBeLessThanOrEqual(10);
  });

  it('records high-intensity love as a confession event', () => {
    const love: EmotionalState = { primary: 'love', secondary: [], intensity: 0.7, valence: 0.9, arousal: 0.7, confidence: 0.8 };
    const result = evaluateEmotionalMemory(love);
    expect(result.shouldRecord).toBe(true);
    expect(result.event_type).toBe('confession');
  });

  it('records high-intensity amusement as a shared_joke', () => {
    const amused: EmotionalState = { primary: 'amusement', secondary: [], intensity: 0.7, valence: 0.75, arousal: 0.6, confidence: 0.7 };
    const result = evaluateEmotionalMemory(amused);
    expect(result.shouldRecord).toBe(true);
    expect(result.event_type).toBe('shared_joke');
  });

  it('does not record neutral emotions', () => {
    expect(evaluateEmotionalMemory(NEUTRAL_EMOTION).shouldRecord).toBe(false);
  });
});
