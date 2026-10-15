'use client';

import { useEffect, useState } from 'react';
import type { Endpoints } from './api/endpoints';
import type { TelegramConfig } from './types';

const OFF: TelegramConfig = { enabled: false, botUsername: null };
let cached: Promise<TelegramConfig> | null = null;

/** Whether this deployment has a Telegram bot (fetched once per page load). */
export function useTelegramConfig(ep: Endpoints): TelegramConfig | null {
  const [config, setConfig] = useState<TelegramConfig | null>(null);
  useEffect(() => {
    let live = true;
    cached ??= ep.telegramConfig().catch(() => OFF);
    void cached.then((c) => {
      if (live) setConfig(c);
    });
    return () => {
      live = false;
    };
  }, [ep]);
  return config;
}
