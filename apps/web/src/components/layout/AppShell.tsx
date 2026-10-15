'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { useSession } from '@/lib/session';
import { useOperator } from '@/lib/useOperator';
import { useTelegramConfig } from '@/lib/useTelegramConfig';
import { TelegramBridge } from './TelegramBridge';

export function AppShell({ children }: { children: ReactNode }) {
  const { status, user, logout, ep } = useSession();
  const router = useRouter();
  const telegramConfig = useTelegramConfig(ep);
  // Inside an operator's bot the app carries the operator's name (ADR-019).
  const operator = useOperator(ep);
  const inOperatorWorld = operator.slug !== null;
  return (
    <div className="shell">
      <TelegramBridge />
      <header className="topbar">
        <Link href="/" className="brand" data-testid="brand">
          {inOperatorWorld ? (
            <>
              {operator.info?.name ?? ''}
              <small className="powered-by">by KofClub</small>
            </>
          ) : (
            <>
              Kof<span>Club</span>
            </>
          )}
        </Link>
        <nav>
          {status === 'authenticated' && (
            <>
              <Link href="/clubs">Clubs</Link>
              <Link href="/hands">Hands</Link>
              {telegramConfig?.storeEnabled && !inOperatorWorld && <Link href="/store">Store</Link>}
              {telegramConfig?.operatorsEnabled && !inOperatorWorld && (
                <Link href="/operators">Your bot</Link>
              )}
              <Link href="/profile">Profile</Link>
              {user?.platformRole === 'PLATFORM_ADMIN' && <Link href="/admin">Admin</Link>}
            </>
          )}
        </nav>
        <div className="who">
          {status === 'authenticated' && user ? (
            <>
              <span data-testid="current-user">{user.username}</span>
              <button
                className="btn small"
                onClick={() => {
                  void logout();
                  router.push('/login');
                }}
              >
                Log out
              </button>
            </>
          ) : status === 'anonymous' ? (
            <>
              <Link href="/login">Log in</Link>
              {!inOperatorWorld && <Link href="/register">Register</Link>}
            </>
          ) : null}
        </div>
      </header>
      {children}
      <footer className="footer">
        Social poker with virtual chips. Virtual chips have no monetary value and cannot be
        exchanged for money or prizes. <Link href="/terms">Terms</Link>
      </footer>
    </div>
  );
}
