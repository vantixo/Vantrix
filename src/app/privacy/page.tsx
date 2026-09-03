import type { Metadata } from "next";
import { PublicHeader } from "@/components/public/public-header";

export const metadata: Metadata = {
  title: "Privacy Policy | Vantrix",
  description: "Vantrix Privacy Policy.",
};

const SECTIONS: { heading: string; body: string[] }[] = [
  {
    heading: "1. Information we collect",
    body: [
      "Account information you provide (email, username, date of birth for age verification), content you create or send (messages, character preferences, profile settings), and technical data (device, IP address, log data) needed to operate and secure the Service.",
    ],
  },
  {
    heading: "2. How we use it",
    body: [
      "To provide the Service — including character memory and personalization, which depend on storing your conversation history; to verify age and enforce eligibility requirements; to process payments through our payment providers; to detect abuse, fraud, and safety concerns; and to improve the Service.",
    ],
  },
  {
    heading: "3. AI processing",
    body: [
      "Your messages are processed by AI models (our own and third-party providers) to generate character responses. We retain conversation history so characters can maintain memory and continuity across sessions, consistent with the account settings you control.",
    ],
  },
  {
    heading: "4. Age verification records",
    body: [
      "We keep a record of your age-verification status and submission history separately from your general profile data, with restricted internal access, in order to enforce our 18+ requirement and mature-content gating.",
    ],
  },
  {
    heading: "5. Sharing",
    body: [
      "We share data with service providers who help us operate the Service (payment processing, hosting, AI inference, analytics) under contracts that limit their use of your data. We do not sell your personal information.",
    ],
  },
  {
    heading: "6. Data retention and deletion",
    body: [
      "We retain account and conversation data for as long as your account is active. You can request export or deletion of your data from account settings or by contacting us; some records (such as those needed for legal, security, or age-verification compliance) may be retained for a limited period after account closure as required by law.",
    ],
  },
  {
    heading: "7. Your choices",
    body: [
      "You can access, update, or delete most of your profile information directly in account settings, including your mature-content preference, which requires a verified age to enable.",
    ],
  },
  {
    heading: "8. Security",
    body: [
      "We use industry-standard safeguards (encryption in transit, access controls, audit logging) to protect your data, but no system is completely secure.",
    ],
  },
  {
    heading: "9. Cookies and similar technologies",
    body: [
      "We use essential cookies/local storage to keep you signed in and remember basic preferences (e.g. theme), and analytics cookies to understand product usage in aggregate. We do not use third-party advertising cookies or sell data collected this way. Where required by law, we'll ask for consent before setting non-essential cookies and provide a way to withdraw it.",
    ],
  },
  {
    heading: "10. Children's privacy",
    body: [
      "Vantrix is strictly an 18+ Service. We do not knowingly collect personal information from anyone under 18, and accounts found to belong to a minor are terminated and their data deleted. If you believe a minor has created an account or provided us information, contact us immediately using the details in Section 15 and we will investigate and remove it.",
    ],
  },
  {
    heading: "11. Legal basis for processing (EU/UK/EEA users)",
    body: [
      "Where GDPR or the UK GDPR applies, we process your data on the following bases: performance of a contract (providing the Service you signed up for), legitimate interests (fraud/abuse prevention, product improvement, security — balanced against your rights), consent (e.g. optional marketing communications, non-essential cookies), and legal obligation (e.g. responding to lawful requests, tax/accounting records). You can withdraw consent-based processing at any time without affecting processing already carried out.",
    ],
  },
  {
    heading: "12. US state privacy rights",
    body: [
      "Vantrix is operated from the United States, and US law is our primary compliance framework. If you are a resident of California, Colorado, Connecticut, Virginia, or another state with a comprehensive privacy law, you may have the right to know what personal information we hold about you, request its deletion or correction, opt out of certain uses (including targeted advertising or profiling, where applicable), and not be discriminated against for exercising these rights. Submit these requests through account settings or by contacting us; we will verify your identity before acting on a request.",
      "We do not sell personal information, and we do not share it for cross-context behavioral advertising as those terms are defined under California and similar state laws. Where applicable, we honor the Global Privacy Control (GPC) as a valid opt-out signal for browsers that send it.",
    ],
  },
  {
    heading: "13. Automated decisions and profiling",
    body: [
      "We use automated systems for content moderation and safety screening (e.g. detecting policy-violating content or signs of crisis risk) and for basic fraud/abuse detection on accounts and payments. These systems can flag or restrict an account, but a human reviews contested moderation and safety-suspension decisions on request — contact us if you believe an automated action was made in error.",
    ],
  },
  {
    heading: "14. International users",
    body: [
      "Vantrix is available to users outside the United States, and this Service is usable from other countries. If you access Vantrix from outside the US, your information will be transferred to and processed in the United States, whose data-protection laws may differ from those of your home country. Users in the EU/EEA, UK, or other jurisdictions with their own data-protection regime may have additional rights under that law; contact us if you'd like to exercise them.",
    ],
  },
  {
    heading: "15. Changes to this policy",
    body: [
      "We may update this policy from time to time. Material changes will be communicated through the app or by email before they take effect.",
    ],
  },
  {
    heading: "16. Contact",
    body: [
      "Questions about this policy, or to submit an access/deletion/correction request: vantrix@vantrix.ink. For general community discussion (not account-specific requests), you can also find us on Discord — see the link in the footer or on our Support page.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-base">
      <PublicHeader />
      <main className="max-w-2xl mx-auto px-4 md:px-8 py-16">
        <div className="mb-8 rounded-md border border-gold-500/40 bg-gold-500/5 px-4 py-3 text-sm text-gold-300">
          <strong className="font-semibold">Draft — pending legal review.</strong>{" "}
          This page is a structural placeholder written for engineering
          launch purposes. It has not been reviewed by counsel and should
          not be treated as final until it is — especially before collecting
          data from users in jurisdictions with specific requirements (e.g.
          GDPR, CCPA).
        </div>

        <h1 className="font-display text-3xl text-text-primary">
          Privacy Policy
        </h1>
        <p className="mt-2 text-sm text-text-secondary">Last updated: draft</p>

        <div className="mt-8 space-y-7">
          {SECTIONS.map((s) => (
            <section key={s.heading}>
              <h2 className="font-display text-lg text-text-primary">
                {s.heading}
              </h2>
              {s.body.map((p, i) => (
                <p
                  key={i}
                  className="mt-2 text-[15px] leading-relaxed text-text-secondary"
                >
                  {p}
                </p>
              ))}
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
