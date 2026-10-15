'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ErrorAlert } from '@/components/ErrorAlert';
import { errorMessage } from '@/lib/api/client';
import { useSession } from '@/lib/session';
import type { Club, ClubPlan } from '@/lib/types';

/**
 * The club's plan (T2, ADR-018): Free or Club Pro, its limits, and for the
 * subscriber the monthly renewal. Hidden where plans do not apply.
 */
export function ClubPlanPanel({ club }: { club: Club }) {
  const { ep } = useSession();
  const [plan, setPlan] = useState<ClubPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setPlan(await ep.clubPlan(club.id));
    } catch {
      setPlan(null);
    }
  }, [ep, club.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setRenewal(renewing: boolean) {
    setBusy(true);
    setError(null);
    try {
      setPlan(await ep.setClubPlanRenewal(club.id, renewing));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!plan || (!plan.limitsEnforced && plan.plan === 'FREE')) return null;
  const until = plan.activeUntil ? new Date(plan.activeUntil).toLocaleDateString() : null;
  return (
    <div className="panel stack" data-testid="club-plan">
      <h2 style={{ margin: 0 }}>
        Plan:{' '}
        {plan.plan === 'PRO' ? <span className="badge pro">Club Pro</span> : <span>Free</span>}
      </h2>
      {plan.plan === 'PRO' && until && (
        <p className="small">
          {plan.renewing ? `Renews on ${until}.` : `Ends on ${until} (renewal canceled).`}
        </p>
      )}
      {plan.limitsEnforced && (
        <p className="muted small">
          Up to {plan.limits.maxOpenTables} open tables and {plan.limits.maxMembers} members.
          {plan.plan === 'FREE' &&
            ` Club Pro: ${plan.proLimits.maxOpenTables} tables and ${plan.proLimits.maxMembers} members.`}
        </p>
      )}
      {plan.plan === 'FREE' && club.myRole === 'OWNER' && (
        <div>
          <Link className="btn primary small" href={`/store?club=${club.id}`}>
            Upgrade to Club Pro
          </Link>
        </div>
      )}
      {plan.canManageRenewal && (
        <div>
          <button
            className="btn small"
            disabled={busy}
            onClick={() => void setRenewal(!plan.renewing)}
          >
            {plan.renewing ? 'Cancel renewal' : 'Resume renewal'}
          </button>
        </div>
      )}
      <ErrorAlert error={error} />
    </div>
  );
}
