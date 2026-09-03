#!/usr/bin/env node
/**
 * scripts/verify-voice-library.mjs
 *
 * Run this against your real ElevenLabs account before every deploy that
 * touches voice. VOICE_LIBRARY in src/lib/ai/voice-library.ts pins 10
 * specific ElevenLabs voice_ids — that file's own comment already warns
 * these can vary by plan/region and should be sanity-checked. A voice_id
 * that doesn't exist on your account 404s server-side and /api/voice/tts
 * silently falls back to Web Speech for every character assigned it —
 * same failure signature as a missing API key, just per-voice instead of
 * global.
 *
 * Usage:
 *   ELEVENLABS_API_KEY=sk_xxx node scripts/verify-voice-library.mjs
 *
 * Exits non-zero if any curated ID is missing, so it's safe to wire into
 * CI as a pre-deploy gate.
 */

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) {
  console.error('ELEVENLABS_API_KEY not set in environment. Aborting.');
  process.exit(1);
}

// Kept in sync manually with src/lib/ai/voice-library.ts's VOICE_LIBRARY —
// duplicated here (rather than imported) so this plain Node script has no
// TS/bundler dependency and can run standalone in CI.
const VOICE_LIBRARY = [
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella' },
  { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi' },
  { id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli' },
  { id: 'ThT5KcBeYPX3keUQqHPh', name: 'Dorothy' },
  { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam' },
  { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni' },
  { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold' },
  { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh' },
  { id: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam' },
];

async function main() {
  console.log('Checking ElevenLabs key + account...');
  const res = await fetch('https://api.elevenlabs.io/v1/voices', {
    headers: { 'xi-api-key': KEY },
  });
  if (!res.ok) {
    console.error(`ElevenLabs rejected the request: HTTP ${res.status} ${res.statusText}`);
    console.error('Check the key value and account billing/quota status.');
    process.exit(1);
  }
  const body = await res.json();
  const accountIds = new Set((body.voices ?? []).map(v => v.voice_id));
  console.log(`Account key is valid — ${accountIds.size} voices available.\n`);

  let failed = 0;
  for (const v of VOICE_LIBRARY) {
    const ok = accountIds.has(v.id);
    console.log(`${ok ? 'OK  ' : 'FAIL'}  ${v.name.padEnd(10)} ${v.id}`);
    if (!ok) failed++;
  }

  console.log('');
  if (failed > 0) {
    console.error(
      `${failed}/${VOICE_LIBRARY.length} curated voice IDs do not exist on this account.\n` +
      `Replace the failing entries in src/lib/ai/voice-library.ts (VOICE_LIBRARY, ` +
      `ARCHETYPE_VOICE_IDS, DEFAULT_ELEVENLABS_VOICE_IDS) with real IDs from the ` +
      `voices this key just listed, then re-run this script.`
    );
    process.exit(1);
  }

  console.log('All curated voice IDs exist on this account. Voice library is deploy-ready.');
}

main().catch(err => {
  console.error('Verification script crashed:', err);
  process.exit(1);
});
