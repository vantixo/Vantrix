/**
 * bot-shield.ts — Node-runtime half of bot suspicion handling.
 *
 * Reads the x-bot-suspicion-* headers set by middleware
 * (bot-shield.edge.ts) and, above FLAG_THRESHOLD, writes a row to
 * abuse_signals for later human/AI review.
 *
 * Deliberately NOT a gate. Per product direction: no CAPTCHA at
 * signup/login, no automatic block on suspicion alone — a suspected-bot
 * request is still served normally. This only ever adds a review-queue
 * entry, fire-and-forget, so it can never slow down or fail the response
 * it's attached to.
 */
import type { NextRequest } from "next/server";
import { createHash } from "crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getClientIp } from "@/lib/network/get-client-ip";
import { logger } from "@/lib/logger";

const FLAG_THRESHOLD = 45; // matches roughly "2+ soft signals" from bot-shield.edge.ts

function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

interface FlagOptions {
  kind:    "guest_chat" | "chat" | "signup";
  userId?: string | null;
}

/**
 * Call from a route handler after you already have the NextRequest.
 * Never await this in the response path — call without awaiting so a
 * Supabase hiccup can't add latency or failure to the actual request.
 */
export function flagIfSuspicious(req: NextRequest, opts: FlagOptions): void {
  const scoreHeader   = req.headers.get("x-bot-suspicion-score");
  const reasonsHeader = req.headers.get("x-bot-suspicion-reasons");
  const score = scoreHeader ? Number(scoreHeader) : 0;

  if (!Number.isFinite(score) || score < FLAG_THRESHOLD) return;

  const reasons = reasonsHeader ? reasonsHeader.split("|").filter(Boolean) : [];
  const ipHash  = hashIp(getClientIp(req));

  Promise.resolve(
    supabaseAdmin
      .from("abuse_signals")
      .insert({
        kind:       opts.kind,
        path:       req.nextUrl.pathname,
        user_id:    opts.userId ?? null,
        ip_hash:    ipHash,
        score,
        reasons,
        user_agent: req.headers.get("user-agent"),
      })
  )
    .then(({ error }) => {
      if (error) logger.warn("bot-shield:flag-write-failed", { error: error.message });
    })
    .catch((err: unknown) => {
      logger.warn("bot-shield:flag-write-threw", { error: String(err) });
    });
}
