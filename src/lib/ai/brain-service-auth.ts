/**
 * Shared auth-header helper for calls to services/brain (the Python
 * semantic-reranking sidecar).
 *
 * AUTH-FIX: services/brain/main.py previously accepted requests to /embed
 * and /rerank with no credential at all — anyone who could reach
 * BRAIN_SERVICE_URL could send arbitrary batches and consume CPU. The
 * service now checks a Bearer token against BRAIN_SERVICE_API_KEY when
 * that env var is set (see services/brain/main.py's _require_auth). This
 * helper builds the matching header on the Node side so every caller
 * (semantic-memory.ts, character-recommender.ts) sends it consistently
 * instead of each reimplementing the same `if` check.
 *
 * If BRAIN_SERVICE_API_KEY isn't set, this returns an empty object and
 * requests go out unauthenticated — identical to pre-fix behavior, for
 * deployments where the service is only reachable inside a private
 * network/VPC and the extra credential isn't needed.
 */

import { env } from '@/env';

export function brainServiceAuthHeaders(): Record<string, string> {
  const key = env.BRAIN_SERVICE_API_KEY;
  return key ? { Authorization: `Bearer ${key}` } : {};
}
