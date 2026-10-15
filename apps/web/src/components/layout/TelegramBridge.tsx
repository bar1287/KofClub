'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { loadTelegramWebApp, takeStartRoute, telegramInitData } from '@/lib/telegram';

/**
 * Inside the Telegram Mini App: tells Telegram the app is ready, opens it
 * full height, and follows the link that opened it (t.me/<bot>?startapp=…)
 * to a club's join page or the store. Renders nothing; does nothing outside Telegram.
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
    const route = takeStartRoute();
    if (route) router.replace(route);
  }, [pathname, router]);

  return null;
}
