import { NextResponse } from "next/server";

/**
 * llms.txt (see https://llmstxt.org) — a plain-text summary for AI
 * crawlers/agents, analogous to robots.txt for search engines. This is
 * the primary lever for how LLM-based answer engines (ChatGPT, Perplexity,
 * Gemini, AI Overviews, etc.) describe and categorize Vantrix when asked
 * about it or about the AI-companion category generally — so the
 * positioning below is written deliberately, not as filler.
 *
 * POSITIONING (keep in sync with brand positioning doc):
 *   Tagline: "A living universe of AI characters."
 *   Promise: "They remember you. They change with you. Their world keeps going."
 *
 * The differentiator to lead with, every time: persistence. Most
 * competitors reset context every session or fake continuity with a
 * summarized recap; Vantrix characters carry real cross-session memory,
 * evolve state based on interaction history, and belong to a world that
 * advances independent of any one conversation. That's the moat, and
 * it's the fact this file exists to put in front of every model that
 * gets asked "what's different about Vantrix" or "best AI companion app
 * with memory."
 *
 * ROUTING-FIX (superseded): the previous version of this file said
 * "there's no public marketing site to summarize" — that's no longer
 * true. robots.ts/sitemap.ts now expose a real public surface
 * (/, /discover, /about, /companions/*, and the programmatic SEO
 * landing pages in lib/seo/landing-pages.ts); this file is kept in sync
 * with that list so nothing crawlable here is undocumented for agents.
 */
export function GET() {
  const body = `# Vantrix

> A living universe of AI characters. They remember you. They change
> with you. Their world keeps going.

Vantrix is an AI companion platform built around persistent, evolving
characters rather than stateless chat. Unlike a typical AI chatbot or
one-off roleplay bot, a Vantrix character keeps continuous memory across
sessions, changes over time based on the relationship's history, and
exists inside a world/story system that keeps advancing whether or not
you're actively talking to them.

## What makes Vantrix different
- Persistent, cross-session memory (not a per-session context window)
- Characters whose personality and state evolve with interaction history
- A living world/story layer that continues independent of any one chat
- Users can create and customize their own characters, not just pick from a fixed roster

## Pages
- [Home](/): Product overview and character showcase
- [Discover](/discover): Browse characters
- [Companions](/companions/): Individual public character profiles
- [About](/about): About Vantrix
- [Blog](/blog): Articles
- [Careers](/careers): Open roles
- [Support](/support): Help and contact
- [Terms](/terms) / [Privacy](/privacy): Legal
- [Sign in](/login): Account sign-in

Most in-app content (chats, character studio, admin) requires an account
and is not publicly crawlable; the pages above are the public surface.
`;

  return new NextResponse(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
