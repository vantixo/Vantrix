import "server-only";
import { cookies } from "next/headers";
import { absoluteUrl } from "@/lib/utils";
import type { DigitalTwinProfile } from "@/lib/digital-twin/engine";

/**
 * digital-twin/route.ts's GET does real work beyond a table read —
 * requirePlan() (403 PLAN_GATED for free-tier, with admin bypass) gates
 * it before getDigitalTwinProfile() ever runs. Per §10 that's exactly the
 * "don't reimplement the request-shaping" case, so this goes through the
 * route rather than calling getDigitalTwinProfile() directly. Unlike
 * fetchInternal (which throws on any non-2xx and discards the status),
 * this needs the raw status to tell "not premium" apart from "no twin
 * trained yet" — both come back as an unhelpful 400/403 otherwise — so it
 * duplicates fetchInternal's small cookie-forwarding fetch rather than
 * building on it.
 */
export interface TwinPageData {
  /** True if the caller's plan doesn't include Digital Twin (403 PLAN_GATED). */
  gated: boolean;
  profile: DigitalTwinProfile | null;
}

export async function getTwinPageData(): Promise<TwinPageData> {
  const cookieStore = await cookies();

  try {
    const res = await fetch(absoluteUrl("/api/digital-twin"), {
      headers: { cookie: cookieStore.toString() },
      cache: "no-store",
    });

    if (res.status === 403) return { gated: true, profile: null };
    if (!res.ok) return { gated: false, profile: null };

    const data = (await res.json()) as { profile: DigitalTwinProfile | null };
    return { gated: false, profile: data.profile ?? null };
  } catch {
    return { gated: false, profile: null };
  }
}
