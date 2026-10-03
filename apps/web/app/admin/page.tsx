'use client';

import { useState } from 'react';
import { ErrorAlert } from '@/components/ErrorAlert';
import { PlatformAuditPanel } from '@/components/platform-admin/AuditPanel';
import { ClubsPanel } from '@/components/platform-admin/ClubsPanel';
import { OverviewPanel } from '@/components/platform-admin/OverviewPanel';
import { RiskPanel } from '@/components/platform-admin/RiskPanel';
import { UsersPanel } from '@/components/platform-admin/UsersPanel';
import { RequireAuth } from '@/components/RequireAuth';
import { useSession } from '@/lib/session';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'users', label: 'Accounts' },
  { id: 'clubs', label: 'Clubs' },
  { id: 'risk', label: 'Risk cases' },
  { id: 'audit', label: 'Audit log' },
] as const;
type Tab = (typeof TABS)[number]['id'];

function PlatformAdmin() {
  const { user } = useSession();
  const [tab, setTab] = useState<Tab>('overview');
  // UI convenience only: every /v1/admin call is authorized server-side.
  if (user?.platformRole !== 'PLATFORM_ADMIN') {
    return <ErrorAlert error="Platform administrators only." />;
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
