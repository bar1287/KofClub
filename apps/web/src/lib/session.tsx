'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ApiClient, ApiError } from './api/client';
import { endpoints, type Endpoints } from './api/endpoints';
import { publicEnv } from './env';
import { RealtimeClient } from './realtime/client';
import { telegramInitData, telegramOutcome, type TelegramSession } from './telegram';
import type { User } from './types';

export type SessionStatus = 'loading' | 'authenticated' | 'anonymous';
export type { TelegramSession };

interface SessionValue {
  status: SessionStatus;
  /** The user signed out on purpose (guards send them to /login without ?next). */
  signedOut: boolean;
  user: User | null;
  api: ApiClient;
  ep: Endpoints;
  realtime: RealtimeClient;
  /** Rejects with `MFA_REQUIRED` for accounts with two-factor authentication. */
  login(login: string, password: string, mfaCode?: string): Promise<void>;
  register(email: string, username: string, password: string): Promise<void>;
  logout(): Promise<void>;
  /** Null outside Telegram (and until the session is restored). */
  telegram: TelegramSession | null;
  /** Signs in with Telegram (`create` makes a new Telegram-only account). */
  loginWithTelegram(opts?: { create?: boolean; mfaCode?: string }): Promise<void>;
  /** Links the open Telegram account to the signed-in user. */
  linkTelegram(): Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

const CLIENT_VERSION = 'web-0.1.0';

interface Clients {
  api: ApiClient;
  ep: Endpoints;
  realtime: RealtimeClient;
}

let clients: Clients | null = null;

/** One API + realtime client per browser tab. */
function getClients(): Clients {
  if (!clients) {
    const locks = typeof navigator !== 'undefined' && 'locks' in navigator ? navigator.locks : null;
    // Telegram Web frames the app, where the refresh cookie is not sent.
    const refreshInMemory = telegramInitData() !== null;
    const api = new ApiClient({ baseUrl: publicEnv.apiUrl, locks, refreshInMemory });
    const realtime = new RealtimeClient({
      url: publicEnv.realtimeUrl,
      clientVersion: CLIENT_VERSION,
      getAccessToken: () => api.getAccessToken(),
      refreshAccessToken: async () => (await api.refresh()).accessToken,
    });
    clients = { api, ep: endpoints(api), realtime };
  }
  return clients;
}

interface Restored {
  user: User | null;
  telegram: TelegramSession | null;
}

let restoring: Promise<Restored> | null = null;

/** Restores the session once per page load (StrictMode runs effects twice). */
function restoreOnce(api: ApiClient): Promise<Restored> {
  restoring ??= restore(api);
  return restoring;
}

/** The refresh cookie, or inside Telegram a sign-in with the launch data. */
async function restore(api: ApiClient): Promise<Restored> {
  const initData = telegramInitData();
  if (!initData) {
    return { user: await api.restore().catch(() => null), telegram: null };
  }
  try {
    const user = await api.loginWithTelegram({ initData });
    return { user, telegram: telegramOutcome(initData, null) };
  } catch (err) {
    return { user: null, telegram: telegramOutcome(initData, err) };
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const { api, ep, realtime } = useMemo(getClients, []);
  const [status, setStatus] = useState<SessionStatus>(() =>
    api.auth.user ? 'authenticated' : 'loading',
  );
  const [user, setUser] = useState<User | null>(api.auth.user);
  const [signedOut, setSignedOut] = useState(false);
  const [telegram, setTelegram] = useState<TelegramSession | null>(null);

  useEffect(() => {
    const off = api.onAuthChange((s) => {
      setUser(s.user);
      setStatus(s.user ? 'authenticated' : 'anonymous');
    });
    if (!api.auth.user) {
      void restoreOnce(api).then((r) => {
        setUser(r.user);
        setStatus(r.user ? 'authenticated' : 'anonymous');
        if (r.telegram) setTelegram(r.telegram);
      });
    }
    return off;
  }, [api]);

  // The realtime connection lives as long as the session.
  useEffect(() => {
    if (status === 'authenticated') realtime.connect();
    else if (status === 'anonymous') realtime.close();
  }, [status, realtime]);

  useEffect(() => {
    const online = () => realtime.reconnectNow();
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, [realtime]);

  const login = useCallback(
    async (loginName: string, password: string, mfaCode?: string) => {
      await api.login({ login: loginName, password, ...(mfaCode ? { mfaCode } : {}) });
      setSignedOut(false);
    },
    [api],
  );
  const register = useCallback(
    async (email: string, username: string, password: string) => {
      await api.register({ email, username, password });
      setSignedOut(false);
    },
    [api],
  );
  const logout = useCallback(async () => {
    setSignedOut(true);
    realtime.close();
    await api.logout().catch(() => undefined);
  }, [api, realtime]);
  const loginWithTelegram = useCallback(
    async (opts: { create?: boolean; mfaCode?: string } = {}) => {
      const initData = telegramInitData();
      if (!initData) throw new Error('Open KofClub from Telegram to sign in with Telegram.');
      try {
        await api.loginWithTelegram({ initData, ...opts });
        setTelegram(telegramOutcome(initData, null));
        setSignedOut(false);
      } catch (err) {
        if (err instanceof ApiError && err.code !== 'MFA_REQUIRED') {
          setTelegram(telegramOutcome(initData, err));
        }
        throw err;
      }
    },
    [api],
  );
  const linkTelegram = useCallback(async () => {
    const initData = telegramInitData();
    if (!initData) throw new Error('Open KofClub from Telegram to link your Telegram account.');
    await api.linkTelegram(initData);
    setTelegram(telegramOutcome(initData, null));
  }, [api]);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      signedOut,
      user,
      api,
      ep,
      realtime,
      login,
      register,
      logout,
      telegram,
      loginWithTelegram,
      linkTelegram,
    }),
    [
      status,
      signedOut,
      user,
      api,
      ep,
      realtime,
      login,
      register,
      logout,
      telegram,
      loginWithTelegram,
      linkTelegram,
    ],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
