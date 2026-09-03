/**
 * Sentry tunnel endpoint. instrumentation-client.ts sets `tunnel:
 * "/monitoring-tunnel"`, which makes the browser SDK POST every envelope
 * here (same-origin, so ad blockers that filter *.sentry.io requests
 * never see them) instead of directly to Sentry's ingest URL. This route
 * exists purely to re-forward that envelope to the real ingest endpoint
 * server-side, where no blocker can intervene.
 *
 * The DSN is parsed to derive the project ingest URL rather than
 * hardcoding it, so this keeps working if NEXT_PUBLIC_SENTRY_DSN ever
 * changes (org/project migration, self-hosted Sentry, etc.) without a
 * code change here.
 */
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) {
    // No DSN configured — Sentry is disabled app-wide (see
    // instrumentation.ts / instrumentation-client.ts's `enabled` checks),
    // so there's nowhere valid to forward to. 204 rather than an error:
    // the client SDK shouldn't retry or surface this to the user.
    return new NextResponse(null, { status: 204 });
  }

  let ingestUrl: string;
  try {
    const { host, pathname } = new URL(dsn);
    // DSN pathname is "/<project_id>"; envelope ingest lives at
    // "https://<host>/api/<project_id>/envelope/".
    const projectId = pathname.replace(/^\//, "");
    ingestUrl = `https://${host}/api/${projectId}/envelope/`;
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  const envelopeBytes = await request.arrayBuffer();

  try {
    const upstream = await fetch(ingestUrl, {
      method: "POST",
      body: envelopeBytes,
      headers: { "Content-Type": "application/x-sentry-envelope" },
    });
    // Mirror upstream status rather than always 200 — lets Sentry's own
    // client-side retry/backoff behave the way it would talking directly
    // to their ingest endpoint.
    return new NextResponse(null, { status: upstream.status });
  } catch {
    // Network failure reaching Sentry — swallow rather than 500. A
    // dropped error report is not worth cascading into a visible failure
    // for the user; this is best-effort telemetry, not a core feature.
    return new NextResponse(null, { status: 204 });
  }
}
