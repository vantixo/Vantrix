/**
 * Cognition Engine — Vantrix
 *
 * Public facade for src/lib/cognition/. Callers outside this directory
 * (route.ts, orchestrator.ts) should import from here rather than reaching
 * into individual modules — it re-exports the pieces that are meant to be
 * used externally and hides the ones that are implementation detail of
 * the loop itself.
 *
 * Layering, top to bottom:
 *
 *   cognition-engine.ts        (this file)   — public entry point
 *   consciousness-loop.ts                    — per-turn sequencing
 *   executive-controller.ts                  — decision + working-memory fold-in
 *   reasoning-engine.ts                      — weighs conflicting signals into one read
 *   theory-of-mind.ts                        — models the user's beliefs/wants, catches mismatches
 *   prediction-engine.ts                     — short-horizon trend forecast (disengagement, stage-up)
 *   planner.ts                               — multi-step plans above task-manager.ts's single task
 *   metacognition.ts                         — monitors this layer's own calibration and stalls
 *   reflection-engine.ts                     — distills a turn/session into what's worth remembering
 *   belief-engine.ts                         — persisted, decaying, conflict-aware user beliefs
 *   internal-monologue.ts / private-thoughts.ts — structured, leak-risk-aware thought stream
 *   attention-engine.ts / working-memory.ts  — salience scoring + the buffer itself
 *   src/lib/ai/*                             — the ~90 domain engines this layer sits above
 *
 * Nothing below this file should be imported directly by callers outside
 * src/lib/cognition/ — go through runCognitionCycle()/reportCognitionOutcome()
 * so the sequencing (tick → attend → decide) can't accidentally be run
 * out of order or skipped from a call site.
 *
 * The nine modules added alongside this comment (reasoning, planner,
 * prediction, metacognition, theory-of-mind, reflection, belief-engine,
 * internal-monologue, private-thoughts) are each optional, additive
 * layers — none of them are wired into consciousness-loop.ts's required
 * path, so a caller can adopt them one at a time without the base
 * perceive → attend → decide cycle changing shape. They're re-exported
 * here for the same reason everything else in this facade is: so callers
 * reach into this one file rather than the individual module paths.
 *
 * experience-engine.ts / lesson-engine.ts / wisdom-engine.ts are a
 * further additive chain, each layered on the one before it:
 * experience-engine.ts logs discrete episodic moments, lesson-engine.ts
 * finds repeated patterns across that log, and wisdom-engine.ts
 * synthesizes lessons that survive enough reinforcement into durable,
 * decaying principles. Like the rest of this section, none of them are
 * required by consciousness-loop.ts — the intended call sites are the
 * same domain engines under src/lib/ai/ that already classify a turn's
 * category, plus a session-end pass alongside reflection-engine.ts's
 * reflectOnSession(). Best path through the chain for a caller wiring
 * this up: recordExperience() inline as things happen (now actually
 * wired into chat/stream/route.ts — see that file's COGNITION-WIRE
 * comments), then at session end reinforceLessons() → synthesizeWisdom()
 * → getWisdom() for the next session's prompt, with
 * runWisdomMaintenanceCron() cron-driven weekly (see
 * api/cron/wisdom-habit-maintenance/route.ts). experience-engine.ts and
 * lesson-engine.ts remain in-process Maps deliberately (their data is
 * intermediate/session-scoped by design, not meant to survive a restart
 * on its own — see experience-engine.ts's header); wisdom-engine.ts is
 * the layer that's actually meant to be durable, and as of this pass is
 * (Redis-cached Supabase via wisdom-store.ts, not an in-process Map).
 *
 * habit-engine.ts / routine-engine.ts / automatic-behavior.ts are a
 * third additive chain, this one a fast-path ("System 1") alternative to
 * the deliberate ("System 2") executive-controller.ts path rather than a
 * refinement of it: habit-engine.ts tracks individual cue→response
 * strength (also now Redis-cached Supabase via habit-store.ts, not an
 * in-process Map — every function in this chain is async as a result),
 * routine-engine.ts sequences several habits into an ordered,
 * in-progress routine, and automatic-behavior.ts is the gate that checks
 * both before the full pipeline runs. Best path through this chain: call
 * considerAutomaticResponse() first thing in runConsciousnessCycle(),
 * before executive-controller.ts's decide() step; only fall through to
 * full deliberation when it returns fire: false (no strong-enough habit
 * or routine match, or a watch_flag is active — automatic behavior never
 * overrides safety-relevant deliberation). Call recordAutomaticOutcome()
 * once the reaction is known, and run runHabitMaintenanceCron() on the
 * same weekly cadence as wisdom's cron. NOTE: as of this pass,
 * considerAutomaticResponse() is still not called from
 * consciousness-loop.ts's live cycle — the storage gap is closed, the
 * call-site wiring into the request path remains a follow-up.
 */

export {
  runConsciousnessCycle as runCognitionCycle,
  resolveCycle as reportCognitionOutcome,
  type ConsciousnessCycleInput as CognitionCycleInput,
  type ConsciousnessCycleResult as CognitionCycleResult,
  type ResolutionNote,
} from '@/lib/cognition/consciousness-loop';

export {
  type CognitiveDecision,
  type CognitiveInput,
} from '@/lib/cognition/executive-controller';

export {
  type AttentionSignal,
  type AttentionResult,
} from '@/lib/cognition/attention-engine';

export {
  peek as peekWorkingMemory,
  formatWorkingMemoryForPrompt,
  resetWorkingMemory,
  type WorkingMemoryItem,
  type WorkingMemoryKind,
  type WorkingMemoryState,
} from '@/lib/cognition/working-memory';

// ── Additive layers ─────────────────────────────────────────────────────

export {
  reason,
  contradicts,
  type Claim,
  type ClaimPolarity,
  type ReasoningStep,
  type ReasoningResult,
} from '@/lib/cognition/reasoning-engine';

export {
  createPlan,
  advancePlan,
  abandonPlan,
  listPlans,
  getPlan,
  activePlanForGoal,
  nextStep,
  formatPlanForPrompt,
  resetPlans,
  type Plan,
  type PlanStep,
  type PlanStepStatus,
} from '@/lib/cognition/planner';

export {
  predict,
  type HistorySnapshot,
  type PredictionInput,
  type PredictionResult,
  type Trend,
} from '@/lib/cognition/prediction-engine';

export {
  recordOutcome,
  checkCalibration,
  checkStall,
  formatCalibrationForPrompt,
  resetMetacognition,
  type OutcomeRecord,
  type CalibrationReport,
  type StallReport,
} from '@/lib/cognition/metacognition';

export {
  reconcile,
  getUserModel,
  formatWantsForPrompt,
  resetUserModel,
  type MindSignal,
  type MindSignalKind,
  type UserModel,
  type Mismatch,
  type ReconcileResult,
} from '@/lib/cognition/theory-of-mind';

export {
  reflectOnTurn,
  reflectOnSession,
  formatSessionReflectionForPrompt,
  type TurnReflectionInput,
  type SessionReflection,
} from '@/lib/cognition/reflection-engine';

export {
  recordBelief,
  recordBeliefs,
  getActiveBeliefs,
  markBeliefsUsed,
  runBeliefMaintenance,
  runBeliefMaintenanceCron,
  formatBeliefsForPrompt,
  type Belief,
  type BeliefEvidence,
  type BeliefCategory,
  type BeliefPolarity,
  type BeliefSource,
  type BeliefStatus,
  type RecordBeliefResult,
  type MaintenanceReport,
  type BeliefMaintenanceCronReport,
} from '@/lib/cognition/belief-engine';

export {
  fromWorkingMemory as thoughtsFromWorkingMemory,
  fromBeliefs as thoughtsFromBeliefs,
  fromReasoningConflicts as thoughtsFromReasoningConflicts,
  fromMismatches as thoughtsFromMismatches,
  fromEmotion as thoughtsFromEmotion,
  makeRestraint,
  formatThoughtLine,
  type PrivateThought,
  type ThoughtKind,
  type LeakRisk,
} from '@/lib/cognition/private-thoughts';

export {
  composeMonologue,
  formatMonologueLine,
  type MonologueInput,
  type MonologueStream,
} from '@/lib/cognition/internal-monologue';

export {
  recordExperience,
  getRecentExperiences,
  formatExperiencesForPrompt,
  resetExperiences,
  type ExperienceRecord,
  type ExperienceCategory,
  type ExperienceOutcome,
} from '@/lib/cognition/experience-engine';

export {
  extractLessons,
  reinforceLessons,
  getActiveLessons,
  getPromotableLessons,
  formatLessonsForPrompt,
  resetLessons,
  PROMOTION_THRESHOLD,
  type Lesson,
} from '@/lib/cognition/lesson-engine';

export {
  synthesizeWisdom,
  getWisdom,
  formatWisdomForPrompt,
  runWisdomMaintenance,
  runWisdomMaintenanceCron,
  resetWisdom,
  type WisdomPrinciple,
  type WisdomMaintenanceReport,
  type WisdomMaintenanceCronReport,
} from '@/lib/cognition/wisdom-engine';

export {
  recordHabitOutcome,
  getHabitsForCue,
  getDominantHabit,
  formatHabitsForPrompt,
  runHabitMaintenance,
  runHabitMaintenanceCron,
  resetHabits,
  FIRING_THRESHOLD,
  type Habit,
  type HabitCue,
  type HabitMaintenanceReport,
  type HabitMaintenanceCronReport,
} from '@/lib/cognition/habit-engine';

export {
  startRoutine,
  advanceRoutine,
  abandonRoutine,
  listRoutines,
  getRoutine,
  activeStep as activeRoutineStep,
  routinesAwaitingCue,
  resetRoutines,
  type Routine,
  type RoutineStep,
  type RoutineStepStatus,
} from '@/lib/cognition/routine-engine';

export {
  considerAutomaticResponse,
  recordAutomaticOutcome,
  formatAutomaticDecisionForPrompt,
  type AutomaticDecision,
  type AutomaticSource,
  type AutomaticContext,
} from '@/lib/cognition/automatic-behavior';
