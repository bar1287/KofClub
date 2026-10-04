'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { ErrorAlert } from '@/components/ErrorAlert';
import { RequireAuth } from '@/components/RequireAuth';
import { errorMessage, newIdempotencyKey } from '@/lib/api/client';
import { chips } from '@/lib/format';
import { GAME_TYPES, gameLabel, gameName, type GameType } from '@/lib/games';
import { atLeast } from '@/lib/roles';
import { useSession } from '@/lib/session';
import type { Club, Member, Table, Wallet } from '@/lib/types';

interface LobbyData {
  club: Club;
  wallet: Wallet;
  tables: Table[];
  members: Member[];
}

function ClubLobby({ clubId }: { clubId: string }) {
  const { ep } = useSession();
  const [data, setData] = useState<LobbyData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [club, wallet, tables, members] = await Promise.all([
        ep.club(clubId),
        ep.wallet(clubId),
        ep.tables(clubId),
        ep.members(clubId),
      ]);
      setData({ club, wallet, tables, members: members.items });
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [ep, clubId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data) {
    return error ? <ErrorAlert error={error} /> : <p className="muted">Loading…</p>;
  }
  const { club, wallet, tables, members } = data;
  const isAdmin = atLeast(club.myRole, 'ADMIN');

  return (
    <div className="stack">
      <div className="row">
        <h1 style={{ margin: 0 }} data-testid="club-name">
          {club.name}
        </h1>
        <span className="badge">{club.myRole}</span>
        <span className="spacer" />
        {atLeast(club.myRole, 'AGENT') && (
          <Link className="btn small" href={`/clubs/${club.id}/admin`}>
            Manage club
          </Link>
        )}
        {club.joinCode && (
          <span className="muted small">
            Join code:{' '}
            <strong className="mono" data-testid="join-code">
              {club.joinCode}
            </strong>
          </span>
        )}
      </div>
      <ErrorAlert error={error} />
      {notice && <div className="alert ok">{notice}</div>}

      <div className="grid-2">
        <div className="panel">
          <h2>My chips</h2>
          <p style={{ fontSize: '1.8rem', margin: '4px 0' }}>
            <strong data-testid="wallet-balance">{chips(wallet.balance)}</strong>
          </p>
          <p className="muted small">Virtual chips for this club. They have no monetary value.</p>
        </div>
        {isAdmin && (
          <CreateTable
            clubId={clubId}
            onCreated={(t) => {
              setNotice(`Table “${t.name}” created.`);
              void load();
            }}
          />
        )}
      </div>

      <div className="panel">
        <div className="row">
          <h2 style={{ margin: 0 }}>Tables</h2>
          <span className="spacer" />
          <button className="btn small" onClick={() => void load()}>
            Refresh
          </button>
        </div>
        {tables.length === 0 ? (
          <p className="muted">No tables yet.</p>
        ) : (
          <table className="list" data-testid="table-list">
            <thead>
              <tr>
                <th>Table</th>
                <th>Game</th>
                <th>Blinds</th>
                <th>Buy-in</th>
                <th className="num">Players</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tables.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>{gameLabel(t.gameType)}</td>
                  <td>
                    {chips(t.smallBlind)}/{chips(t.bigBlind)}
                  </td>
                  <td>
                    {chips(t.buyInMin)}–{chips(t.buyInMax)}
                  </td>
                  <td className="num">
                    {t.seatedCount}/{t.maxSeats}
                  </td>
                  <td className="num">
                    {t.status === 'OPEN' ? (
                      <Link className="btn small primary" href={`/tables/${t.id}`}>
                        Open
                      </Link>
                    ) : (
                      <span className="badge">CLOSED</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h2>Members</h2>
        <table className="list" data-testid="member-list">
          <thead>
            <tr>
              <th>Player</th>
              <th>Role</th>
              <th>Status</th>
              {isAdmin && <th>Grant chips</th>}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.userId} data-member={m.username}>
                <td>{m.username}</td>
                <td>
                  <span className="badge">{m.role}</span>
                </td>
                <td>{m.status}</td>
                {isAdmin && (
                  <td>
                    {m.status === 'ACTIVE' && (
                      <GrantChips
                        clubId={clubId}
                        member={m}
                        onGranted={(amount) => {
                          setNotice(`Granted ${chips(amount)} chips to ${m.username}.`);
                          void load();
                        }}
                      />
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CreateTable({ clubId, onCreated }: { clubId: string; onCreated: (t: Table) => void }) {
  const { ep } = useSession();
  const [form, setForm] = useState({
    name: '',
    gameType: 'NLHE' as GameType,
    maxSeats: 6,
    smallBlind: 5,
    bigBlind: 10,
    buyInMin: 200,
    buyInMax: 2000,
    actionTimeoutSec: 20,
  });
  const [key, setKey] = useState(newIdempotencyKey);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const num =
    (k: Exclude<keyof typeof form, 'name' | 'gameType'>) => (e: ChangeEvent<HTMLInputElement>) =>
      setForm({ ...form, [k]: Math.trunc(Number(e.target.value)) });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const t = await ep.createTable(clubId, { ...form, name: form.name.trim() }, key);
      setKey(newIdempotencyKey());
      setForm({ ...form, name: '' });
      onCreated(t);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel form" onSubmit={submit}>
      <h2>Create a table</h2>
      <label className="field">
        Name
        <input
          name="tableName"
          required
          minLength={3}
          maxLength={64}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </label>
      <div className="row">
        <label className="field">
          Game
          <select
            name="gameType"
            value={form.gameType}
            onChange={(e) => setForm({ ...form, gameType: e.target.value as GameType })}
          >
            {GAME_TYPES.map((g) => (
              <option key={g} value={g}>
                {gameName(g)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Seats
          <input
            type="number"
            name="maxSeats"
            min={2}
            max={10}
            value={form.maxSeats}
            onChange={num('maxSeats')}
          />
        </label>
        <label className="field">
          Small blind
          <input
            type="number"
            name="smallBlind"
            min={1}
            value={form.smallBlind}
            onChange={num('smallBlind')}
          />
        </label>
        <label className="field">
          Big blind
          <input
            type="number"
            name="bigBlind"
            min={2}
            value={form.bigBlind}
            onChange={num('bigBlind')}
          />
        </label>
      </div>
      <div className="row">
        <label className="field">
          Min buy-in
          <input
            type="number"
            name="buyInMin"
            min={1}
            value={form.buyInMin}
            onChange={num('buyInMin')}
          />
        </label>
        <label className="field">
          Max buy-in
          <input
            type="number"
            name="buyInMax"
            min={1}
            value={form.buyInMax}
            onChange={num('buyInMax')}
          />
        </label>
        <label className="field">
          Turn time (s)
          <input
            type="number"
            name="actionTimeoutSec"
            min={5}
            max={120}
            value={form.actionTimeoutSec}
            onChange={num('actionTimeoutSec')}
          />
        </label>
      </div>
      <ErrorAlert error={error} />
      <button className="btn primary" type="submit" disabled={busy}>
        Create table
      </button>
    </form>
  );
}

function GrantChips({
  clubId,
  member,
  onGranted,
}: {
  clubId: string;
  member: Member;
  onGranted: (amount: number) => void;
}) {
  const { ep } = useSession();
  const [amount, setAmount] = useState('');
  const [key, setKey] = useState(newIdempotencyKey);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = Number(amount);
    if (!Number.isSafeInteger(value) || value <= 0) {
      setError('Enter a whole number of chips.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Retrying this submission reuses the key, so chips never move twice.
      await ep.grantChips(clubId, { userId: member.userId, amount: value }, key);
      setKey(newIdempotencyKey());
      setAmount('');
      onGranted(value);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="row" onSubmit={submit} style={{ gap: 6 }}>
      <input
        aria-label={`Chips to grant to ${member.username}`}
        name="grantAmount"
        inputMode="numeric"
        style={{ width: 100 }}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <button className="btn small" type="submit" disabled={busy || !amount}>
        Grant
      </button>
      {error && (
        <span className="small" style={{ color: 'var(--danger)' }}>
          {error}
        </span>
      )}
    </form>
  );
}

export default function ClubPage() {
  const { clubId } = useParams<{ clubId: string }>();
  return (
    <main className="content">
      <RequireAuth>
        <ClubLobby clubId={clubId} />
      </RequireAuth>
    </main>
  );
}
