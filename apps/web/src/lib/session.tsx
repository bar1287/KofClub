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
import { ApiClient } from './api/client';
import { endpoints, type Endpoints } from './api/endpoints';
import { publicEnv } from './env';
import { RealtimeClient } from './realtime/client';
import type { User } from './types';

export type SessionStatus = 'loading' | 'authenticated' | 'anonymous';

interface SessionValue {
  status: SessionStatus;
  user: User | null;
  api: ApiClient;
  ep: Endpoints;
  realtime: RealtimeClient;
  login(login: string, password: string): Promise<void>;
  register(email: string, username: string, password: string): Promise<void>;
  logout(): Promise<void>;
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
    const api = new ApiClient({ baseUrl: publicEnv.apiUrl, locks });
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

let restoring: Promise<User | null> | null = null;

/** Restores the session once per page load (StrictMode runs effects twice). */
function restoreOnce(api: ApiClient): Promise<User | null> {
  restoring ??= api.restore().catch(() => null);
  return restoring;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const { api, ep, realtime } = useMemo(getClients, []);
  const [status, setStatus] = useState<SessionStatus>(() =>
    api.auth.user ? 'authenticated' : 'loading',
  );
  const [user, setUser] = useState<User | null>(api.auth.user);

  useEffect(() => {
    const off = api.onAuthChange((s) => {
      setUser(s.user);
      setStatus(s.user ? 'authenticated' : 'anonymous');
    });
    if (!api.auth.user) {
      void restoreOnce(api).then((u) => {
        setUser(u);
        setStatus(u ? 'authenticated' : 'anonymous');
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
    async (loginName: string, password: string) => {
      await api.login({ login: loginName, password });
    },
    [api],
  );
  const register = useCallback(
    async (email: string, username: string, password: string) => {
      await api.register({ email, username, password });
    },
    [api],
  );
  const logout = useCallback(async () => {
    realtime.close();
    await api.logout().catch(() => undefined);
  }, [api, realtime]);

  const value = useMemo<SessionValue>(
    () => ({ status, user, api, ep, realtime, login, register, logout }),
    [status, user, api, ep, realtime, login, register, logout],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
