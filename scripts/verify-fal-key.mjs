// scripts/verify-fal-key.mjs
//
// Standalone sanity check for FAL_KEY — run this after setting it in
// .env.local, before assuming Image Studio is working end to end.
//
// What it does:
//   1. Confirms FAL_KEY is present and non-empty.
//   2. Calls the exact same model generateBaseImage() in
//      src/lib/fal/lora-pipeline.ts uses (fal-ai/flux/dev) with a tiny,
//      cheap, low-step request — auth failures and zero-balance failures
//      both surface here, before you touch the UI at all.
//   3. Prints a clear PASS/FAIL with the actual error message from Fal
//      (auth errors and billing/balance errors have different messages —
//      this tells you which one you're looking at).
//
// Usage:
//   node scripts/verify-fal-key.mjs
//
// Requires: FAL_KEY set in your environment (loads .env.local automatically
// if you run it with `node --env-file=.env.local scripts/verify-fal-key.mjs`
// on Node 20.6+, or export it manually first).

// PACKAGE-FIX: this used to import '@fal-ai/serverless-client', which was
// migrated away from in lora-pipeline.ts (see that file's own DEPENDENCY
// NOTE, Phase 3 / AUDIT_FINDINGS_LOG.md) and is no longer in package.json
// or node_modules — running this script threw a bare "Cannot find module"
// before it ever got to checking the key. Switched to '@fal-ai/client',
// the same package/import style/result shape (`{ fal }`, `result.data`,
// not flat properties) every other Fal call site in this repo already uses.
import { fal } from '@fal-ai/client';

const key = process.env.FAL_KEY;

if (!key) {
  console.error('❌ FAL_KEY is not set in this shell/environment.');
  console.error('   Set it in .env.local, then either:');
  console.error('     node --env-file=.env.local scripts/verify-fal-key.mjs');
  console.error('   or export it first:');
  console.error('     export FAL_KEY=your-key && node scripts/verify-fal-key.mjs');
  process.exit(1);
}

fal.config({ credentials: key });

console.log('→ FAL_KEY is set (', key.slice(0, 6) + '…' + key.slice(-4), ')');
console.log('→ Calling fal-ai/flux/dev with a minimal test prompt...\n');

try {
  const result = await fal.subscribe('fal-ai/flux/dev', {
    input: {
      prompt: 'a single red apple on a white background, studio lighting',
      image_size: 'square',
      num_inference_steps: 4, // cheapest possible — this is a connectivity/billing check, not a quality test
      num_images: 1,
    },
    logs: false,
  });

  const url = result?.data?.images?.[0]?.url;
  if (url) {
    console.log('✅ PASS — Fal.ai accepted the request and returned an image.');
    console.log('   Image URL (temporary, expires):', url);
    console.log('\nFAL_KEY is valid and the account has usable credit.');
    console.log('Image Studio should work now — try a real generation in the app.');
  } else {
    console.log('⚠️  Request succeeded but no image URL came back. Raw response:');
    console.log(JSON.stringify(result, null, 2));
  }
} catch (err) {
  console.error('❌ FAIL — Fal.ai rejected the request.\n');
  const message = err?.message ?? String(err);
  console.error('   Error:', message);

  if (/401|403|forbidden|unauthorized|invalid.*key/i.test(message)) {
    console.error('\n   → Looks like an AUTH problem: the key itself is invalid or malformed.');
    console.error('     Double-check you copied the full key from the Fal dashboard.');
  } else if (/402|payment|balance|credit|insufficient/i.test(message)) {
    console.error('\n   → Looks like a BILLING problem: the key is valid but the account');
    console.error('     has no usable balance. Check the Fal dashboard billing page —');
    console.error('     funds sometimes take a few minutes to reflect after adding a card.');
  } else {
    console.error('\n   → Unrecognized error shape — paste this output back and we can dig in.');
  }
  process.exit(1);
}
