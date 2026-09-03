/**
 * Curiosity Drive — Vantrix
 *
 * One of five drive modules feeding drive-engine.ts (see also
 * attachment-drive.ts, status-drive.ts, security-drive.ts,
 * novelty-drive.ts). Each drive module is a small, pure function: given
 * signals from this turn, return a 0-100 activation level plus a short
 * reason. drive-engine.ts aggregates all five into one DriveState;
 * executive-controller.ts uses the dominant drive to bias what gets
 * attended to and prioritized before a response is planned.
 *
 * Curiosity specifically tracks the pull toward finding something out —
 * distinct from novelty-drive.ts's more general appetite for variety.
 * Curiosity is targeted (a specific unanswered question, an unresolved
 * fact about the user) where novelty is diffuse (just wanting something
 * different to happen).
 */

export interface CuriositySignals {
  /** open threads she's asked about but hasn't gotten a real answer to yet */
  unansweredQuestions: number;
  /** how long, in turns, the longest-standing unanswered question has been open */
  oldestUnansweredTurns: number;
  /** a topic just came up that touches a known gap in what she knows about the user */
  touchedKnowledgeGap: boolean;
  /** she just learned something that raises more questions than it answered */
  raisedNewQuestion: boolean;
  /** conversation has been surface-level for a while — nothing to be curious about */
  recentSurfaceLevelTurns: number;
}

export interface DriveActivation {
  drive:     'curiosity';
  level:     number; // 0-100
  reason:    string;
}

export function computeCuriosity(signals: CuriositySignals): DriveActivation {
  let level = 20; // baseline — mild background curiosity is always present
  const reasons: string[] = [];

  if (signals.unansweredQuestions > 0) {
    level += Math.min(30, signals.unansweredQuestions * 10);
    reasons.push(`${signals.unansweredQuestions} open question${signals.unansweredQuestions > 1 ? 's' : ''} still sitting unanswered`);
  }

  if (signals.oldestUnansweredTurns >= 3) {
    level += Math.min(20, (signals.oldestUnansweredTurns - 2) * 5);
    reasons.push('one of those has been open a while');
  }

  if (signals.touchedKnowledgeGap) {
    level += 20;
    reasons.push('this touches something she doesn\'t actually know about him yet');
  }

  if (signals.raisedNewQuestion) {
    level += 15;
    reasons.push('what just came up raises more questions than it answers');
  }

  if (signals.recentSurfaceLevelTurns >= 4) {
    level += 10;
    reasons.push('conversation has stayed surface-level for a while');
  }

  level = Math.max(0, Math.min(100, Math.round(level)));

  return {
    drive: 'curiosity',
    level,
    reason: reasons.length ? reasons.join('; ') : 'nothing particular pulling curiosity right now',
  };
}

/** What curiosity, at a given activation level, would push her to actually do this turn. */
export function curiosityImpulse(activation: DriveActivation): string | null {
  if (activation.level < 35) return null;
  if (activation.level < 60) return 'let a genuine question surface naturally if the moment allows, without derailing the conversation';
  return 'she\'s genuinely pulled to ask something real right now — following that impulse (once, not repeatedly) would feel true to her, not performed';
}
