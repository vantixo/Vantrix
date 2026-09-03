/**
 * Voice Tone Detector
 *
 * Analyzes message text to determine emotional tone for TTS voice modulation.
 * Maps detected emotion to ElevenLabs stability/style parameters and
 * Web Speech Synthesis rate/pitch adjustments.
 *
 * This runs synchronously — no AI call, pure heuristic. ~0.1ms.
 */

export interface ToneResult {
  emotion:   'playful' | 'warm' | 'romantic' | 'assertive' | 'excited' | 'neutral';
  stability: number;  // ElevenLabs: 0–1, lower = more expressive
  style:     number;  // ElevenLabs: 0–1, higher = more stylized
}

const PLAYFUL_SIGNALS  = /haha|lol|😂|😆|teasing|joking|wink|😜|jk|just kidding|gotcha|silly/i;
const ROMANTIC_SIGNALS = /love|miss you|heart|💕|❤️|darling|sweetheart|hold you|kiss|adore|dream of/i;
const EXCITED_SIGNALS  = /!!|\byes\b.*!|omg|oh my|can't wait|so excited|amazing|incredible|wow|🎉|🔥/i;
const ASSERTIVE_SIGNALS = /listen|look|seriously|enough|stop|no\.|period\.|absolutely not|i said/i;
const WARM_SIGNALS     = /thank you|grateful|appreciate|care about|here for you|always|proud|safe/i;

export function detectEmotionalTone(text: string): ToneResult {
  if (PLAYFUL_SIGNALS.test(text)) {
    return { emotion: 'playful',  stability: 0.45, style: 0.65 };
  }
  if (ROMANTIC_SIGNALS.test(text)) {
    return { emotion: 'romantic', stability: 0.55, style: 0.70 };
  }
  if (EXCITED_SIGNALS.test(text)) {
    return { emotion: 'excited',  stability: 0.35, style: 0.75 };
  }
  if (ASSERTIVE_SIGNALS.test(text)) {
    return { emotion: 'assertive', stability: 0.70, style: 0.50 };
  }
  if (WARM_SIGNALS.test(text)) {
    return { emotion: 'warm',     stability: 0.65, style: 0.55 };
  }
  return { emotion: 'neutral', stability: 0.60, style: 0.50 };
}
