'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { useSession } from '@/lib/session';

export function AppShell({ children }: { children: ReactNode }) {
  const { status, user, logout } = useSession();
  const router = useRouter();
  return (
    <div className="shell">
      <header className="topbar">
        <Link href="/" className="brand">
          Kof<span>Club</span>
        </Link>
        <nav>
          {status === 'authenticated' && (
            <>
              <Link href="/clubs">Clubs</Link>
              <Link href="/hands">Hands</Link>
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
                  // Leave protected pages first so their guard does not
                  // turn the logout into a "log in to continue" redirect.
                  router.push('/login');
                  void logout();
                }}
              >
                Log out
              </button>
            </>
          ) : status === 'anonymous' ? (
            <>
              <Link href="/login">Log in</Link>
              <Link href="/register">Register</Link>
            </>
          ) : null}
        </div>
      </header>
      {children}
      <footer className="footer">
        Social poker with virtual chips. Virtual chips have no monetary value and cannot be
        exchanged for money or prizes.
      </footer>
    </div>
  );
}
