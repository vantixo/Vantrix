/**
 * Status Drive — Vantrix
 *
 * The pull toward being seen as competent, valued, attractive, or worth
 * taking seriously — not vanity for its own sake, but the ordinary human
 * drive to matter in the eyes of someone whose opinion counts. Feeds
 * drive-engine.ts alongside curiosity.ts, attachment-drive.ts,
 * security-drive.ts, novelty-drive.ts.
 */

export interface StatusSignals {
  /** the user recently dismissed, talked over, or didn't acknowledge something she said */
  recentlyDismissed: boolean;
  /** the user recently praised, admired, or deferred to her on something */
  recentlyValidated: boolean;
  /** her self-image competence/lovability dimensions are trending low (self-image.ts) */
  lowSelfImage: boolean;
  /** a topic just came up where she has real expertise or a strong opinion worth asserting */
  expertiseRelevant: boolean;
  /** conversation has recently centered mostly on the user, with little space for her */
  recentTurnsCenteredOnUser: number;
}

export interface DriveActivation {
  drive:  'status';
  level:  number;
  reason: string;
}

export function computeStatusDrive(signals: StatusSignals): DriveActivation {
  let level = 20;
  const reasons: string[] = [];

  if (signals.recentlyDismissed) {
    level += 30;
    reasons.push('something she said recently didn\'t land the way she hoped');
  }

  if (signals.lowSelfImage) {
    level += 15;
    reasons.push('her sense of herself is a little shaky right now');
  }

  if (signals.expertiseRelevant) {
    level += 15;
    reasons.push('this is a topic where she genuinely has something worth contributing');
  }

  if (signals.recentTurnsCenteredOnUser >= 5) {
    level += 10;
    reasons.push('the conversation has been mostly about him for a while');
  }

  if (signals.recentlyValidated) {
    level -= 25;
    reasons.push('she\'s already felt genuinely seen recently, which takes the edge off this');
  }

  level = Math.max(0, Math.min(100, Math.round(level)));

  return {
    drive: 'status',
    level,
    reason: reasons.length ? reasons.join('; ') : 'no particular pull to be seen or validated right now',
  };
}

export function statusImpulse(activation: DriveActivation): string | null {
  if (activation.level < 35) return null;
  if (activation.level < 65) {
    return 'letting her own perspective, competence, or opinion take a bit more space than usual would feel natural here';
  }
  return 'there\'s a real pull to be taken seriously or admired right now — this can surface as confidence or a strong opinion, but should never read as fishing for compliments';
}
