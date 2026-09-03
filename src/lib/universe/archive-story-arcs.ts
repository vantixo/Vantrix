/**
 * Archive of Echoes — Act-Based Story Arcs
 *
 * Real per-chapter narrative content for the five world_stories rows seeded
 * by 20260825_archive_of_echoes_universe_integration.sql (story_key
 * 'act-1-awakening' … 'act-5-beyond-destiny'). story-engine.ts's
 * tickStories() looks a story up by story_key here and writes the matching
 * chapter's text into `description` when it advances — so the "Ongoing
 * World Stories" section of a companion's prompt (formatActiveStoriesForPrompt)
 * always shows real, specific prose instead of a generic placeholder that
 * never changes.
 *
 * Follows the mythology expansion doc's own Act structure (Part I, "Why
 * This Structure Serves the Campaign") — each Act's five chapters trace
 * that Act's arc from opening beat to the hinge that sets up the next Act.
 * Nothing here overwrites or contradicts an existing companion secret,
 * relationship stage, or ending — it's the connective tissue between them.
 */

export interface ArchiveChapter {
  chapter: 1 | 2 | 3 | 4 | 5;
  text:    string;
}

export interface ArchiveStoryArc {
  story_key: string;
  title:     string;
  chapters:  ArchiveChapter[];
}

export const ARCHIVE_STORY_ARCS: Record<string, ArchiveStoryArc> = {

  'act-1-awakening': {
    story_key: 'act-1-awakening',
    title: 'Act I — Awakening',
    chapters: [
      { chapter: 1, text: 'Someone new keeps finding their way to the Archive\'s outer wings, the way people always eventually do. Aurelian has stopped assuming it means nothing.' },
      { chapter: 2, text: 'New arrivals keep finding their way to the Archive\'s outer wings. Nyx has started charging a toll for directions that used to be free — a joke, she insists, though the coin is real.' },
      { chapter: 3, text: 'Word has reached the Crossroads that someone is asking too many honest questions for a newcomer. Vesper Quinn is charging extra to pretend she hasn\'t heard.' },
      { chapter: 4, text: 'Mira Glass says the net showed her the same new face in three different reflections this week. She hasn\'t decided whether that\'s a warning or just what happens to anyone who stays long enough to be seen.' },
      { chapter: 5, text: 'The outer wings have quietly agreed, without ever saying so aloud, that whoever keeps arriving is worth watching rather than warning off. Aurelian calls it curiosity. Nyx calls it the moment the toll goes up.' },
    ],
  },

  'act-2-forgotten-empires': {
    story_key: 'act-2-forgotten-empires',
    title: 'Act II — Forgotten Empires',
    chapters: [
      { chapter: 1, text: 'The Drowned Court has sent a formal inquiry to the Long Sky Circle for the first time in longer than either keeps count of. Neither will say what it concerns.' },
      { chapter: 2, text: 'Three Wings have quietly reopened correspondence that had gone cold for a generation. Nobody is calling it diplomacy yet.' },
      { chapter: 3, text: 'Seraphine Vale\'s maps have started disagreeing with the Ash Camps\' own boundary records by a matter of inches. Orion Black says inches are how everything starts.' },
      { chapter: 4, text: 'Astra Nocturne gave a warning to someone in the Long Sky Circle this week and, for once, was believed immediately. Lyra says that\'s almost worse — it means people are finally frightened enough to listen.' },
      { chapter: 5, text: 'The forgotten empires are starting to remember they were once neighbors, not just ruins. What they\'re rebuilding isn\'t peace exactly — it\'s closer to a shared understanding of what they\'re each afraid of losing next.' },
    ],
  },

  'act-3-war-of-lost-names': {
    story_key: 'act-3-war-of-lost-names',
    title: 'Act III — War of Lost Names',
    chapters: [
      { chapter: 1, text: 'Voss\'s open letter has reached every Wing. The Ledger-Bound has not responded publicly. Everyone is reading that silence differently.' },
      { chapter: 2, text: 'Cassian Rune has been seen at the Research Wing twice this month, officially to consult the archives. Aurelian has not asked him about it directly, which Cassian finds more unsettling than if he had.' },
      { chapter: 3, text: 'The Storm Wall Garrison has doubled its watch on the corridor connecting to the Research Wing. Valeria Storm says it\'s routine. Nobody who knows her believes that\'s the whole reason.' },
      { chapter: 4, text: 'A name-jar went missing from the Wing of Hidden Names this week — the first theft from that vault in longer than the vault has existed. The Name-Keepers suspect the Reclamation. The Reclamation has not denied it.' },
      { chapter: 5, text: 'The War of Lost Names has stopped being a disagreement about doctrine and started being a question of who gets to decide what the Archive remembers at all. Nobody has drawn a weapon. Nobody thinks that\'s the form this war will take.' },
    ],
  },

  'act-4-prime-memory': {
    story_key: 'act-4-prime-memory',
    title: 'Act IV — The Prime Memory',
    chapters: [
      { chapter: 1, text: 'Aurelian knows where a fragment of the Prime Memory is. He has told no one. Cassian is close enough to guess.' },
      { chapter: 2, text: 'The Archivist Child recited, without being asked, the details of an empire no living Echo remembers falling. Three Wings have since sent scholars to ask it to say that again. It hasn\'t.' },
      { chapter: 3, text: 'Cassian Rune has started asking Aurelian questions with answers he clearly already suspects. Aurelian has started answering them, which frightens Cassian more than the silence did.' },
      { chapter: 4, text: 'The Nameless One was seen — or something that everyone present later agreed must have been seen — standing exactly where the fragment of the Prime Memory is kept. No alarm was raised. Nobody can explain why not.' },
      { chapter: 5, text: 'Every Wing\'s creation myth is starting to look, up close, like the same story told from a different window. What that means for the Wings that have spent generations certain their myth was the true one has not yet been decided by anyone.' },
    ],
  },

  'act-5-beyond-destiny': {
    story_key: 'act-5-beyond-destiny',
    title: 'Act V — Beyond Destiny',
    chapters: [
      { chapter: 1, text: 'The question has not been asked out loud yet: whether the Unwritten should stay fractured into many stories, or be allowed to become one again.' },
      { chapter: 2, text: 'The Ferryman has started answering a question nobody asked him — what happens to a Wing\'s Echoes if their story stops being told separately. He always stops before finishing the answer.' },
      { chapter: 3, text: 'Voss has begun arguing, quietly and to fewer people than before, that unity might cost more than it saves. It\'s the first position he\'s taken that doesn\'t sound entirely certain.' },
      { chapter: 4, text: 'Aurelian has not said which way he leans. Everyone assumes he has an answer. Nobody, including the people closest to him, is sure that\'s true anymore.' },
      { chapter: 5, text: 'Whatever gets decided about the Unwritten, every Wing has quietly agreed on one thing: it won\'t be decided by any of them alone. Whoever it falls to will be someone who has actually been paying attention.' },
    ],
  },
};

export function getArchiveChapterText(storyKey: string, chapter: number): string | null {
  const arc = ARCHIVE_STORY_ARCS[storyKey];
  if (!arc) return null;
  const found = arc.chapters.find(c => c.chapter === chapter);
  return found?.text ?? null;
}
