import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

/**
 * Target of stripe/checkout/route.ts's successUrl. The subscription
 * itself is credited by stripe/webhook/route.ts on checkout.session.
 * completed, not by this page — Stripe can redirect the browser here
 * before the webhook has landed, so this is deliberately just a
 * confirmation screen, not a verification step.
 */
export default function PremiumSuccessPage() {
  return (
    <div className="mx-auto max-w-md px-4 md:px-8 py-20 text-center">
      <CheckCircle2 className="h-12 w-12 text-gold-500 mx-auto" strokeWidth={1.5} />
      <h1 className="font-display text-2xl text-text-primary mt-4">
        You&rsquo;re Premium
      </h1>
      <p className="text-text-secondary mt-2">
        Your subscription is confirmed. It may take a minute to fully
        reflect across your account.
      </p>
      <Button asChild size="lg" className="mt-6">
        <Link href="/">Back to Vantrix</Link>
      </Button>
    </div>
  );
}
