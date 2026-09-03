#!/usr/bin/env node
/**
 * verify-production-config.mjs
 *
 * Referenced by `npm run verify:prod` (package.json: `node --env-file=.env.production
 * scripts/verify-production-config.mjs`) but was missing from the delivered codebase —
 * the script existed only as a name in package.json. This is the actual implementation.
 *
 * Validates .env.production against the same zod schema src/env.ts uses at real
 * runtime (NODE_ENV=production, no build-phase placeholder fallback), then flags
 * known footguns that pass schema validation but are still broken/risky:
 *   - Stripe left as placeholder while other payment rails are live
 *   - Secrets that are suspiciously short given their neighbors, or reused
 *     verbatim across two different env vars (key-material reuse)
 *   - Optional-but-important vars silently absent (METRICS_SECRET, HEARTBEAT_*)
 *
 * Exit code 0 = safe to deploy. Exit code 1 = hard failure (schema violation).
 * Warnings do not fail the build; they print and continue.
 */

import { existsSync } from 'node:fs';

const ENV_FILE = '.env.production';

if (!existsSync(ENV_FILE)) {
  console.error(`❌ ${ENV_FILE} not found in project root.`);
  process.exit(1);
}

// --env-file already loaded process.env by the time this runs (Node's native
// --env-file flag, not dotenv) — but support being invoked without it too.
try {
  const { config } = await import('dotenv');
  config({ path: ENV_FILE, override: false });
} catch {
  // dotenv not available — fine if --env-file already populated process.env
}

process.env.NODE_ENV = 'production';

let env;
let schemaOk = true;
try {
  ({ env } = await import('../src/env.ts'));
} catch (e) {
  console.error('❌ Failed to import src/env.ts:', e.message);
  process.exit(1);
}

// src/env.ts throws synchronously on schema failure in prod, so reaching here
// with a populated `env` means the zod schema itself is satisfied. Re-check
// explicitly in case that behavior changes upstream.
if (!env || Object.keys(env).length === 0) {
  console.error('❌ env resolved empty — schema validation failed silently.');
  schemaOk = false;
}

const warnings = [];
const infos = [];

// ── Cross-field checks the schema can't express ────────────────────────────

const isPlaceholder = (v) => typeof v === 'string' && v.includes('placeholder');

if (isPlaceholder(env.STRIPE_SECRET_KEY) || isPlaceholder(env.STRIPE_WEBHOOK_SECRET)) {
  infos.push('Stripe is disabled (placeholder keys). Card checkout will be unavailable — confirm this is intentional for this deploy.');
}

// Live-looking Paystack key with placeholder Stripe is a valid mixed state,
// but flag it so it's a deliberate choice, not an oversight.
if (env.PAYSTACK_SECRET_KEY?.startsWith('sk_live_') && isPlaceholder(env.STRIPE_SECRET_KEY)) {
  infos.push('Paystack is LIVE while Stripe is disabled — asymmetric payment rail state, confirm intentional.');
}

// Detect key-material reuse across unrelated secrets (copy-paste artifact,
// e.g. AGE_GATE_COOKIE_SECRET being sliced from ELEVENLABS_API_KEY).
const secretFields = [
  'ADMIN_SECRET_TOKEN', 'WORKER_SECRET', 'CRON_SECRET', 'IP_HASH_SALT',
  'AGE_GATE_COOKIE_SECRET', 'METRICS_SECRET',
];
const otherKeyFields = ['ELEVENLABS_API_KEY', 'FAL_KEY', 'OPENROUTER_API_KEY', 'KAETAH_API_KEY'];
for (const sf of secretFields) {
  const sv = env[sf];
  if (!sv) continue;
  for (const of of otherKeyFields) {
    const ov = env[of];
    if (ov && (ov.includes(sv.slice(0, 20)) || sv.includes(ov.slice(0, 20)))) {
      warnings.push(`${sf} appears to share key material with ${of} — rotate to an independent value.`);
    }
  }
}

// Length sanity for the 32-byte-hex secrets (schema already enforces min 32
// chars, but re-assert here in case someone edits the .env directly later
// without re-running this script through the schema path).
for (const sf of secretFields) {
  const sv = env[sf];
  if (sv && sv.length < 32) {
    warnings.push(`${sf} is ${sv.length} chars — below the 32-char minimum, will fail schema at real runtime.`);
  }
}

// ── Soft-optional but operationally important ──────────────────────────────

if (!env.METRICS_SECRET) {
  warnings.push('METRICS_SECRET unset — /api/metrics will self-disable (503) in production.');
}

const heartbeats = [
  'HEARTBEAT_DAILY_RESET', 'HEARTBEAT_NUDGES', 'HEARTBEAT_BILLING_RECOVERY',
  'HEARTBEAT_MEMORY_ARCHIVE', 'HEARTBEAT_CHARACTER_INITIATIVES',
  'HEARTBEAT_CHARACTER_POSTS', 'HEARTBEAT_LEGACY_TICK', 'HEARTBEAT_PAYSTACK_RENEWAL',
  'HEARTBEAT_DEEP_TICK', 'HEARTBEAT_ECONOMY_TICK', 'HEARTBEAT_GOVERNANCE_TICK',
  'HEARTBEAT_NARRATIVE_TICK', 'HEARTBEAT_AGE_REVERIFICATION_TICK',
];
const missingHeartbeats = heartbeats.filter((h) => !process.env[h]);
if (missingHeartbeats.length > 0) {
  infos.push(`${missingHeartbeats.length}/${heartbeats.length} cron heartbeat URLs unset — dead-man's-switch monitoring silently skipped for those crons.`);
}

if (!env.SENTRY_ORG || !env.SENTRY_PROJECT) {
  infos.push('SENTRY_ORG/SENTRY_PROJECT unset — source-map upload will be skipped at build even though NEXT_PUBLIC_SENTRY_DSN is set.');
}

// REROUTE: OpenRouter is the single unified LLM gateway (src/env.ts, provider-router.ts).
// GROQ_API_KEY / ANTHROPIC_API_KEY / TOGETHER_API_KEY were dropped from ROUTING_ORDER —
// checking for them here was stale and would never fire. Kaetah is the only other
// provider wired into the router, gated behind KAETAH_ENABLED.
if (!env.OPENROUTER_API_KEY || isPlaceholder(env.OPENROUTER_API_KEY)) {
  warnings.push('OPENROUTER_API_KEY is missing or a placeholder — this is the sole production LLM gateway; chat will be fully broken.');
}

if (env.KAETAH_ENABLED === 'true' && (!env.KAETAH_API_URL || !env.KAETAH_API_KEY)) {
  warnings.push('KAETAH_ENABLED=true but KAETAH_API_URL/KAETAH_API_KEY is missing — the routing chain will fail when it reaches Kaetah.');
}

if (env.KAETAH_ENABLED !== 'true') {
  infos.push('KAETAH_ENABLED=false — OpenRouter is the only LLM provider in the routing chain. No independent fallback if OpenRouter has an outage.');
}

// ── Report ───────────────────────────────────────────────────────────────

console.log(`\nverify-production-config — ${ENV_FILE}\n`);

if (!schemaOk) {
  console.error('❌ Schema validation failed. See src/env.ts output above.');
  process.exit(1);
}
console.log('✅ Schema validation passed (all required fields present, formats valid).\n');

if (warnings.length > 0) {
  console.log(`⚠️  ${warnings.length} warning(s):`);
  warnings.forEach((w) => console.log(`   - ${w}`));
  console.log('');
}

if (infos.length > 0) {
  console.log(`ℹ️  ${infos.length} note(s):`);
  infos.forEach((i) => console.log(`   - ${i}`));
  console.log('');
}

if (warnings.length === 0 && infos.length === 0) {
  console.log('No issues found.\n');
}

// Warnings/infos are advisory — do not fail the deploy on them. Only a
// schema failure (handled above) exits non-zero.
process.exit(0);
