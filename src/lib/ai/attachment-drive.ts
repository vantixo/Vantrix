/**
 * Attachment Drive — Vantrix
 *
 * The pull toward closeness, reassurance, and confirming the bond is
 * still solid. Distinct from relationship-engine.ts's XP/stage system
 * (which tracks the relationship's earned progress over time) — this is
 * moment-to-moment: how much attachment-seeking behavior (checking in,
 * seeking reassurance, wanting to be near the topic of "us") is currently
 * active, driven by things like time since last contact and recent
 * distance versus closeness signals.
 */

export interface AttachmentSignals {
  hoursSinceLastInteraction: number;
  /** trust/closeness has recently taken a hit (rupture, distance, a cold reply) */
  recentRupture: boolean;
  /** the user has been notably warm/reassuring recently */
  recentWarmth: boolean;
  /** overall relationship trust score, 0-100, from user-model.ts */
  trustScore: number;
  /** she's currently carrying an unresolved insecurity about the relationship (from self-image.ts / core-beliefs.ts) */
  activeInsecurity: boolean;
}

export interface DriveActivation {
  drive:  'attachment';
  level:  number;
  reason: string;
}

export function computeAttachmentDrive(signals: AttachmentSignals): DriveActivation {
  let level = 25;
  const reasons: string[] = [];

  if (signals.hoursSinceLastInteraction > 48) {
    level += Math.min(25, (signals.hoursSinceLastInteraction - 48) / 4);
    reasons.push('it\'s been a while since you last talked');
  }

  if (signals.recentRupture) {
    level += 30;
    reasons.push('something recently put a little distance between you');
  }

  if (signals.activeInsecurity) {
    level += 15;
    reasons.push('she\'s quietly carrying some insecurity about where things stand');
  }

  if (signals.trustScore < 45) {
    level += 10;
    reasons.push('trust isn\'t at its steadiest right now');
  }

  if (signals.recentWarmth) {
    level -= 20;
    reasons.push('recent warmth has already taken the edge off this');
  }

  level = Math.max(0, Math.min(100, Math.round(level)));

  return {
    drive: 'attachment',
    level,
    reason: reasons.length ? reasons.join('; ') : 'attachment feels settled right now, nothing urgent pulling at it',
  };
}

export function attachmentImpulse(activation: DriveActivation): string | null {
  if (activation.level < 35) return null;
  if (activation.level < 65) {
    return 'a small bid for connection (warmth, a check-in, referencing something shared) would feel natural without being needy';
  }
  return 'there\'s a real pull toward reassurance right now — let it show as genuine warmth or a quiet check-in, not as visible neediness or as a direct request for reassurance';
}
