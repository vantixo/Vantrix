/**
 * Minimal environment validation for Edge Middleware.
 *
 * Middleware runs on EVERY request and executes in the Edge runtime, which
 * has its own env binding scope separate from the Node server process.
 * It previously imported the full `@/env` schema (Stripe, Paystack,
 * NOWPayments, Redis, R2, Fal, etc.) just to read a handful of fields —
 * meaning a single missing/blank var anywhere in that ~40-field schema
 * (e.g. R2_BUCKET_NAME) would throw during validation and take down EVERY
 * route via middleware, not just the feature that actually needed it.
 *
 * This module validates only what middleware itself reads. Keep it in sync
 * with the `env.*` references in src/middleware.ts — nothing else.
 */
import 'server-only';
import { z } from 'zod';
import { edgeLogger } from './lib/logger.edge';

const isDev = process.env.NODE_ENV !== 'production';
// Same rationale as src/env.ts: next build forces NODE_ENV=production
// before real secrets exist. Without this, a build/static-analysis pass
// that touches middleware would throw here too, independently of env.ts.
const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build';
const useDefaults = isDev || isBuildPhase;

const req = (fb: string) =>
  useDefaults ? z.string().min(1).default(fb) : z.string().min(1);
const reqUrl = (fb: string) =>
  useDefaults ? z.string().url().default(fb) : z.string().url();

const edgeEnvSchema = z.object({
  // Kept in sync with src/env.ts's default — that default matters for the
  // same Windows localhost/IPv6 self-fetch issue fixed in lib/utils.ts's
  // absoluteUrl(); this schema previously defaulted to 'localhost' while
  // env.ts defaulted to '127.0.0.1', an inconsistency between the two env
  // modules with no reason for them to disagree.
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://127.0.0.1:3000'),
  NEXT_PUBLIC_SUPABASE_URL: reqUrl('https://placeholder.supabase.co'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: req('placeholder-anon-key'),
});

const cleaned = Object.fromEntries(
  Object.entries(process.env).map(([k, v]) => [k, v === '' ? undefined : v]),
);

const parsed = edgeEnvSchema.safeParse(cleaned);

if (!parsed.success) {
  const errors = parsed.error.flatten().fieldErrors;
  edgeLogger.error('Invalid middleware environment variables', { errors });
  if (!isDev) {
    throw new Error('Invalid middleware environment variables — see above for details.');
  }
}

export const edgeEnv: z.infer<typeof edgeEnvSchema> = parsed.success
  ? parsed.data
  : edgeEnvSchema.parse({}); // dev-only fallback to placeholders
