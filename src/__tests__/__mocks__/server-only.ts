// Test-only stub for the `server-only` package.
//
// The real package (node_modules/server-only) throws unconditionally when
// resolved outside the "react-server" bundler condition. Next.js's webpack
// config sets that condition so the guard works as intended in app code;
// vitest resolves plain Node `exports` and has no such condition, so the
// real package would throw the moment any test transitively imported a
// module that does `import 'server-only'` — not a real server/client
// violation, just an environment mismatch. This file is aliased in place
// of the real package for the test run only (see vitest.config.ts).
export {};
