import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-base flex flex-col items-center justify-center px-6 text-center">
      <p className="font-display text-6xl text-gold-500 mb-3">404</p>
      <h1 className="font-display text-2xl mb-2">Page not found</h1>
      <p className="text-text-secondary mb-8 max-w-sm">
        The page you&apos;re looking for doesn&apos;t exist or may have been
        moved.
      </p>
      <Button asChild variant="primary">
        <Link href="/">Back Home</Link>
      </Button>
    </div>
  );
}
