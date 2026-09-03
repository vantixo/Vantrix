// src/lib/ai/kaetah-brain.ts
// ─────────────────────────────────────────────────────────────────────────────
// KAETAH ORCHESTRATION SEAM
//
// Today: Kaetah is a BACKUP compute engine only — see provider-router.ts,
// where 'kaetah' sits as the last-resort entry in every tier's ROUTING_ORDER,
// gated by KAETAH_ENABLED and only reachable once every OpenRouter attempt
// (including its own internal model fallback chain) has failed.
//
// Future: once Kaetah is fully trained, it is meant to become the BRAIN —
// owning identity, memory retrieval, relationship state, context
// construction, routing, response post-processing, and user-specific
// adaptation, with OpenRouter's models demoted to interchangeable compute
// engines underneath it (see the product brief this file was built from).
//
// THIS FILE IS THE SWAP POINT. Every call site that currently calls
// orchestrator.infer()/prepare() directly should eventually call
// kaetahBrain.process() instead. Today that function is a thin pass-through
// to the existing orchestrator; call sites do not need to know or care.
//
// HOW THE SWITCH WORKS:
//   1. KAETAH_BRAIN_ENABLED=false (default) — process() delegates 100% to
//      orchestrator.ts. Nothing about current behavior changes. This file
//      could be deleted today with zero effect other than removing the seam.
//   2. Once Kaetah owns identity/memory/routing for real, flip
//      KAETAH_BRAIN_ENABLED=true and implement the branch below — identity,
//      memory retrieval, relationship state, and context construction move
//      INTO this file (or modules it calls), and it calls out to OpenRouter
//      (via provider-router.ts's routeCompletion/routeStream) purely as a
//      compute engine, the same way it calls Kaetah-as-provider today.
//   3. Removing the OLD (pre-Kaetah) orchestration path at that point means
//      deleting this file's delegate branch and orchestrator.ts's
//      identity/memory-adjacent responsibilities — NOT touching
//      provider-router.ts, model-router.ts, or the image-router, which stay
//      as-is either way (they're compute/media plumbing, not "brain").
//
// Nothing currently imports this file — it is scaffolding, wired the same
// deliberate way provider-router.ts's 'kaetah' PROVIDERS entry is: present,
// documented, inert until explicitly turned on.
// ─────────────────────────────────────────────────────────────────────────────

import { env } from '@/env';
import { orchestrator } from './orchestrator';
import type { OrchestratorContext, OrchestratorMessage, InferResult } from './orchestrator';

export interface KaetahBrainRequest {
  ctx:      OrchestratorContext;
  messages: OrchestratorMessage[];
}

function isKaetahBrainEnabled(): boolean {
  return process.env.KAETAH_BRAIN_ENABLED === 'true';
}

export const kaetahBrain = {
  /**
   * Single entry point future call sites should use. Delegates to the
   * existing orchestrator until KAETAH_BRAIN_ENABLED='true' AND a real
   * implementation exists below — see file header for the migration plan.
   */
  async process(req: KaetahBrainRequest): Promise<InferResult> {
    if (!isKaetahBrainEnabled()) {
      return orchestrator.infer(req.ctx, req.messages);
    }

    // NOT YET IMPLEMENTED: this branch is where Kaetah takes over identity,
    // memory retrieval, relationship state, context construction, routing,
    // response post-processing, and user-specific adaptation. Until that
    // work lands, KAETAH_BRAIN_ENABLED must stay 'false' in every
    // environment — flipping it today would throw, not silently misbehave.
    throw new Error(
      'KAETAH_BRAIN_ENABLED=true but kaetah-brain.ts has no implementation yet. ' +
        'Set KAETAH_BRAIN_ENABLED=false until Kaetah is trained and this file is finished.',
    );
  },
};
