# Character source data (archived, not part of the build)

`canon.ts.txt` and `seeds.ts.txt` are the original TypeScript source files
that the launch character data was authored in. They are **not compiled or
imported by the app** — confirmed via full-repo grep, zero importers.

They were moved out of `src/lib/characters/` (and renamed `.ts.txt` so no
bundler/tsc can pick them up by accident) because character seeding now
happens entirely through SQL migrations, generated from these files as a
one-time step:

- `seeds.ts.txt` → `supabase/migrations/20260701_seed_launch_characters.sql`
  (CHARACTER_SEEDS + PROFESSION_SEEDS), plus the visual/image-url/gallery
  follow-up migrations (`20260714`, `20260725`, `20260726`).
- `canon.ts.txt` → `supabase/migrations/20260718_character_face_prompt_and_generation_style.sql`
  (face_prompt / physical canon backfill for the 7 canon characters).

The codegen script mentioned in the seed migration's header comment
(`scripts/_codegen-character-seed-sql.ts`) does not exist in this repo — it
was a local, one-off tool, not a build step. **The database is now the
source of truth.** If you need to add or edit a character, write a new
migration directly; don't resurrect these files unless you're deliberately
rebuilding the codegen tooling.

Kept here (not deleted) purely as reference for the prose/lore fields,
which are easier to read as TS objects than as SQL string literals.
