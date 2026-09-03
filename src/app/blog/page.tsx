import type { Metadata } from "next";
import { PublicHeader } from "@/components/public/public-header";

export const metadata: Metadata = {
  title: "Blog | Vantrix",
  description: "Updates and writing from the Vantrix team.",
};

export default function BlogPage() {
  return (
    <div className="min-h-screen bg-base">
      <PublicHeader />
      <main className="max-w-2xl mx-auto px-4 md:px-8 py-16">
        <h1 className="font-display text-3xl text-text-primary">Blog</h1>
        <p className="mt-6 text-[15px] leading-relaxed text-text-secondary">
          Nothing published yet — check back soon, or follow product updates
          from inside the app.
        </p>
      </main>
    </div>
  );
}
