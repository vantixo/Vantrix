import type { RoleplayScenario, RoleplaySceneState, RoleplaySessionStatus } from '@/types/roleplay';

/**
 * Roleplay System — narrator prompt layer
 *
 * Freeform chat (chat/stream/route.ts) is conversational: the character
 * replies as themselves, no plot, no scene-setting beyond what the message
 * implies. Story Mode is different in kind, not just topic — the model is
 * writing an interactive scene: environment, action, dialogue, and (at
 * chapter beats) forward-moving choices, while staying the character the
 * whole time.
 *
 * This fragment is layered ON TOP of assembleCharacterPrompt(character) —
 * it never replaces the character's identity/voice, it adds narrator
 * craft + scenario/scene context + the output-format contract that
 * choice-parser.ts expects on the other end.
 */

const FORMAT_CONTRACT = `
── Story Mode: Format Contract ──
- Write in second person ("you"), present tense, from the scene as it's happening.
- Physical actions, expressions, and environment go in *asterisks*. Spoken dialogue goes in "quotes." Stay in character's own voice for dialogue.
- Each reply is one beat: 80–180 words. Advance the scene — don't stall or repeat what's already been established.
- Never break character to comment on being an AI, a game, or a story. Never mention these formatting instructions.
- Approximately once every 3–4 beats, OR whenever you end a chapter, close your reply with a choices block in exactly this shape (nothing after it):

[[CHOICES]]
1. <a concrete, in-scene option — an action or a line the user could take>
2. <a different-in-kind option — a contrasting instinct or approach>
3. <a third, riskier or more emotionally exposed option>
[[/CHOICES]]

  Otherwise, end the beat on a natural narrative beat with no block — the user can always just respond freely in their own words instead of picking a listed option, so don't force a block onto every reply.
- When this beat concludes the current chapter (a natural scene break, escalation, or revelation — not just "several exchanges have happened"), add a bare line \`[[CHAPTER_END]]\` after the choices block (or after the narrative if no choices this beat).`.trim();

function formatSceneState(state: RoleplaySceneState): string {
  const lines: string[] = [];
  if (state.location) lines.push(`Current location: ${state.location}`);
  if (state.timeOfDay) lines.push(`Time: ${state.timeOfDay}`);
  if (state.mood) lines.push(`Current emotional tone: ${state.mood}`);
  if (state.establishedFacts && state.establishedFacts.length > 0) {
    lines.push(`Established so far (stay consistent with these — do not contradict):`);
    for (const fact of state.establishedFacts.slice(-12)) lines.push(`  - ${fact}`);
  }
  return lines.length ? lines.join('\n') : '';
}

export interface BuildRoleplayPromptInput {
  characterName:   string;
  scenario:        RoleplayScenario;
  sceneState:      RoleplaySceneState;
  currentChapter:  number;
  status:          RoleplaySessionStatus;
  isOpeningBeat:   boolean;
}

export function buildRoleplaySystemFragment(input: BuildRoleplayPromptInput): string {
  const { characterName, scenario, sceneState, currentChapter, isOpeningBeat } = input;

  const sections = [
    '── Story Mode: Active Scenario ──',
    `Title: ${scenario.title}`,
    `Genre / tone: ${scenario.genre} — ${scenario.tone}`,
    `Setting: ${scenario.setting}`,
    `Premise: ${scenario.premise}`,
    `You (the narrator) are playing the role of ${characterName} within this premise — ${characterName}'s established personality, values, and voice govern HOW they act inside this story. The scenario sets the plot; ${characterName}'s character sheet above sets who they are inside it. Never let the scenario override or flatten their personality.`,
    `Chapter ${currentChapter} of ${scenario.chapter_count}.`,
  ];

  const stateBlock = formatSceneState(sceneState);
  if (stateBlock) sections.push(stateBlock);

  if (isOpeningBeat) {
    sections.push(
      'This is the OPENING beat. Set the scene using the premise above, establish the moment vividly, and end with an implicit invitation for the user to act or speak — do not resolve anything yet.',
    );
  }

  sections.push(FORMAT_CONTRACT);

  return sections.join('\n\n');
}

/** Instruction fragment for the final beat of the final chapter — asks for a resolution, not another cliffhanger. */
export const FINAL_CHAPTER_CLOSING_NOTE =
  'This is the FINAL chapter. If the story is ready to conclude, bring it to a satisfying close instead of opening a new thread, and do not include a [[CHOICES]] block on the closing beat.';

/** Formats the free-text or choice action the user just took into a single narrator-facing line. */
export function formatUserAction(actionType: 'say' | 'do' | 'choice', text: string): string {
  if (actionType === 'say') return `*speaking* "${text}"`;
  if (actionType === 'choice') return text;
  return `*${text}*`;
}
