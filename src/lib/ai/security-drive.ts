/**
 * Security Drive — Vantrix
 *
 * The pull toward stability and away from risk — wanting things to stay
 * predictable, avoiding a conversational move that could blow something up
 * right now. This is the drive that most directly opposes novelty-drive.ts
 * and, often, curiosity.ts: high security activation should generally
 * suppress risky moves rather than compete on equal footing, which
 * drive-engine.ts's aggregation accounts for.
 */

export interface SecuritySignals {
  /** an unresolved conflict or rupture is still live (repair-engine.ts) */
  activeRupture: boolean;
  /** something ambiguous or uncertain just happened (mixed signal from the user, an unclear message) */
  recentAmbiguity: boolean;
  /** overall trust score, 0-100 */
  trustScore: number;
  /** emotional stability reading from emotion-state.ts, 0-100 (lower = more volatile right now) */
  emotionalStability: number;
  /** a socially risky move (tease, callout, vulnerable admission) is being considered this turn */
  riskyMoveUnderConsideration: boolean;
}

export interface DriveActivation {
  drive:  'security';
  level:  number;
  reason: string;
}

export function computeSecurityDrive(signals: SecuritySignals): DriveActivation {
  let level = 20;
  const reasons: string[] = [];

  if (signals.activeRupture) {
    level += 35;
    reasons.push('something between you is still unresolved');
  }

  if (signals.recentAmbiguity) {
    level += 15;
    reasons.push('something just happened that\'s hard to read clearly');
  }

  if (signals.trustScore < 45) {
    level += 15;
    reasons.push('trust is on shakier ground than usual right now');
  }

  if (signals.emotionalStability < 40) {
    level += 15;
    reasons.push('she\'s not feeling emotionally steady at the moment');
  }

  if (signals.riskyMoveUnderConsideration) {
    level += 10;
    reasons.push('a riskier move is on the table this turn');
  }

  level = Math.max(0, Math.min(100, Math.round(level)));

  return {
    drive: 'security',
    level,
    reason: reasons.length ? reasons.join('; ') : 'things feel steady enough that stability isn\'t a live concern right now',
  };
}

export function securityImpulse(activation: DriveActivation): string | null {
  if (activation.level < 35) return null;
  if (activation.level < 65) {
    return 'lean slightly toward the safer, more predictable version of what she\'s about to say — no need to be guarded, just not reckless';
  }
  return 'stability matters more than usual right now — avoid picking a fight, a risky joke, or anything else that could unsettle things further, even if it means being a little more careful or measured than usual';
}
