import type { Metadata } from "next";
import { PublicHeader } from "@/components/public/public-header";

export const metadata: Metadata = {
  title: "Careers | Vantrix",
  description: "Open roles at Vantrix.",
};

export default function CareersPage() {
  return (
    <div className="min-h-screen bg-base">
      <PublicHeader />
      <main className="max-w-2xl mx-auto px-4 md:px-8 py-16">
        <h1 className="font-display text-3xl text-text-primary">Careers</h1>
        <p className="mt-6 text-[15px] leading-relaxed text-text-secondary">
          We don&apos;t have open roles listed here yet. If you&apos;re
          interested in working on AI companion systems — relationship
          modeling, memory, safety, or product — reach out directly at{" "}
          <a
            href="mailto:careers@vantrix.ink"
            className="text-gold-400 hover:text-gold-300"
          >
            careers@vantrix.ink
          </a>{" "}
          and tell us what you&apos;d want to work on.
        </p>
      </main>
    </div>
  );
}
