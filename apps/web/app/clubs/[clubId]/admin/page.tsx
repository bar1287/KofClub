'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AuditPanel } from '@/components/club-admin/AuditPanel';
import { ChipsPanel } from '@/components/club-admin/ChipsPanel';
import { HandsPanel } from '@/components/club-admin/HandsPanel';
import { InvitesPanel } from '@/components/club-admin/InvitesPanel';
import { MembersPanel } from '@/components/club-admin/MembersPanel';
import { SettingsPanel } from '@/components/club-admin/SettingsPanel';
import { TablesPanel } from '@/components/club-admin/TablesPanel';
import { ErrorAlert } from '@/components/ErrorAlert';
import { RequireAuth } from '@/components/RequireAuth';
import { errorMessage } from '@/lib/api/client';
import { atLeast } from '@/lib/roles';
import { useSession } from '@/lib/session';
import type { Club, ClubRole } from '@/lib/types';

type Tab = 'members' | 'invites' | 'chips' | 'tables' | 'hands' | 'audit' | 'settings';

/** Minimum club role per tab (mirrors the API's permission matrix). */
const TABS: Array<{ id: Tab; label: string; min: ClubRole }> = [
  { id: 'members', label: 'Members', min: 'AGENT' },
  { id: 'invites', label: 'Invites', min: 'AGENT' },
  { id: 'chips', label: 'Chips & ledger', min: 'ADMIN' },
  { id: 'tables', label: 'Tables', min: 'ADMIN' },
  { id: 'hands', label: 'Hands', min: 'ADMIN' },
  { id: 'audit', label: 'Audit log', min: 'ADMIN' },
  { id: 'settings', label: 'Settings', min: 'OWNER' },
];

function ClubAdmin({ clubId }: { clubId: string }) {
  const { ep } = useSession();
  const [club, setClub] = useState<Club | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('members');

  const load = useCallback(async () => {
    try {
      setClub(await ep.club(clubId));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [ep, clubId]);
  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorAlert error={error} />;
  if (!club) return <p className="muted">Loading…</p>;
  const tabs = TABS.filter((t) => atLeast(club.myRole, t.min));
  if (tabs.length === 0) {
    return <ErrorAlert error="Club staff only." />;
  }
  const active = tabs.some((t) => t.id === tab) ? tab : tabs[0]!.id;
  const reload = () => void load();

  return (
    <div className="stack">
      <div className="row">
        <h1 style={{ margin: 0 }}>Manage {club.name}</h1>
        <span className="badge">{club.myRole}</span>
        <span className="spacer" />
        <Link href={`/clubs/${club.id}`} className="small">
          ← Lobby
        </Link>
      </div>
      <nav className="row" role="tablist" style={{ gap: 6 }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={active === t.id}
            className={`btn small${active === t.id ? ' primary' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="panel">
        {active === 'members' && <MembersPanel club={club} onClubChanged={reload} />}
        {active === 'invites' && <InvitesPanel club={club} onClubChanged={reload} />}
        {active === 'chips' && <ChipsPanel club={club} />}
        {active === 'tables' && <TablesPanel club={club} />}
        {active === 'hands' && <HandsPanel club={club} />}
        {active === 'audit' && <AuditPanel club={club} />}
        {active === 'settings' && <SettingsPanel club={club} onClubChanged={reload} />}
      </div>
    </div>
  );
}

export default function ClubAdminPage() {
  const { clubId } = useParams<{ clubId: string }>();
  return (
    <main className="content">
      <RequireAuth>
        <ClubAdmin clubId={clubId} />
      </RequireAuth>
    </main>
  );
}
