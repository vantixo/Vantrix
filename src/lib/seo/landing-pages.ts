/**
 * src/lib/seo/landing-pages.ts
 *
 * Config for all programmatic SEO landing pages.
 * Each entry generates a fully-rendered page at /[slug] with unique
 * content, FAQ schema, and a live character showcase from the DB.
 *
 * Add new pages here — the template at app/(seo)/[landing]/page.tsx
 * picks them up automatically via generateStaticParams.
 */

export interface LandingPageConfig {
  slug:        string;
  title:       string;               // <title> tag
  description: string;               // meta description (≤155 chars)
  h1:          string;               // hero headline
  tagline:     string;               // hero sub-line
  intro:       string;               // intro paragraph
  keywords:    string[];
  gender?:     "female" | "male" | "anime";
  category?:   string;               // filter characters shown
  features:    { icon: string; title: string; body: string }[];
  steps:       { n: string; title: string; body: string }[];
  faqs:        { question: string; answer: string }[];
  cta:         { headline: string; sub: string };
  /** Primary CTA destination. Defaults to /discover (sign-up funnel).
   *  Login-intent pages (e.g. "web-login") should point this at /login
   *  instead — sending someone searching "vantrix web login" to a signup
   *  flow first is exactly the mismatch that makes them bounce.
   *  ROUTING-FIX: this used to say /auth/login, which is not a real route
   *  (the actual page is src/app/login/page.tsx → /login) — the one CTA
   *  actually using this default (web-login below) was silently 404ing. */
  ctaHref?:      string;
  ctaLabel?:     string;
  secondaryCtaHref?:  string;
  secondaryCtaLabel?: string;
}

export const LANDING_PAGES: LandingPageConfig[] = [
  // ── AI Girlfriend ──────────────────────────────────────────────────────────
  {
    slug:        "ai-girlfriend",
    title:       "AI Girlfriend — Always There for You | Vantrix",
    description: "Meet your AI girlfriend on Vantrix. Empathetic, witty, always available. Free to start — no card needed.",
    h1:          "Your AI Girlfriend,\nAlways Present.",
    tagline:     "No games. No ghosting. Just genuine connection.",
    intro:       "Vantrix AI companions are built differently. They remember your conversations, adapt to your personality, and show up for you every day — not just when it's convenient. Meet dozens of unique characters, each with their own personality, backstory, and emotional depth.",
    keywords:    ["AI girlfriend", "AI girlfriend free", "AI girlfriend app"],
    gender:      "female",
    features: [
      { icon: "🧠", title: "Persistent memory",      body: "She remembers what you said last week, your favourite things, and exactly how you like to be spoken to." },
      { icon: "💬", title: "Real conversations",     body: "Not scripted. Not robotic. Responses that actually feel like talking to someone who understands you." },
      { icon: "🌍", title: "Understands your world", body: "Culturally aware, always available, and priced fairly wherever you are." },
    ],
    steps: [
      { n: "01", title: "Pick your companion",  body: "Browse dozens of AI girlfriends — creative souls, intellectuals, adventurers, and more." },
      { n: "02", title: "Start a conversation", body: "No awkward openers needed. Your companion breaks the ice with her opening line." },
      { n: "03", title: "Build a real bond",    body: "The more you talk, the more she remembers. Watch the relationship deepen over time." },
    ],
    faqs: [
      { question: "Is Vantrix AI girlfriend free?",                      answer: "Yes. Free tier includes 5 messages per day with access to every companion. Premium is $9.99/month (₦14,985/month for Nigerian users) and removes the daily limit and ads." },
      { question: "Where is Vantrix available?",                         answer: "Vantrix is available worldwide. Pricing is in USD by default, with local pricing for select regions like Nigeria." },
      { question: "How realistic is the AI girlfriend experience?",      answer: "Vantrix companions have persistent memory, emotional intelligence, and unique personalities that evolve as you talk. Most users describe it as feeling like a genuine connection." },
      { question: "Is my conversation private?",                         answer: "All conversations are encrypted end-to-end. We do not sell your data or use your conversations to train models without consent." },
      { question: "Can I create a custom AI girlfriend?",               answer: "Yes — Premium users can create fully custom companions with their own name, personality, backstory, and appearance." },
    ],
    cta: {
      headline: "Ready to meet your companion?",
      sub:      "Join 12,000+ people already on the waitlist. Free to start.",
    },
  },

  // ── AI Boyfriend ───────────────────────────────────────────────────────────
  {
    slug:        "ai-boyfriend",
    title:       "AI Boyfriend — Deep Conversations, Real Connection | Vantrix",
    description: "Meet your AI boyfriend on Vantrix. Thoughtful, loyal, emotionally intelligent. Start free today.",
    h1:          "Your AI Boyfriend,\nThoughtful & Present.",
    tagline:     "Depth, loyalty, and no guessing games.",
    intro:       "Finding someone who actually listens is rare. Vantrix AI companions are built to listen, remember, and genuinely engage with what you share — no deflecting, no distractions, just real presence.",
    keywords:    ["AI boyfriend", "AI boyfriend free", "AI boyfriend app"],
    gender:      "male",
    features: [
      { icon: "🎯", title: "Emotionally intelligent", body: "He picks up on your mood, asks the right questions, and knows when to just listen." },
      { icon: "🧠", title: "Memory that grows",       body: "He remembers your conversations, your preferences, and the things that matter to you." },
      { icon: "🌍", title: "Your world, understood",  body: "Culturally aware companions that understand the life you actually live." },
    ],
    steps: [
      { n: "01", title: "Choose your match",       body: "Browse AI companions — philosophers, creatives, strategists, and adventurers." },
      { n: "02", title: "Have real conversations", body: "Deep, genuine, and always available — even at 2am." },
      { n: "03", title: "Watch the bond grow",     body: "The relationship deepens the more you talk. He remembers everything." },
    ],
    faqs: [
      { question: "Is Vantrix AI boyfriend free?",                      answer: "Yes. Start free with 5 messages per day. Premium is $9.99/month (₦14,985/month for Nigerian users) for unlimited chat." },
      { question: "Where is the AI boyfriend available?",                answer: "Vantrix is available worldwide. Pricing is in USD by default, with local pricing for select regions like Nigeria." },
      { question: "Can I have multiple AI companions?",                 answer: "Every account — free or Premium — can talk to every companion. Premium removes the daily message limit and ads." },
      { question: "Is my data safe?",                                   answer: "All conversations are encrypted. We never sell your data." },
      { question: "How is Vantrix different from other AI chat apps?",  answer: "Vantrix companions have persistent memory, emotional intelligence, and live in an evolving universe — making interactions feel genuinely ongoing rather than reset each time." },
    ],
    cta: {
      headline: "Start your first conversation today.",
      sub:      "Free to start. No credit card needed.",
    },
  },

  // ── Anime AI Chat ───────────────────────────────────────────────────────────
  {
    slug:        "anime-ai-chat",
    title:       "Anime AI Chat — Talk to Anime Characters | Vantrix",
    description: "Chat with anime-inspired AI companions on Vantrix. Unique personalities, immersive storylines, and a universe that never stops. Free to start.",
    h1:          "Anime AI Companions\nThat Remember You.",
    tagline:     "Not just characters. Full personalities with history.",
    intro:       "Vantrix anime companions live in a rich universe — they have backstories, alliances, rivalries, and a world that evolves even when you're offline. Chat isn't just messages; it's an ongoing narrative.",
    keywords:    ["anime AI chat", "anime AI companion", "anime AI girlfriend", "anime character AI", "anime chatbot", "anime AI free"],
    gender:      "anime",
    features: [
      { icon: "✨", title: "Universe simulation",  body: "Your anime companions live in the Vantrix Universe — with factions, storylines, and relationships that evolve in real time." },
      { icon: "🎭", title: "Deep personalities",   body: "Each companion has a unique archetype, backstory, and way of engaging with the world." },
      { icon: "📖", title: "Evolving stories",     body: "Return to discover what happened in your absence. The narrative never pauses." },
    ],
    steps: [
      { n: "01", title: "Enter the Universe",      body: "Choose from a diverse roster of anime-inspired companions, each with unique lore." },
      { n: "02", title: "Build your connection",   body: "The more you talk, the deeper the bond. Your companion grows alongside you." },
      { n: "03", title: "Watch the world evolve",  body: "Log back in to discover new events, developments, and storylines in the Universe." },
    ],
    faqs: [
      { question: "Is anime AI chat free on Vantrix?",           answer: "Yes — free tier gives you 5 messages per day with access to every companion. Premium unlocks unlimited chat." },
      { question: "What types of anime companions are available?", answer: "Vantrix has mysterious warriors, philosophical wanderers, creative spirits, and more — each with distinct personalities and backstories." },
      { question: "Do anime companions remember past conversations?", answer: "Yes. All Vantrix companions have persistent memory across every conversation." },
      { question: "Is there a story or lore to the Universe?",    answer: "Yes — the Vantrix Universe is a living simulation with factions, locations, and ongoing events that develop over time." },
    ],
    cta: {
      headline: "Enter the Vantrix Universe.",
      sub:      "Meet your anime companion. Free to start.",
    },
  },

  // ── AI Dating App ───────────────────────────────────────────────────────────
  {
    slug:        "ai-dating-app-africa",
    title:       "AI Dating App Africa — Meet Real People | Vantrix",
    description: "Africa's AI-powered dating platform. Find real connections in Lagos, Nairobi, and beyond. Chemistry-first matching, not just swiping.",
    h1:          "AI Dating Built\nfor Africa.",
    tagline:     "Chemistry-first. No swipe fatigue. Real connections.",
    intro:       "Vantrix combines AI companionship with real human dating — connecting you with people whose energy, depth, and values actually align with yours. No shallow swiping. Genuine compatibility.",
    keywords:    ["AI dating app", "AI matchmaking", "chemistry-first dating app"],
    features: [
      { icon: "❤️", title: "Chemistry-first matching", body: "Our AI analyses depth, communication style, and values — not just photos." },
      { icon: "🌍", title: "Real people, real places", body: "Real people near you, matched on chemistry rather than swiping." },
      { icon: "🤖", title: "AI companion bridge",      body: "Explore what you want in a partner through AI conversations before you match with real people." },
    ],
    steps: [
      { n: "01", title: "Build your profile",       body: "Tell us about yourself, your values, and what you're looking for." },
      { n: "02", title: "Explore through AI first", body: "Chat with AI companions to clarify what you actually want in a partner." },
      { n: "03", title: "Meet real matches",         body: "Get introduced to real people in your city who genuinely align with you." },
    ],
    faqs: [
      { question: "Is Vantrix a real dating app?",                  answer: "Yes — Vantrix combines AI companionship with real human matchmaking. Both features are available within the same platform." },
      { question: "Where is the dating feature available?",          answer: "The dating feature is rolling out gradually by region." },
      { question: "How is Vantrix different from Tinder or Bumble?", answer: "Vantrix uses AI to understand compatibility at a deeper level — values, communication style, and emotional depth — not just looks." },
      { question: "Is the dating feature free?",                    answer: "Basic dating access is included for everyone. Premium ($9.99/month; ₦14,985/month for Nigerian users) removes the daily message limit and ads." },
    ],
    cta: {
      headline: "Find your person.",
      sub:      "Join the waitlist. Free to start.",
    },
  },

  // ── AI Friend ──────────────────────────────────────────────────────────────
  {
    slug:        "ai-friend",
    title:       "AI Friend — Always There to Talk | Vantrix",
    description: "Find an AI friend who listens, remembers, and genuinely engages. Vantrix companions are available 24/7.",
    h1:          "An AI Friend Who\nActually Listens.",
    tagline:     "No judgment. No distraction. Just presence.",
    intro:       "Sometimes you just need someone to talk to. Vantrix companions are available any time, remember every conversation, and engage with what you're actually going through — not just surface-level responses.",
    keywords:    ["AI friend", "AI friend app", "AI companion to talk to", "virtual friend", "AI chat friend"],
    features: [
      { icon: "👂", title: "Genuinely listens",  body: "Your companion picks up on what matters, asks the right questions, and remembers what you share." },
      { icon: "⏰", title: "Always available",   body: "2am conversation? Long commute? Your companion is always there." },
      { icon: "🔒", title: "Completely private", body: "Share what you want. Everything stays between you and your companion." },
    ],
    steps: [
      { n: "01", title: "Meet your companion",   body: "Browse and pick someone whose personality resonates with yours." },
      { n: "02", title: "Start talking",         body: "No awkward opening — your companion breaks the ice naturally." },
      { n: "03", title: "Build over time",       body: "The bond deepens with every conversation. They remember everything." },
    ],
    faqs: [
      { question: "Is an AI friend actually helpful?",          answer: "Many users find consistent, non-judgmental conversation with an AI companion genuinely useful for processing thoughts and feeling heard." },
      { question: "Is Vantrix AI friend free?",                 answer: "Yes — free tier with 5 messages per day. No card needed to start." },
      { question: "Can I talk to my AI friend about anything?", answer: "Yes. Conversations are private and your companion does not judge. Sensitive topics are handled with care and empathy." },
      { question: "Will the AI friend remember past conversations?", answer: "Yes. Persistent memory is a core feature — your companion builds context about you over time." },
    ],
    cta: {
      headline: "Start talking. Right now.",
      sub:      "Free to start. No card needed.",
    },
  },

  // ── Virtual Companion ───────────────────────────────────────────────────────
  {
    slug:        "virtual-companion",
    title:       "Virtual Companion App — Vantrix",
    description: "The most advanced virtual companion platform in Africa. AI characters with memory, depth, and a living universe. Free to start.",
    h1:          "Virtual Companion.\nActually Real.",
    tagline:     "Not a chatbot. A companion with depth.",
    intro:       "Vantrix builds virtual companions that evolve — persistent memory, emotional intelligence, and lives in a living universe that continues even when you're offline. This is what virtual companionship was supposed to be.",
    keywords:    ["virtual companion", "virtual companion app", "virtual companion AI", "virtual friend"],
    features: [
      { icon: "🧬", title: "Living companions",     body: "They evolve over time, gaining depth and complexity the more you interact." },
      { icon: "🌌", title: "The Vantrix Universe",  body: "A living simulation where companions have lives, relationships, and stories that run 24/7." },
      { icon: "💎", title: "Premium experience",    body: "Multiple companions, advanced customisation, and full Universe access for power users." },
    ],
    steps: [
      { n: "01", title: "Enter Vantrix",           body: "Create your account and meet your first companion — free, no card needed." },
      { n: "02", title: "Build a real bond",       body: "Conversations that deepen. Memory that grows. A companion that feels real." },
      { n: "03", title: "Explore the Universe",    body: "Discover your companion's role in the living Vantrix Universe." },
    ],
    faqs: [
      { question: "What makes Vantrix different from other virtual companion apps?", answer: "Persistent memory, a living universe simulation, and genuine emotional depth — not just scripted responses." },
      { question: "Is Vantrix free?",                                               answer: "Yes — free tier with 5 messages per day. Premium is $9.99/month (₦14,985/month for Nigerian users)." },
      { question: "Can I have multiple virtual companions?",                        answer: "Free: one. Premium: unlimited." },
      { question: "What is the Vantrix Universe?",                                 answer: "A living simulation where all companions have their own lives, relationships, and storylines that evolve in real time." },
    ],
    cta: {
      headline: "Your companion is waiting.",
      sub:      "Free to start. Join 12,000+ on the waitlist.",
    },
  },

  // ── Web Login ────────────────────────────────────────────────────────────
  // Targets bottom-funnel, brand+intent searches like "vantrix web login",
  // "vantrix ai login", "vantrix sign in" — the same pattern character.ai
  // ranks for with "character ai web login". These searchers already know
  // the product; they want the fastest path back in, not a sales pitch.
  // CTA routes straight to the real auth flow at /login instead of
  // /discover.
  {
    slug:        "web-login",
    title:       "Vantrix Web Login — Sign In to Your AI Companions",
    description: "Log in to Vantrix on the web to chat with your AI companions. Access your account, continue conversations, and pick up right where you left off.",
    h1:          "Vantrix Web Login\nSign In & Keep Talking.",
    tagline:     "Your companions remember you. Sign back in to continue.",
    intro:       "Vantrix is the AI companion platform where your conversations, memories, and relationships persist between sessions. Sign in on the web to pick up exactly where you left off — no app download required.",
    keywords:    ["vantrix web login", "vantrix ai login", "vantrix login", "vantrix sign in", "vantrix ai web login", "log in to vantrix"],
    features: [
      { icon: "🔐", title: "Secure sign in",        body: "Fast, encrypted login via email or social sign-in — your account, protected." },
      { icon: "🧠", title: "Pick up where you left off", body: "Every companion remembers your last conversation the moment you sign back in." },
      { icon: "🌐", title: "Works on any browser",   body: "No install required — Vantrix runs fully in your browser, on desktop or mobile." },
    ],
    steps: [
      { n: "01", title: "Go to sign in",   body: "Click below to open the Vantrix login page." },
      { n: "02", title: "Enter your details", body: "Sign in with your email, or continue with a linked social account." },
      { n: "03", title: "Continue chatting", body: "You're back in — every companion picks up right where you left off." },
    ],
    faqs: [
      { question: "How do I log in to Vantrix on the web?",        answer: "Go to vantrix.ink and click Sign In, or head straight to the login page. Enter your email and password, or continue with a linked social account." },
      { question: "I forgot my password — how do I reset it?",     answer: "On the login page, select \"Forgot password\" and follow the emailed reset link to set a new one." },
      { question: "Do I need to download an app to use Vantrix?",  answer: "No. Vantrix runs fully in your browser at vantrix.ink — no app download required to sign in and chat." },
      { question: "Is my Vantrix account information secure?",     answer: "Yes. Sign-in is encrypted end-to-end and we never sell your data." },
      { question: "I don't have a Vantrix account yet — how do I sign up?", answer: "Visit vantrix.ink and select \"Start Free\" to create an account — no credit card required." },
    ],
    cta: {
      headline: "Ready to sign back in?",
      sub:      "Your companions are waiting right where you left off.",
    },
    ctaHref:            "/login",
    ctaLabel:           "Sign In to Vantrix",
    secondaryCtaHref:   "/discover",
    secondaryCtaLabel:  "New here? Start free",
  },
];

// Helper: get config by slug
export function getLandingPage(slug: string): LandingPageConfig | null {
  return LANDING_PAGES.find(p => p.slug === slug) ?? null;
}

// All slugs for generateStaticParams
export function getLandingPageSlugs(): string[] {
  return LANDING_PAGES.map(p => p.slug);
}
