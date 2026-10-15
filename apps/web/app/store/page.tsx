'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { ErrorAlert } from '@/components/ErrorAlert';
import { RequireAuth } from '@/components/RequireAuth';
import { errorMessage } from '@/lib/api/client';
import { usePrefs } from '@/lib/prefs-context';
import { useSession } from '@/lib/session';
import { paymentLabel, stars, TIPS, waitUntil } from '@/lib/store';
import { openInvoice, storeStartLink } from '@/lib/telegram';
import type { Club, MyStore, StoreCatalog, StoreProduct, StoreProductId } from '@/lib/types';

/**
 * The Telegram Stars store (T2, ADR-018): Club Pro, premium themes and tips.
 * Digital extras only; purchases happen inside the Telegram app.
 */
function StoreView() {
  const { ep, user, telegram, linkTelegram } = useSession();
  const { checkPremium } = usePrefs();
  const preselected = useSearchParams().get('club');
  const [catalog, setCatalog] = useState<StoreCatalog | null>(null);
  const [mine, setMine] = useState<MyStore | null>(null);
  const [ownedClubs, setOwnedClubs] = useState<Club[]>([]);
  const [clubId, setClubId] = useState('');
  const [busy, setBusy] = useState<StoreProductId | 'link' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, m, clubs] = await Promise.all([ep.store(), ep.myStore(), ep.myClubs()]);
      setCatalog(c);
      setMine(m);
      const owned = clubs.filter((club) => club.myRole === 'OWNER');
      setOwnedClubs(owned);
      setClubId((id) => id || (owned.find((x) => x.id === preselected) ?? owned[0])?.id || '');
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [ep, preselected]);

  useEffect(() => {
    void load();
  }, [load]);

  async function buy(product: StoreProductId) {
    setBusy(product);
    setError(null);
    setNotice(null);
    try {
      const before = mine?.payments.length ?? 0;
      const order = await ep.createStarOrder(
        product === 'CLUB_PRO' ? { product, clubId } : { product },
      );
      const status = await openInvoice(order.invoiceLink);
      if (status === 'paid') {
        setNotice('Payment received. Thank you!');
        await waitUntil(async () => (await ep.myStore()).payments.length > before);
        checkPremium();
        await load();
      } else if (status === 'pending') {
        setNotice('Your payment is being processed. It will show here shortly.');
      } else if (status === 'failed') {
        setError('The payment did not go through. No Stars were taken.');
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function link() {
    setBusy('link');
    setError(null);
    try {
      await linkTelegram();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (!catalog || !mine) {
    return (
      <>
        <ErrorAlert error={error} />
        {!error && <p className="muted">Loading…</p>}
      </>
    );
  }
  const product = (id: StoreProductId) => catalog.products.find((p) => p.id === id);
  const canBuy = catalog.enabled && telegram !== null && user?.telegram !== null;
  const buyButton = (p: StoreProduct, label: string, disabled = false) => (
    <button
      className="btn primary"
      type="button"
      disabled={!canBuy || busy !== null || disabled}
      onClick={() => void buy(p.id)}
      data-testid={`buy-${p.id}`}
    >
      {busy === p.id ? 'Opening…' : `${label} · ${stars(p.stars)}`}
    </button>
  );
  const pro = product('CLUB_PRO');
  const themes = product('PREMIUM_THEMES');

  return (
    <div className="stack" data-testid="store">
      <h1 style={{ margin: 0 }}>Store</h1>
      <p className="muted small">
        Telegram Stars buy digital extras for the app only. They never buy chips, seats, tournament
        entries or prizes, and chips can never become Stars.
      </p>
      <ErrorAlert error={error} />
      {notice && (
        <div className="alert ok" role="status">
          {notice}
        </div>
      )}
      {!catalog.enabled ? (
        <div className="alert info">The store is not available on this server.</div>
      ) : telegram === null ? (
        <div className="alert info" data-testid="store-open-telegram">
          Purchases are made in the Telegram app.{' '}
          {catalog.botUsername && (
            <a href={storeStartLink(catalog.botUsername)} target="_blank" rel="noreferrer">
              Open the store in Telegram
            </a>
          )}
        </div>
      ) : user?.telegram === null ? (
        <div className="alert info">
          Link this Telegram account to pay with Stars.{' '}
          <button className="btn small" disabled={busy !== null} onClick={() => void link()}>
            Link Telegram
          </button>
        </div>
      ) : null}

      <div className="grid-2">
        {pro && (
          <div className="panel stack" data-testid="product-CLUB_PRO">
            <h2 style={{ margin: 0 }}>Club Pro</h2>
            <p>{pro.description}</p>
            {ownedClubs.length === 0 ? (
              <p className="muted small">
                Club Pro is for club owners. <Link href="/clubs">Create a club</Link> first.
              </p>
            ) : (
              <label className="field">
                Club
                <select name="proClub" value={clubId} onChange={(e) => setClubId(e.target.value)}>
                  {ownedClubs.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div>{buyButton(pro, 'Upgrade for 30 days', !clubId)}</div>
            <p className="muted small">Renews monthly; cancel any time on the club page.</p>
          </div>
        )}
        {themes && (
          <div className="panel stack" data-testid="product-PREMIUM_THEMES">
            <h2 style={{ margin: 0 }}>Premium themes</h2>
            <p>{themes.description}</p>
            <div className="row">
              <span className="felt-swatch" data-felt="midnight" />
              <span className="felt-swatch" data-felt="royal" />
              <span className="felt-swatch" data-felt="emerald" />
            </div>
            {themes.owned ? (
              <p>
                <span className="badge green">Owned</span> Choose them in the table settings.
              </p>
            ) : (
              <div>{buyButton(themes, 'Unlock')}</div>
            )}
          </div>
        )}
      </div>

      <div className="panel stack" data-testid="product-tips">
        <h2 style={{ margin: 0 }}>Support KofClub</h2>
        <p className="muted small">{product('TIP_SMALL')?.description}</p>
        <div className="row">
          {TIPS.map((id) => {
            const p = product(id);
            return p ? <span key={id}>{buyButton(p, p.title.replace(/^Tip: /, ''))}</span> : null;
          })}
        </div>
      </div>

      <div className="panel">
        <h2>My purchases</h2>
        {mine.payments.length === 0 ? (
          <p className="muted">No purchases yet.</p>
        ) : (
          <table className="list" data-testid="my-purchases">
            <thead>
              <tr>
                <th>Date</th>
                <th>Item</th>
                <th className="num">Stars</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {mine.payments.map((p) => (
                <tr key={p.id}>
                  <td>{new Date(p.paidAt).toLocaleDateString()}</td>
                  <td>{paymentLabel(p)}</td>
                  <td className="num">{stars(p.stars)}</td>
                  <td>{p.refundedAt && <span className="badge">Refunded</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted small">
          Problem with a purchase? Send <span className="mono">/paysupport</span> to our bot.
        </p>
      </div>
    </div>
  );
}

export default function StorePage() {
  return (
    <main className="content">
      <RequireAuth>
        <Suspense>
          <StoreView />
        </Suspense>
      </RequireAuth>
    </main>
  );
}
