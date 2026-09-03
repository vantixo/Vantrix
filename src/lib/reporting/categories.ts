/**
 * Report categories — shared between the API route and UI components.
 * Kept in src/lib (not in an API route) so it can be imported from both
 * client and server without violating Next.js route module constraints.
 */
export const REPORT_CATEGORIES = [
  'inappropriate_content',
  'harmful_ai_output',
  'underage_content',
  'harassment',
  'spam',
  'impersonation',
  'other',
] as const;

export type ReportCategory = typeof REPORT_CATEGORIES[number];

export const CATEGORY_LABELS: Record<ReportCategory, string> = {
  inappropriate_content: 'Inappropriate content',
  harmful_ai_output:     'Harmful AI output',
  underage_content:      'Underage content',
  harassment:            'Harassment or bullying',
  spam:                  'Spam',
  impersonation:         'Impersonation',
  other:                 'Something else',
};

/**
 * Categories shown when reporting community posts/replies — human-authored
 * forum content, not AI output, so 'harmful_ai_output' is excluded here
 * (it stays in the full REPORT_CATEGORIES list for conversation/character
 * reports, where it's the relevant category).
 */
export const COMMUNITY_REPORT_CATEGORIES: ReportCategory[] = [
  'inappropriate_content',
  'harassment',
  'spam',
  'impersonation',
  'underage_content',
  'other',
];
