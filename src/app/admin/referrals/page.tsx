"use client";

import { useState, useEffect } from "react";
import { RevealGroup } from "@/components/admin/motion/reveal";
import { ReferralApplicationCard } from "@/components/admin/referral-application-card";
import { fetchReferralApplications, type ReferralApplication } from "@/lib/frontend/admin-referrals";

export default function AdminReferralsPage() {
  const [apps, setApps] = useState<ReferralApplication[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchReferralApplications()
      .then(setApps)
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-16">
      <div>
        <h2 className="font-display text-2xl mb-1">Referral Applications</h2>
        <p className="text-text-secondary text-sm">
          Dev and influencer partner requests awaiting review.
        </p>
      </div>

      {isLoading ? (
        <p className="text-text-secondary text-sm">Loading…</p>
      ) : apps.length === 0 ? (
        <p className="text-text-tertiary text-sm py-12 text-center border border-border-hairline rounded-md">
          No pending applications.
        </p>
      ) : (
        <RevealGroup className="space-y-3">
          {apps.map((app) => (
            <ReferralApplicationCard
              key={app.id}
              app={app}
              onResolved={(id) => setApps((prev) => prev.filter((a) => a.id !== id))}
            />
          ))}
        </RevealGroup>
      )}
    </div>
  );
}
