'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ErrorAlert } from '@/components/ErrorAlert';
import { errorMessage, newIdempotencyKey } from '@/lib/api/client';
import { chips } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { TableInfo } from '@/lib/types';

interface Props {
  tableId: string;
  table: TableInfo;
  seatNo: number;
  onClose: () => void;
}

/** Buys in from the club wallet; the seat appears via the PLAYER_SEATED event. */
export function BuyInDialog({ tableId, table, seatNo, onClose }: Props) {
  const { ep } = useSession();
  const [wallet, setWallet] = useState<number | null>(null);
  const [amount, setAmount] = useState(table.buyInMin);
  const [key] = useState(newIdempotencyKey);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Once the player has typed an amount, the wallet arriving later must not
  // replace it with the default.
  const edited = useRef(false);

  useEffect(() => {
    ep.wallet(table.clubId)
      .then((w) => {
        setWallet(w.balance);
        if (!edited.current) {
          setAmount(Math.max(table.buyInMin, Math.min(table.buyInMax, w.balance)));
        }
      })
      .catch((err: unknown) => setError(errorMessage(err)));
  }, [ep, table.clubId, table.buyInMin, table.buyInMax]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await ep.takeSeat(tableId, { buyIn: amount, seatNo }, key);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const tooPoor = wallet !== null && wallet < table.buyInMin;
  return (
    <div className="dialog-backdrop" role="dialog" aria-modal aria-labelledby="buyin-title">
      <form className="panel form dialog" onSubmit={submit}>
        <h2 id="buyin-title">Take seat {seatNo}</h2>
        <p className="muted small">
          Wallet: <strong>{wallet === null ? '…' : chips(wallet)}</strong> · Buy-in{' '}
          {chips(table.buyInMin)}–{chips(table.buyInMax)}
        </p>
        <label className="field">
          Buy-in amount
          <input
            name="buyIn"
            type="number"
            min={table.buyInMin}
            max={Math.min(table.buyInMax, wallet ?? table.buyInMax)}
            step={1}
            required
            value={amount}
            onChange={(e) => {
              edited.current = true;
              setAmount(Math.trunc(Number(e.target.value)));
            }}
          />
        </label>
        {tooPoor && (
          <div className="alert info">Not enough chips in your wallet for this table.</div>
        )}
        <ErrorAlert error={error} />
        <div className="row">
          <button className="btn primary" type="submit" disabled={busy || tooPoor}>
            Buy in
          </button>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
