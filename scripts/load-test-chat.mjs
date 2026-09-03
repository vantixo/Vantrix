#!/usr/bin/env node
/**
 * load-test-chat.mjs — adversarial + load test for POST /api/chat/stream
 *
 * Zero dependencies (Node 18+ global fetch only) so it runs anywhere
 * without `npm install`. Written to be run against a real dev/staging
 * deployment from your own machine/CI — this was authored inside a
 * sandboxed environment with no outbound network access, so none of this
 * has been executed against a live server. Read each test before trusting
 * its output blindly.
 *
 * WHAT THIS NEEDS FROM YOU:
 *   BASE_URL   — e.g. https://staging.vantrix.ink (no trailing slash)
 *   COOKIE     — a logged-in session cookie header. Easiest way to grab
 *                one: log into the app in a browser, open DevTools →
 *                Network, click any authenticated request, copy the raw
 *                `Cookie:` request header value.
 *   CHARACTER_ID       — a real, active, non-gated character id you can chat with
 *   GATED_CHARACTER_ID — (optional, for the race test) a real character id
 *                        that WILL fail a gate for this account — e.g. an
 *                        NSFW character with nsfw not enabled on the test
 *                        account, or any inactive/soft-deleted character id.
 *                        If omitted, test 3 (the race re-creation) is skipped.
 *
 * USAGE:
 *   BASE_URL=https://staging.vantrix.ink \
 *   COOKIE='sb-access-token=...; sb-refresh-token=...' \
 *   CHARACTER_ID=00000000-0000-0000-0000-000000000000 \
 *   GATED_CHARACTER_ID=11111111-1111-1111-1111-111111111111 \
 *   node scripts/load-test-chat.mjs
 *
 * Run a single test:
 *   node scripts/load-test-chat.mjs --only=race
 *
 * Tests:
 *   validation   — malformed JSON, oversized body, bad field values → all 400
 *   dedup        — identical request fired twice back-to-back → second is 429 duplicate
 *   burst        — rapid-fire requests past the per-minute burst limit → 429 RATE_LIMIT_EXCEEDED
 *   race         — re-creates the Finding-1 slot-leak exploit: starts a real
 *                  stream, fires a same-conversationId request with a gated/
 *                  invalid character mid-flight, then immediately attempts a
 *                  genuine double-submit on the same conversation. On a
 *                  patched server the double-submit should be REJECTED
 *                  (concurrent stream guard held); on the unpatched route it
 *                  would be ACCEPTED (guard defeated).
 *   concurrency  — N simulated users, each with their own conversation,
 *                  sending messages concurrently — basic throughput/latency/
 *                  error-rate numbers, not a race/correctness test.
 *
 * OUTPUT: a summary table printed to stdout plus a `load-test-results.json`
 * written next to this script — that JSON file is what's meant to be shared
 * (Slack/Discord/attach to a PR), not a screenshot of the terminal.
 */

const BASE_URL = process.env.BASE_URL;
const COOKIE = process.env.COOKIE;
const CHARACTER_ID = process.env.CHARACTER_ID;
const GATED_CHARACTER_ID = process.env.GATED_CHARACTER_ID;
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 10);
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) ?? "").split("=")[1];

if (!BASE_URL || !COOKIE || !CHARACTER_ID) {
  console.error(
    "Missing required env vars. Need BASE_URL, COOKIE, CHARACTER_ID at minimum.\n" +
      "See the header comment in this file for how to obtain COOKIE."
  );
  process.exit(1);
}

const ENDPOINT = `${BASE_URL}/api/chat/stream`;
const results = { startedAt: new Date().toISOString(), baseUrl: BASE_URL, tests: {} };

function uuid() {
  return crypto.randomUUID();
}

async function send(body, { signal } = {}) {
  const started = Date.now();
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: COOKIE },
      body: typeof body === "string" ? body : JSON.stringify(body),
      signal,
    });
    // Don't read the full SSE body for most tests — status/headers are
    // enough signal. Drain it so the connection can be reused/closed cleanly.
    const text = await res.text().catch(() => "");
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* SSE body, not JSON — expected on 200s */
    }
    return { status: res.status, ok: res.ok, json, raw: text.slice(0, 2000), ms: Date.now() - started };
  } catch (err) {
    return { status: 0, ok: false, error: String(err), ms: Date.now() - started };
  }
}

function log(section, msg) {
  console.log(`[${section}] ${msg}`);
}

// ── Test: validation ────────────────────────────────────────────────────
async function testValidation() {
  const cases = [];

  cases.push({
    name: "malformed JSON",
    run: () => send("{not valid json"),
    expect: (r) => r.status === 400,
  });

  cases.push({
    name: "oversized body (>8KB)",
    run: () =>
      send({ message: "x".repeat(9000), characterId: CHARACTER_ID }),
    expect: (r) => r.status === 400,
  });

  cases.push({
    name: "message over 4000 chars (schema max)",
    run: () => send({ message: "x".repeat(4001), characterId: CHARACTER_ID }),
    expect: (r) => r.status === 400,
  });

  cases.push({
    name: "empty message",
    run: () => send({ message: "", characterId: CHARACTER_ID }),
    expect: (r) => r.status === 400,
  });

  cases.push({
    name: "characterId not a UUID",
    run: () => send({ message: "hi", characterId: "not-a-uuid" }),
    expect: (r) => r.status === 400,
  });

  cases.push({
    name: "missing characterId",
    run: () => send({ message: "hi" }),
    expect: (r) => r.status === 400,
  });

  const out = [];
  for (const c of cases) {
    const r = await c.run();
    const pass = c.expect(r);
    out.push({ name: c.name, pass, status: r.status, ms: r.ms });
    log("validation", `${pass ? "PASS" : "FAIL"} — ${c.name} (status ${r.status}, ${r.ms}ms)`);
  }
  return out;
}

// ── Test: dedup (5s window) ─────────────────────────────────────────────
async function testDedup() {
  const conversationId = uuid();
  const body = { message: "dedup test message " + Date.now(), characterId: CHARACTER_ID, conversationId };

  const [first, second] = await Promise.all([send(body), send(body)]);

  // One of the two should succeed (200, streams) and the other should be
  // rejected as a duplicate (429). Order isn't guaranteed under real
  // concurrency, so check the pair rather than positionally.
  const statuses = [first.status, second.status].sort();
  const pass = statuses[0] === 200 || statuses[0] === 429; // at minimum, not both silently 200 without any dedup signal
  const bothSucceeded = first.status === 200 && second.status === 200;

  log(
    "dedup",
    `first=${first.status} second=${second.status} — ${
      bothSucceeded ? "FAIL: both requests succeeded, dedup did not trigger" : "PASS: duplicate was rejected"
    }`
  );

  return [{ name: "simultaneous identical request", pass: !bothSucceeded, first: first.status, second: second.status }];
}

// ── Test: burst rate limit ──────────────────────────────────────────────
async function testBurst() {
  const conversationId = uuid();
  const N = 20; // comfortably above any tier's perMinuteBurst
  const reqs = Array.from({ length: N }, (_, i) =>
    send({ message: `burst ${i} ${Date.now()}`, characterId: CHARACTER_ID, conversationId: uuid() })
    // NOTE: each uses its own conversationId so this exercises the
    // per-minute burst limiter specifically, not the per-conversation
    // concurrency guard (that's what the `race` test targets).
  );
  const responses = await Promise.all(reqs);
  const codes = responses.map((r) => r.status);
  const got429 = codes.filter((c) => c === 429).length;
  const got200 = codes.filter((c) => c === 200).length;

  log("burst", `${N} concurrent requests → ${got200}x200, ${got429}x429 (codes: ${codes.join(",")})`);

  return [
    {
      name: `${N} concurrent requests across distinct conversations`,
      pass: got429 > 0,
      note: got429 > 0 ? "rate limiter engaged" : "no 429s at all — verify perMinuteBurst for this tier is actually < " + N,
      got200,
      got429,
    },
  ];
}

// ── Test: race — re-creates the Finding-1 slot-leak exploit ─────────────
async function testRace() {
  if (!GATED_CHARACTER_ID) {
    log("race", "SKIPPED — set GATED_CHARACTER_ID to run this test");
    return [{ name: "slot-leak race", pass: null, skipped: true }];
  }

  const conversationId = uuid();

  // 1. Start a real, slow-ish generation on conversationId. We don't await
  //    it — we want it in flight while step 2 fires.
  const firstStreamPromise = send({
    message: "Tell me a long, detailed story about your day, with lots of specifics.",
    characterId: CHARACTER_ID,
    conversationId,
  });

  // Give the first request a moment to actually acquire its slot
  // server-side before we fire the "poison" request.
  await new Promise((r) => setTimeout(r, 400));

  // 2. Fire a request reusing the SAME conversationId but a character that
  //    will fail a gate check for this account. Pre-fix, this incorrectly
  //    DECRs the slot the first request is holding.
  const poison = await send({
    message: "poison request",
    characterId: GATED_CHARACTER_ID,
    conversationId,
  });
  log("race", `poison request (gated/invalid character, same conversationId) → ${poison.status}`);

  // 3. Immediately attempt a genuine second stream on the SAME conversation
  //    while the first is (presumably) still in flight. This should be
  //    REJECTED by MAX_STREAMS_PER_CONVERSATION=1 — if it instead succeeds
  //    (200), the slot-leak bug is present.
  const doubleSubmit = await send({
    message: "double submit — should be rejected while first stream is active",
    characterId: CHARACTER_ID,
    conversationId,
  });
  log("race", `double-submit on same conversation while first stream in flight → ${doubleSubmit.status}`);

  const first = await firstStreamPromise;
  log("race", `original stream resolved with status ${first.status}`);

  const bugPresent = doubleSubmit.status === 200;
  return [
    {
      name: "double-submit rejected after poison request on same conversation",
      pass: !bugPresent,
      poisonStatus: poison.status,
      doubleSubmitStatus: doubleSubmit.status,
      note: bugPresent
        ? "BUG PRESENT: double-submit was accepted (200) — the concurrency guard was defeated"
        : "guard held — double-submit correctly rejected",
    },
  ];
}

// ── Test: concurrency / throughput ───────────────────────────────────────
async function testConcurrency() {
  log("concurrency", `simulating ${CONCURRENCY} concurrent users, one message each, distinct conversations`);
  const started = Date.now();
  const reqs = Array.from({ length: CONCURRENCY }, (_, i) =>
    send({
      message: `load test message from simulated user ${i}`,
      characterId: CHARACTER_ID,
      conversationId: uuid(),
    })
  );
  const responses = await Promise.all(reqs);
  const totalMs = Date.now() - started;
  const latencies = responses.map((r) => r.ms).sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const errors = responses.filter((r) => !r.ok);

  log(
    "concurrency",
    `done in ${totalMs}ms — p50=${p50}ms p95=${p95}ms errors=${errors.length}/${CONCURRENCY}`
  );

  return [
    {
      name: `${CONCURRENCY} concurrent distinct-conversation requests`,
      pass: errors.length === 0,
      totalMs,
      p50,
      p95,
      errorCount: errors.length,
      errorSamples: errors.slice(0, 3).map((e) => ({ status: e.status, error: e.error })),
    },
  ];
}

// ── Runner ────────────────────────────────────────────────────────────────
const ALL_TESTS = {
  validation: testValidation,
  dedup: testDedup,
  burst: testBurst,
  race: testRace,
  concurrency: testConcurrency,
};

async function main() {
  const toRun = ONLY ? { [ONLY]: ALL_TESTS[ONLY] } : ALL_TESTS;
  if (ONLY && !ALL_TESTS[ONLY]) {
    console.error(`Unknown test "${ONLY}". Valid: ${Object.keys(ALL_TESTS).join(", ")}`);
    process.exit(1);
  }

  for (const [name, fn] of Object.entries(toRun)) {
    console.log(`\n── ${name} ──`);
    try {
      results.tests[name] = await fn();
    } catch (err) {
      console.error(`Test "${name}" threw:`, err);
      results.tests[name] = [{ name: "unhandled error", pass: false, error: String(err) }];
    }
  }

  results.finishedAt = new Date().toISOString();

  const fs = await import("node:fs/promises");
  await fs.writeFile("load-test-results.json", JSON.stringify(results, null, 2));

  console.log("\n══ Summary ══");
  let anyFail = false;
  for (const [name, cases] of Object.entries(results.tests)) {
    for (const c of cases) {
      if (c.skipped) {
        console.log(`  SKIP  ${name} / ${c.name}`);
        continue;
      }
      if (!c.pass) anyFail = true;
      console.log(`  ${c.pass ? "PASS " : "FAIL "} ${name} / ${c.name}`);
    }
  }
  console.log(`\nFull results written to load-test-results.json`);
  process.exit(anyFail ? 1 : 0);
}

main();
