/**
 * Shared prompt assembly tests.
 *
 * Ensures that assembleCharacterPrompt() produces a consistent output
 * regardless of which call site invokes it — the whole point of the
 * deduplication fix is that the direct path and queue path use identical
 * prompt logic.
 */

import { describe, it, expect } from 'vitest';
import { assembleCharacterPrompt, FALLBACK_SYSTEM_PROMPT } from '../lib/ai/prompt';

const baseChar = {
  name:        'Aria',
  description: 'A curious and kind AI companion.',
  personality: 'Warm and empathetic',
  backstory:   'Created to help people feel understood.',
  tags:        ['friendly', 'curious'],
  scenario:    'A quiet café conversation',
};

describe('assembleCharacterPrompt', () => {
  it('includes character name', () => {
    expect(assembleCharacterPrompt(baseChar)).toContain('Aria');
  });

  it('includes description', () => {
    expect(assembleCharacterPrompt(baseChar)).toContain('curious and kind');
  });

  it('includes personality when provided', () => {
    expect(assembleCharacterPrompt(baseChar)).toContain('Warm and empathetic');
  });

  it('does NOT include token budget instruction', () => {
    const prompt = assembleCharacterPrompt(baseChar);
    expect(prompt).not.toMatch(/Limit response to approximately/i);
    expect(prompt).not.toMatch(/token/i);
  });

  it('omits personality line when null', () => {
    const char = { ...baseChar, personality: null };
    const prompt = assembleCharacterPrompt(char);
    expect(prompt).not.toContain('Personality:');
  });

  it('omits backstory line when null', () => {
    const char = { ...baseChar, backstory: null };
    const prompt = assembleCharacterPrompt(char);
    expect(prompt).not.toContain('Background:');
  });

  it('omits traits line when tags is empty array', () => {
    const char = { ...baseChar, tags: [] };
    const prompt = assembleCharacterPrompt(char);
    expect(prompt).not.toContain('Traits:');
  });

  it('is deterministic — same character produces same output', () => {
    const a = assembleCharacterPrompt(baseChar);
    const b = assembleCharacterPrompt(baseChar);
    expect(a).toBe(b);
  });
});

describe('FALLBACK_SYSTEM_PROMPT', () => {
  it('is a non-empty string', () => {
    expect(typeof FALLBACK_SYSTEM_PROMPT).toBe('string');
    expect(FALLBACK_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });
});
