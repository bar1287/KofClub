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
  /** The viewer's stack and chips already waiting for the hand to end. */
  stack: number;
  pending: number;
  autoTopUpTo: number;
  onApplied: (result: { pending: number }) => void;
  onAutoTopUp: (to: number) => void;
  onClose: () => void;
}

/**
 * Adds chips from the club wallet (a re-buy when the stack is empty), and
 * sets the automatic top-up. The game service enforces every limit; during
 * a hand the chips are added when it ends.
 */
export function TopUpDialog(props: Props) {
  const { tableId, table, stack, pending, autoTopUpTo, onApplied, onAutoTopUp, onClose } = props;
  const { ep } = useSession();
  const [wallet, setWallet] = useState<number | null>(null);
  const have = stack + pending;
  const room = Math.max(0, table.buyInMax - have);
  const rebuy = have === 0;
  const [amount, setAmount] = useState(rebuy ? table.buyInMin : room);
  const edited = useRef(false);
  const [key] = useState(newIdempotencyKey);
  const [autoOn, setAutoOn] = useState(autoTopUpTo > 0);
  const [target, setTarget] = useState(autoTopUpTo || table.buyInMax);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    ep.wallet(table.clubId)
      .then((w) => {
        setWallet(w.balance);
        if (!edited.current)
          setAmount(Math.max(rebuy ? table.buyInMin : 1, Math.min(room, w.balance)));
      })
      .catch((err: unknown) => setError(errorMessage(err)));
  }, [ep, table.clubId, table.buyInMin, room, rebuy]);

  async function addChips(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await ep.topUp(tableId, amount, key);
      onApplied({ pending: res.pending });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveAuto() {
    setBusy(true);
    setError(null);
    try {
      const res = await ep.setAutoTopUp(tableId, autoOn ? target : 0);
      onAutoTopUp(res.autoTopUpTo);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const max = Math.min(room, wallet ?? room);
  const min = rebuy ? table.buyInMin : 1;
  const tooPoor = wallet !== null && wallet < min;
  return (
    <div className="dialog-backdrop" role="dialog" aria-modal aria-labelledby="topup-title">
      <div className="panel form dialog">
        <form className="stack" onSubmit={addChips}>
          <h2 id="topup-title">{rebuy ? 'Re-buy' : 'Add chips'}</h2>
          <p className="muted small">
            Wallet: <strong>{wallet === null ? '…' : chips(wallet)}</strong> · Stack {chips(stack)}
            {pending > 0 && ` (+${chips(pending)} after this hand)`} · Table maximum{' '}
            {chips(table.buyInMax)}
          </p>
          {room === 0 ? (
            <div className="alert info">Your stack is already at the table maximum.</div>
          ) : (
            <label className="field">
              Chips to add
              <input
                name="topUpAmount"
                type="number"
                min={min}
                max={max}
                step={1}
                required
                value={amount}
                onChange={(e) => {
                  edited.current = true;
                  setAmount(Math.trunc(Number(e.target.value)));
                }}
              />
            </label>
          )}
          {tooPoor && <div className="alert info">Not enough chips in your wallet.</div>}
          <div className="row">
            <button
              className="btn primary"
              type="submit"
              disabled={busy || room === 0 || tooPoor || amount < min || amount > max}
            >
              {rebuy ? 'Re-buy' : 'Add chips'}
            </button>
            <button className="btn" type="button" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
        <hr />
        <div className="stack">
          <label className="row small">
            <input
              type="checkbox"
              checked={autoOn}
              onChange={(e) => setAutoOn(e.target.checked)}
              data-testid="auto-top-up"
            />
            After every hand, top my stack back up to
            <input
              type="number"
              aria-label="Automatic top-up target"
              min={table.buyInMin}
              max={table.buyInMax}
              step={1}
              value={target}
              disabled={!autoOn}
              style={{ width: 110 }}
              onChange={(e) => setTarget(Math.trunc(Number(e.target.value)))}
            />
          </label>
          <div>
            <button
              className="btn small"
              type="button"
              disabled={busy || (autoOn && (target < table.buyInMin || target > table.buyInMax))}
              onClick={() => void saveAuto()}
            >
              Save automatic top-up
            </button>
          </div>
        </div>
        <ErrorAlert error={error} />
      </div>
    </div>
  );
}
