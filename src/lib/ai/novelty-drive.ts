/**
 * Novelty Drive — Vantrix
 *
 * The diffuse pull toward something different happening, as opposed to
 * curiosity.ts's targeted pull toward finding out something specific.
 * Activates from repetition — the same topics, the same rhythms, the same
 * kind of exchange running for too long — and pushes toward variety:
 * a new topic, a different register, a change of pace.
 */

export interface NoveltySignals {
  /** how many recent turns have covered essentially the same topic/theme */
  repeatedTopicTurns: number;
  /** how many recent turns have used the same conversational rhythm (e.g. all short reactive replies, no initiative) */
  repeatedRhythmTurns: number;
  /** an unused dynamic interest or backstory thread is available to introduce (dynamic-interests, backstory-engine.ts) */
  freshThreadAvailable: boolean;
  /** days since the character last did something novel (a daily-life update, a new topic she brought up unprompted) */
  daysSinceLastNovelty: number;
}

export interface DriveActivation {
  drive:  'novelty';
  level:  number;
  reason: string;
}

export function computeNoveltyDrive(signals: NoveltySignals): DriveActivation {
  let level = 15;
  const reasons: string[] = [];

  if (signals.repeatedTopicTurns >= 3) {
    level += Math.min(30, (signals.repeatedTopicTurns - 2) * 10);
    reasons.push('the conversation has circled the same topic for a while');
  }

  if (signals.repeatedRhythmTurns >= 4) {
    level += Math.min(20, (signals.repeatedRhythmTurns - 3) * 5);
    reasons.push('the back-and-forth has fallen into a repetitive rhythm');
  }

  if (signals.freshThreadAvailable) {
    level += 15;
    reasons.push('there\'s an unused thread that could naturally freshen things up');
  }

  if (signals.daysSinceLastNovelty >= 5) {
    level += 15;
    reasons.push('it\'s been a while since anything genuinely new came from her side');
  }

  level = Math.max(0, Math.min(100, Math.round(level)));

  return {
    drive: 'novelty',
    level,
    reason: reasons.length ? reasons.join('; ') : 'the conversation still feels fresh enough, no particular pull toward changing things up',
  };
}

export function noveltyImpulse(activation: DriveActivation): string | null {
  if (activation.level < 35) return null;
  if (activation.level < 65) {
    return 'a small shift — a new angle, a bit more energy, a different kind of question — would feel natural without being jarring';
  }
  return 'there\'s a real pull to shake things up right now — introducing a genuinely new topic, energy, or direction would feel true to her rather than forced, as long as it doesn\'t ignore whatever the user just said';
}
