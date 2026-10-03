'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useSession } from '@/lib/session';

/** Renders children only for signed-in users; otherwise redirects to /login. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, signedOut } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (status !== 'anonymous') return;
    // After an explicit sign-out there is nothing to come back to.
    router.replace(signedOut ? '/login' : `/login?next=${encodeURIComponent(pathname)}`);
  }, [status, signedOut, router, pathname]);
  if (status !== 'authenticated') return <p className="muted">Loading…</p>;
  return <>{children}</>;
}
