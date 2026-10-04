'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ErrorAlert } from '@/components/ErrorAlert';
import { PlatformAuditPanel } from '@/components/platform-admin/AuditPanel';
import { ClubsPanel } from '@/components/platform-admin/ClubsPanel';
import { OverviewPanel } from '@/components/platform-admin/OverviewPanel';
import { RiskPanel } from '@/components/platform-admin/RiskPanel';
import { UsersPanel } from '@/components/platform-admin/UsersPanel';
import { RequireAuth } from '@/components/RequireAuth';
import { ApiError } from '@/lib/api/client';
import { useSession } from '@/lib/session';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'users', label: 'Accounts' },
  { id: 'clubs', label: 'Clubs' },
  { id: 'risk', label: 'Risk cases' },
  { id: 'audit', label: 'Audit log' },
] as const;
type Tab = (typeof TABS)[number]['id'];

/**
 * Administration needs a session verified with a second factor (ADR-017):
 * 'checking', 'ok', or whether the admin still has to enroll.
 */
function useMfaGate(enabled: boolean) {
  const { ep } = useSession();
  const [gate, setGate] = useState<'checking' | 'ok' | { enrolled: boolean }>('checking');
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    ep.adminOverview()
      .then(() => live && setGate('ok'))
      .catch((err: unknown) => {
        if (!live) return;
        if (err instanceof ApiError && err.code === 'MFA_REQUIRED') {
          setGate({ enrolled: err.details?.enrolled === true });
        } else {
          setGate('ok'); // the panels show other errors themselves
        }
      });
    return () => {
      live = false;
    };
  }, [ep, enabled]);
  return gate;
}

function PlatformAdmin() {
  const { user, logout } = useSession();
  const [tab, setTab] = useState<Tab>('overview');
  const isAdmin = user?.platformRole === 'PLATFORM_ADMIN';
  const gate = useMfaGate(isAdmin);
  // UI convenience only: every /v1/admin call is authorized server-side.
  if (!isAdmin) {
    return <ErrorAlert error="Platform administrators only." />;
  }
  if (gate === 'checking') return <p className="muted">Loading…</p>;
  if (gate !== 'ok') {
    return (
      <div className="panel stack" data-testid="admin-mfa-required">
        <h1 style={{ margin: 0 }}>Two-factor authentication required</h1>
        {gate.enrolled ? (
          <p>
            This session was signed in without an authentication code.{' '}
            <button className="btn small" onClick={() => void logout()}>
              Sign out
            </button>{' '}
            and sign in again with the code from your authenticator app.
          </p>
        ) : (
          <p>
            Platform administration needs two-factor authentication.{' '}
            <Link href="/profile">Set it up on your profile</Link>, then come back.
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="stack">
      <h1 style={{ margin: 0 }}>Platform administration</h1>
      <nav className="row" role="tablist" style={{ gap: 6 }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`btn small${tab === t.id ? ' primary' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="panel">
        {tab === 'overview' && <OverviewPanel />}
        {tab === 'users' && <UsersPanel />}
        {tab === 'clubs' && <ClubsPanel />}
        {tab === 'risk' && <RiskPanel />}
        {tab === 'audit' && <PlatformAuditPanel />}
      </div>
    </div>
  );
}

export default function AdminPage() {
  return (
    <main className="content wide">
      <RequireAuth>
        <PlatformAdmin />
      </RequireAuth>
    </main>
  );
}
