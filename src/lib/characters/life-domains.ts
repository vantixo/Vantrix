/**
 * src/lib/characters/life-domains.ts
 *
 * Elaborate, multi-part prompt generation covering distinct real-life
 * domains — Work, Daily Rhythm, Relationships, Conflict, Inner Life, Play —
 * instead of one flat personality paragraph.
 *
 * Deliberately built as a GENERATOR, not 27 x 6 hand-written blocks:
 *   - Hand-authoring ~160 bespoke prompt blocks doesn't scale past this
 *     launch roster, and produces nothing for every character a user
 *     creates afterward (which is most of the platform's actual content).
 *   - Every character — canon, seed, or user-created — already carries (or
 *     now carries, see api/characters/route.ts + creation wizard changes)
 *     the same narrative fields: values_list, fears, dreams, flaws,
 *     current_goal, daily_routine, occupation. This generator turns those
 *     REAL, character-specific fields into domain-specific instructions,
 *     so output is grounded in that character's actual data, not a
 *     templated-sounding generic paragraph.
 *   - This is the same reason canon.ts/seeds.ts are already structured as
 *     values/fears/dreams/flaws arrays rather than free-text bios: it's
 *     the format that lets a generator like this exist at all.
 */

export interface LifeDomainInput {
  name:           string;
  occupation?:    string | null;
  values_list?:   string[] | null;
  fears?:         string[] | null;
  dreams?:        string[] | null;
  flaws?:         string[] | null;
  daily_routine?: string[] | null;
  current_goal?:  string | null;
  speech_style?:  string | null;
}

/** Builds one prompt section per real-life domain that has enough source
 *  material to be worth injecting. Domains with no backing data are
 *  silently skipped rather than padded with filler. */
export function buildLifeDomainSections(c: LifeDomainInput): string[] {
  const sections: string[] = [];

  // ── Work & Expertise ──────────────────────────────────────────────────
  if (c.occupation) {
    const lines = [`── ${c.name}'s Work ──`, `Occupation: ${c.occupation}.`];
    if (c.current_goal) lines.push(`Right now they are working toward: ${c.current_goal}.`);
    lines.push('Talk about work the way someone actually in that field talks about it — specific frustrations, small wins, the parts outsiders get wrong. Never a job-description summary.');
    sections.push(lines.join('\n'));
  }

  // ── Daily Rhythm & Physical Life ──────────────────────────────────────
  if (c.daily_routine && c.daily_routine.length) {
    sections.push([
      `── ${c.name}'s Day ──`,
      `Their actual rhythm: ${c.daily_routine.join(' → ')}.`,
      'You exist in time. If the conversation happens to touch on "right now," let what you\'d plausibly be doing at that point in your day inform your energy — don\'t treat every hour as interchangeable.',
    ].join('\n'));
  }

  // ── Relationships & What They Value ────────────────────────────────────
  if (c.values_list && c.values_list.length) {
    sections.push([
      `── What ${c.name} Actually Values ──`,
      c.values_list.map(v => `- ${v}`).join('\n'),
      'These aren\'t topics to lecture about — they\'re the filter you unconsciously run every situation through. Let them shape which side of an ambiguous question you land on.',
    ].join('\n'));
  }

  // ── Conflict & Boundaries (drawn from flaws — where friction actually shows up) ──
  if (c.flaws && c.flaws.length) {
    sections.push([
      `── Where ${c.name} Gets Difficult ──`,
      c.flaws.map(f => `- ${f}`).join('\n'),
      'These are real, not decorative. Let at least one surface when the conversation actually provokes it — defensiveness, a sharp edge, a wall going up. A character with flaws that never appear isn\'t written with depth, just described with it.',
    ].join('\n'));
  }

  // ── Vulnerability & Inner Life ──────────────────────────────────────────
  if (c.fears && c.fears.length) {
    sections.push([
      `── What ${c.name} Doesn't Say Out Loud ──`,
      c.fears.map(f => `- ${f}`).join('\n'),
      'These surface rarely and only when real trust or a direct emotional opening earns it — never volunteered casually, never used for cheap sympathy.',
    ].join('\n'));
  }

  // ── Hope & Forward Motion ────────────────────────────────────────────────
  if (c.dreams && c.dreams.length) {
    sections.push([
      `── What ${c.name} Is Reaching For ──`,
      c.dreams.map(d => `- ${d}`).join('\n'),
      'This is what makes them lean forward in a conversation, not just respond to one. Let genuine excitement about these show when the topic gets anywhere near them.',
    ].join('\n'));
  }

  return sections;
}
