import { useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { forgetReferral, pendingReferral } from "@/lib/referral";

/** After sign-in, credits the person whose link brought this visitor (Phase 7). Renders nothing. */
export function ReferralClaimer() {
  const claim = trpc.referrals.claim.useMutation();
  const tried = useRef(false);
  useEffect(() => {
    const code = pendingReferral();
    if (!code || tried.current) return;
    tried.current = true;
    claim.mutate(
      { code },
      // Whatever the answer (claimed, already linked, too late, own code), it is settled; a
      // network failure leaves the code for the next page load.
      { onSuccess: () => forgetReferral() },
    );
  }, [claim]);
  return null;
}
