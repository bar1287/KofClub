'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { loadTelegramWebApp, takeStartJoinCode, telegramInitData } from '@/lib/telegram';

/**
 * Inside the Telegram Mini App: tells Telegram the app is ready, opens it
 * full height, and follows a club link (t.me/<bot>?startapp=c-<CODE>) to
 * the join page. Renders nothing; does nothing outside Telegram.
 */
export function TelegramBridge() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!telegramInitData()) return;
    void loadTelegramWebApp().then((webApp) => {
      try {
        webApp?.ready();
        webApp?.expand();
      } catch {
        /* an old Telegram client without these methods */
      }
    });
  }, []);

  useEffect(() => {
    if (pathname !== '/') return;
    const code = takeStartJoinCode();
    if (code) router.replace(`/join?code=${encodeURIComponent(code)}`);
  }, [pathname, router]);

  return null;
}
