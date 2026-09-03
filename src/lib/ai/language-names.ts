/**
 * Shared language name table for the Response Language system.
 *
 * Split out of language-engine.ts so client components (the Settings
 * page's language picker) can import the display names/options without
 * pulling in language-engine.ts's server-only deps (redis, logger). This
 * file has zero imports — safe in both server and client bundles.
 *
 * language-engine.ts re-exports LANGUAGE_NAMES/languageName from here so
 * there is exactly one list to keep in sync, not two.
 */

export const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese',
  it: 'Italian', nl: 'Dutch', id: 'Indonesian', tr: 'Turkish', pl: 'Polish',
  vi: 'Vietnamese', tl: 'Tagalog', ro: 'Romanian', sv: 'Swedish',
  zh: 'Chinese', ja: 'Japanese', ko: 'Korean', ru: 'Russian', ar: 'Arabic',
  he: 'Hebrew', el: 'Greek', th: 'Thai', hi: 'Hindi',
};

export function languageName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code;
}

/**
 * Dropdown-ready options: 'auto' first (follows what the user types, the
 * default), then every supported override language sorted alphabetically
 * by display name.
 */
export const LANGUAGE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'auto', label: 'Auto-detect' },
  ...Object.entries(LANGUAGE_NAMES)
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([code, name]) => ({ value: code, label: name })),
];
