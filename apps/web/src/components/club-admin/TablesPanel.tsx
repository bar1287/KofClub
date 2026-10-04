'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { chips } from '@/lib/format';
import { gameLabel } from '@/lib/games';
import { useSession } from '@/lib/session';
import type { Club, Table } from '@/lib/types';
import { Feedback } from './Feedback';
import { useAction } from './useAction';

export function TablesPanel({ club }: { club: Club }) {
  const { ep } = useSession();
  const [tables, setTables] = useState<Table[] | null>(null);
  const { busy, error, notice, run } = useAction();
  const load = useCallback(async () => setTables(await ep.tables(club.id)), [ep, club.id]);
  useEffect(() => {
    void run(load);
  }, [run, load]);

  return (
    <div className="stack">
      <h2 style={{ margin: 0 }}>Tables</h2>
      <Feedback error={error} notice={notice} />
      <table className="list" data-testid="admin-tables">
        <thead>
          <tr>
            <th>Table</th>
            <th>Game</th>
            <th>Blinds</th>
            <th className="num">Players</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(tables ?? []).map((t) => (
            <tr key={t.id} data-table={t.name}>
              <td>
                <Link href={`/tables/${t.id}`}>{t.name}</Link>
              </td>
              <td>{gameLabel(t.gameType)}</td>
              <td>
                {chips(t.smallBlind)}/{chips(t.bigBlind)}
              </td>
              <td className="num">
                {t.seatedCount}/{t.maxSeats}
              </td>
              <td>
                <span className={`badge ${t.status === 'OPEN' ? 'green' : ''}`}>{t.status}</span>
              </td>
              <td className="num">
                {t.status === 'OPEN' && (
                  <button
                    className="btn small danger"
                    disabled={busy}
                    onClick={() => {
                      if (
                        !window.confirm(
                          `Close “${t.name}” for good? Seated players are cashed out.`,
                        )
                      )
                        return;
                      void run(async () => {
                        const res = await ep.closeTable(t.id);
                        await load();
                        return res.status === 'CLOSED'
                          ? `${t.name} is closed.`
                          : `${t.name} closes when the current hand ends (${res.seated} players will be cashed out).`;
                      });
                    }}
                  >
                    Close table
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
