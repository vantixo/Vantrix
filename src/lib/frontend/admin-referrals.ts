export interface ReferralApplication {
  id: string;
  user_id: string;
  class: "dev" | "influencer";
  status: string;
  code: string;
  application_note: string | null;
  social_proof_url: string | null;
  follower_count: number | null;
  created_at: string;
  applicantName: string;
}

export async function fetchReferralApplications(): Promise<ReferralApplication[]> {
  const res = await fetch("/api/admin/referrals/applications?status=pending_review");
  if (!res.ok) throw new Error("Failed to load applications");
  const data = await res.json();
  return data.applications ?? [];
}

export async function decideReferralApplication(
  partnerId: string,
  decision: "approve" | "reject",
  rejectionReason?: string
): Promise<void> {
  const res = await fetch("/api/admin/referrals/approve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ partnerId, decision, rejectionReason }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Action failed");
  }
}
