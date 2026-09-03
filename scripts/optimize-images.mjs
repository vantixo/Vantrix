// scripts/optimize-images.mjs
//
// Re-encodes/resizes the raw JPG/PNG source assets under public/images
// (and any other directory you point it at) to cut shipped repo weight and
// cold-cache/build cost.
//
// Why this is safe to run even though next/image already optimizes images
// on request: next/image's built-in optimizer (sharp, configured in
// next.config.js) resizes per-device-breakpoint *at request time*, but it
// still has to read the full original off disk/R2 first, and every
// breakpoint variant is derived from — and bounded by — that original's
// size. A 1536px-tall, 480KB source costs more to decode on every cold
// cache miss and bloats the repo/build artifact regardless of how small
// any given <Image sizes="..."> ends up rendering. Shrinking the source
// once, here, lowers that floor for every future request.
//
// What "sane" means, derived from actual usage in this codebase (see
// `sizes=` props across src/components and src/app): the largest single
// on-screen rendering context for a character/scenario image is the
// roleplay-stage backdrop and the character detail hero, both capped
// around 640-800px logical width. MAX_DIMENSION below (1280px long edge)
// covers that at 2x device-pixel-ratio with margin, without preserving
// resolution nothing in the app can actually display.
//
// Behavior:
//   - Walks the target directory recursively for .jpg/.jpeg/.png files.
//   - Resizes (preserving aspect ratio, never upscales) if the long edge
//     exceeds MAX_DIMENSION.
//   - Re-encodes JPEGs with mozjpeg at JPEG_QUALITY; re-encodes PNGs with
//     max compression.
//   - Only overwrites the original if the result is actually smaller —
//     this makes the script idempotent and safe to re-run; already-
//     optimized files are left untouched instead of risking a
//     quality/size regression.
//   - Writes to a temp file and renames over the original, so a crash
//     mid-run can't leave a half-written image on disk.
//
// The 1280px default below was derived from character-card/avatar/roleplay
// usage. Check the actual `sizes=` prop(s) for whatever directory you're
// about to run this against before trusting the default — a hero/carousel
// image inside a wide `100vw` container needs a much higher cap, or you'll
// visibly soften it on large/retina screens. Override with --max-dimension.
//
// Usage:
//   node scripts/optimize-images.mjs [directory] [--dry-run] [--max-dimension=N]
//
//   node scripts/optimize-images.mjs                                        # defaults to public/images, 1280px cap
//   node scripts/optimize-images.mjs public/images/characters
//   node scripts/optimize-images.mjs public/promos --max-dimension=1920 --dry-run

import { readdir, stat, rename, unlink } from 'node:fs/promises';
import { join, extname } from 'node:path';
import sharp from 'sharp';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const maxDimArg = args.find((a) => a.startsWith('--max-dimension='));
const MAX_DIMENSION = maxDimArg ? parseInt(maxDimArg.split('=')[1], 10) : 1280;
const targetDir = args.find((a) => !a.startsWith('--')) ?? 'public/images';
const JPEG_QUALITY = 82;
const SKIP_UNDER_BYTES = 40 * 1024; // don't bother re-encoding already-tiny assets

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(full)));
    } else if (['.jpg', '.jpeg', '.png'].includes(extname(entry.name).toLowerCase())) {
      files.push(full);
    }
  }
  return files;
}

async function optimizeOne(filePath) {
  const before = (await stat(filePath)).size;
  if (before < SKIP_UNDER_BYTES) {
    return { filePath, before, after: before, skipped: 'already small' };
  }

  const image = sharp(filePath);
  const meta = await image.metadata();
  const longEdge = Math.max(meta.width ?? 0, meta.height ?? 0);

  let pipeline = sharp(filePath);
  if (longEdge > MAX_DIMENSION) {
    pipeline = pipeline.resize({
      width: MAX_DIMENSION,
      height: MAX_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  const isPng = extname(filePath).toLowerCase() === '.png';
  const buffer = isPng
    ? await pipeline.png({ compressionLevel: 9, palette: true }).toBuffer()
    : await pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();

  if (buffer.length >= before) {
    return { filePath, before, after: before, skipped: 'already optimal' };
  }

  if (!dryRun) {
    const tmpPath = `${filePath}.tmp`;
    await sharp(buffer).toFile(tmpPath);
    await unlink(filePath);
    await rename(tmpPath, filePath);
  }

  return { filePath, before, after: buffer.length, skipped: null };
}

async function main() {
  console.log(`Scanning ${targetDir}${dryRun ? ' (dry run — no files will be modified)' : ''}...`);
  const files = await walk(targetDir);
  console.log(`Found ${files.length} image(s).\n`);

  let totalBefore = 0;
  let totalAfter = 0;
  let changed = 0;

  for (const filePath of files) {
    try {
      const result = await optimizeOne(filePath);
      totalBefore += result.before;
      totalAfter += result.after;
      if (result.skipped) {
        console.log(`  skip   ${filePath}  (${result.skipped})`);
      } else {
        changed += 1;
        const pct = (100 * (1 - result.after / result.before)).toFixed(0);
        console.log(
          `  ${dryRun ? 'would shrink' : 'shrunk'}  ${filePath}  ${(result.before / 1024).toFixed(0)}KB -> ${(result.after / 1024).toFixed(0)}KB  (-${pct}%)`,
        );
      }
    } catch (err) {
      console.error(`  ERROR  ${filePath}: ${err.message}`);
    }
  }

  const savedMB = ((totalBefore - totalAfter) / (1024 * 1024)).toFixed(2);
  console.log(
    `\n${changed}/${files.length} file(s) ${dryRun ? 'would be' : 'were'} re-encoded. Total: ${(totalBefore / (1024 * 1024)).toFixed(2)}MB -> ${(totalAfter / (1024 * 1024)).toFixed(2)}MB (saved ${savedMB}MB).`,
  );
  if (dryRun) {
    console.log('Re-run without --dry-run to apply.');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
