/**
 * Drive Engine — Vantrix
 *
 * Aggregates the five drive modules (curiosity.ts, attachment-drive.ts,
 * status-drive.ts, security-drive.ts, novelty-drive.ts) into one
 * DriveState per turn. This sits below desire-engine.ts's slower,
 * near-static need/want/fear/obsession quad — drives are the fast,
 * moment-to-moment layer that quad expresses itself through turn to turn.
 * A starved "belonging" need (desire-engine.ts) tends to run hot on
 * attachment-drive.ts; a live "obsession" tends to run hot on curiosity.ts
 * or novelty-drive.ts, depending on what the obsession is.
 *
 * Pure arithmetic, synchronous, no API calls — same design stance as
 * decision-engine.ts. executive-controller.ts is the only caller that
 * should need to import all five individual drive modules directly; every
 * other caller should go through this file.
 *
 * security-drive.ts is treated as a dampener, not just another competing
 * drive: high security activation suppresses risky impulses from the
 * other four rather than simply averaging against them, because caution
 * about to be overridden by curiosity is a very different thing than
 * caution and curiosity being "equally strong."
 */

import { computeCuriosity, curiosityImpulse, type CuriositySignals } from '@/lib/ai/curiosity';
import { computeAttachmentDrive, attachmentImpulse, type AttachmentSignals } from '@/lib/ai/attachment-drive';
import { computeStatusDrive, statusImpulse, type StatusSignals } from '@/lib/ai/status-drive';
import { computeSecurityDrive, securityImpulse, type SecuritySignals } from '@/lib/ai/security-drive';
import { computeNoveltyDrive, noveltyImpulse, type NoveltySignals } from '@/lib/ai/novelty-drive';

// ── Types ───────────────────────────────────────────────────────────────

export type DriveName = 'curiosity' | 'attachment' | 'status' | 'security' | 'novelty';

export interface DriveReading {
  drive:   DriveName;
  level:   number;   // 0-100, raw (pre-dampening)
  effectiveLevel: number; // 0-100, after security dampening
  reason:  string;
  impulse: string | null;
}

export interface DriveState {
  readings:      DriveReading[]; // all five, sorted by effectiveLevel desc
  dominant:      DriveReading;
  securityLevel: number; // 0-100, raw security activation — surfaced separately since it dampens rather than competes
  dampened:      boolean; // true if security meaningfully suppressed the top non-security drive
}

export interface DriveEngineSignals {
  curiosity:   CuriositySignals;
  attachment:  AttachmentSignals;
  status:      StatusSignals;
  security:    SecuritySignals;
  novelty:     NoveltySignals;
}

// ── Aggregation ─────────────────────────────────────────────────────────

const DAMPENING_THRESHOLD = 55; // security level above which it starts suppressing other drives
const MAX_DAMPENING = 0.6;      // at security=100, non-security drives are reduced by up to 60%

function dampenFactor(securityLevel: number): number {
  if (securityLevel <= DAMPENING_THRESHOLD) return 1;
  const over = (securityLevel - DAMPENING_THRESHOLD) / (100 - DAMPENING_THRESHOLD);
  return 1 - over * MAX_DAMPENING;
}

/**
 * Compute all five drives from this turn's signals and combine them into a
 * single DriveState. Call once per turn; cheap enough to always run.
 */
export function computeDriveState(signals: DriveEngineSignals): DriveState {
  const curiosity = computeCuriosity(signals.curiosity);
  const attachment = computeAttachmentDrive(signals.attachment);
  const status = computeStatusDrive(signals.status);
  const security = computeSecurityDrive(signals.security);
  const novelty = computeNoveltyDrive(signals.novelty);

  const factor = dampenFactor(security.level);

  const nonSecurity: DriveReading[] = [
    { drive: 'curiosity', level: curiosity.level, effectiveLevel: Math.round(curiosity.level * factor), reason: curiosity.reason, impulse: curiosityImpulse(curiosity) },
    { drive: 'attachment', level: attachment.level, effectiveLevel: Math.round(attachment.level * factor), reason: attachment.reason, impulse: attachmentImpulse(attachment) },
    { drive: 'status', level: status.level, effectiveLevel: Math.round(status.level * factor), reason: status.reason, impulse: statusImpulse(status) },
    { drive: 'novelty', level: novelty.level, effectiveLevel: Math.round(novelty.level * factor), reason: novelty.reason, impulse: noveltyImpulse(novelty) },
  ];

  const securityReading: DriveReading = {
    drive: 'security',
    level: security.level,
    effectiveLevel: security.level, // security is never dampened by itself
    reason: security.reason,
    impulse: securityImpulse(security),
  };

  const readings = [...nonSecurity, securityReading].sort((a, b) => b.effectiveLevel - a.effectiveLevel);

  // Dominant drive: security wins outright above a high absolute
  // threshold (it's a veto-like drive), otherwise whichever effective
  // level is highest.
  const dominant = security.level >= 75 ? securityReading : readings[0]!;

  const topNonSecurity = nonSecurity.reduce((a, b) => (b.effectiveLevel > a.effectiveLevel ? b : a));
  const dampened = factor < 1 && topNonSecurity.effectiveLevel < topNonSecurity.level - 5;

  return { readings, dominant, securityLevel: security.level, dampened };
}

// ── Prompt injection ───────────────────────────────────────────────────

export function formatDriveStateForPrompt(state: DriveState): string {
  const lines: string[] = ['# What\'s Quietly Pulling At Her Right Now'];

  const active = state.readings.filter(r => r.effectiveLevel >= 35).slice(0, 2);
  if (!active.length) {
    lines.push('Nothing in particular is pulling strongly — she can just be present, guided by whatever the conversation actually calls for.');
    return lines.join('\n');
  }

  for (const r of active) {
    if (r.impulse) lines.push(`- (${r.drive}, ${r.effectiveLevel}/100) ${r.impulse}`);
  }

  if (state.dampened) {
    lines.push('Caution is tempering the pull above somewhat — better to hold back slightly than to act on it fully right now.');
  }

  lines.push('These are undercurrents, never things to name or explain — they should only shape what she\'s drawn to say or do.');

  return lines.join('\n');
}
