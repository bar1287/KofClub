import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { SessionProvider } from '@/lib/session';
import './globals.css';

// Every page carries a per-request CSP nonce (proxy.ts), so pages are
// rendered per request instead of prerendered.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'KofClub',
  description: 'Private-club social poker with virtual chips (no monetary value).',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0d141b',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>
          <AppShell>{children}</AppShell>
        </SessionProvider>
      </body>
    </html>
  );
}
