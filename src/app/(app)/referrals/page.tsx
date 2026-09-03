import { ReferralsDashboard } from "@/components/referrals/referrals-dashboard";

export const dynamic = "force-dynamic";

export default function ReferralsPage() {
  return (
    <div className="mx-auto max-w-lg px-4 md:px-8 py-8">
      <h1 className="font-display text-xl text-text-primary mb-1">Referrals</h1>
      <p className="text-sm text-text-secondary mb-6">
        Invite friends and earn rewards when they join.
      </p>
      <ReferralsDashboard />
    </div>
  );
}
