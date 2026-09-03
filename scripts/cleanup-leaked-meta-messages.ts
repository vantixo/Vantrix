/**
 * cleanup-leaked-meta-messages.ts
 *
 * WHY THIS EXISTS:
 * The streaming chat route persisted `fullReply` to the `messages` table
 * without ever running it through stripLeakedMeta() — only the SSE payload
 * sent to the client was cleaned (see the fix in src/app/api/chat/stream/
 * route.ts). Any turn where a provider's underlying checkpoint bled
 * classifier meta-text into the completion (e.g. "User Safety: safe
 * Response Safety: safe") got that raw text written to history verbatim,
 * and it renders as its own chat bubble on every reload from then on.
 *
 * That code path is now fixed for NEW messages. This script is the one-off
 * backfill for messages that were already written before the fix — it
 * reuses the actual stripLeakedMeta()/stripMechanismLeakThoughts() logic
 * (imported from the real module, not reimplemented) so cleanup behavior
 * is guaranteed identical to what live traffic now does.
 *
 * SAFETY:
 *   - Defaults to DRY RUN. Nothing is written unless you pass --apply.
 *   - Only ever touches role='assistant' rows.
 *   - Only updates a row if stripLeakedMeta() actually changes its content
 *     (never rewrites content that doesn't match a leak pattern).
 *   - Skips (and reports) any row that would be stripped to empty/
 *     whitespace — that indicates the entire stored message was leaked
 *     meta-text with no real reply underneath, which needs a human look
 *     rather than being silently blanked or deleted.
 *   - Paginated, so it's safe against tables with millions of rows.
 *
 * USAGE:
 *   npx tsx scripts/cleanup-leaked-meta-messages.ts            # dry run, prints a report
 *   npx tsx scripts/cleanup-leaked-meta-messages.ts --apply     # actually writes fixes
 *   npx tsx scripts/cleanup-leaked-meta-messages.ts --apply --limit 500   # cap rows touched, for a staged rollout
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { stripLeakedMeta } from '@/lib/moderation/reply-guard';

const APPLY      = process.argv.includes('--apply');
const limitFlag   = process.argv.findIndex(a => a === '--limit');
const ROW_LIMIT   = limitFlag !== -1 ? parseInt(process.argv[limitFlag + 1] ?? '', 10) : Infinity;
const PAGE_SIZE   = 500;

// Cheap pre-filter so we don't run stripLeakedMeta() (and diff) against
// every single assistant message in the table — only ones that plausibly
// contain a leak shape. This is intentionally broader/looser than
// stripLeakedMeta's own precise regex; false positives here just cost an
// extra no-op comparison, false negatives would mean a leaked row silently
// never gets checked at all.
const PREFILTER_RE = /\b(safety|moderation|policy|classification|risk\s*level|risk\s*score)\s*:/i;

interface MessageRow {
  id:      string;
  content: string;
}

async function main() {
  console.log(`[cleanup-leaked-meta] mode=${APPLY ? 'APPLY' : 'DRY RUN'} rowLimit=${ROW_LIMIT}`);

  let offset        = 0;
  let scanned        = 0;
  let candidates     = 0;
  let fixed          = 0;
  let wouldFix       = 0;
  let emptiedOut: string[] = [];
  let unchanged      = 0;

  for (;;) {
    if (scanned >= ROW_LIMIT) break;

    const { data, error } = await supabaseAdmin
      .from('messages')
      .select('id, content')
      .eq('role', 'assistant')
      .not('content', 'is', null)
      .range(offset, offset + PAGE_SIZE - 1)
      .order('id', { ascending: true });

    if (error) {
      console.error('[cleanup-leaked-meta] query failed:', error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;

    for (const row of data as MessageRow[]) {
      scanned++;
      if (scanned > ROW_LIMIT) break;

      const original = row.content;
      if (!original || !PREFILTER_RE.test(original)) continue;

      candidates++;
      const cleaned = stripLeakedMeta(original);

      if (cleaned === original) {
        unchanged++;
        continue;
      }

      if (cleaned.trim().length === 0) {
        // Entire stored message was leaked meta-text — flag for manual
        // review rather than blanking or deleting a history row.
        emptiedOut.push(row.id);
        continue;
      }

      if (APPLY) {
        const { error: updateErr } = await supabaseAdmin
          .from('messages')
          .update({ content: cleaned })
          .eq('id', row.id);
        if (updateErr) {
          console.error(`[cleanup-leaked-meta] failed to update ${row.id}:`, updateErr.message);
          continue;
        }
        fixed++;
      } else {
        wouldFix++;
        console.log(`\n[would fix] id=${row.id}`);
        console.log(`  before: ${JSON.stringify(original.slice(0, 160))}`);
        console.log(`  after:  ${JSON.stringify(cleaned.slice(0, 160))}`);
      }
    }

    offset += PAGE_SIZE;
  }

  console.log('\n─────────────────────────────────────────────');
  console.log(`scanned:            ${scanned}`);
  console.log(`prefilter matches:  ${candidates}`);
  console.log(`unchanged (no-op):  ${unchanged}`);
  console.log(APPLY ? `fixed:              ${fixed}` : `would fix:          ${wouldFix}`);
  if (emptiedOut.length > 0) {
    console.log(`\n⚠ ${emptiedOut.length} row(s) would be stripped to empty — needs manual review, NOT auto-touched:`);
    for (const id of emptiedOut) console.log(`  - ${id}`);
  }
  if (!APPLY && (wouldFix > 0 || emptiedOut.length > 0)) {
    console.log('\nRe-run with --apply to write these fixes.');
  }
}

main().catch(err => {
  console.error('[cleanup-leaked-meta] fatal:', err);
  process.exit(1);
});
