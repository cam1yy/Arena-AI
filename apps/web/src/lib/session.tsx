import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MeResponse, PublicConfig } from '@localy/shared';
import { api, ApiError, onAuthError } from './api';
import { clearPlaceCache } from './places';

interface SessionValue {
  me: MeResponse | null;
  config: PublicConfig | null;
  loading: boolean;
  refresh: () => Promise<unknown>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const config = useQuery<PublicConfig>({ queryKey: ['config'], queryFn: () => api.get('/api/config'), staleTime: 5 * 60_000 });
  const me = useQuery<MeResponse | null, ApiError>({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<MeResponse>('/api/me');
      } catch (err) {
        if (err instanceof ApiError && (err.status === 401 || err.code === 'FORBIDDEN')) return null;
        throw err;
      }
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  useEffect(
    () =>
      onAuthError(() => {
        if (qc.getQueryData(['me'])) {
          qc.setQueryData(['me'], null);
        }
      }),
    [qc],
  );

  const value: SessionValue = {
    me: me.data ?? null,
    config: config.data ?? null,
    loading: me.isLoading || config.isLoading,
    refresh: () => qc.invalidateQueries({ queryKey: ['me'] }),
    signOut: async () => {
      await api.post('/api/auth/signout').catch(() => undefined);
      clearPlaceCache();
      qc.clear();
      qc.setQueryData(['me'], null);
      window.location.href = '/signin';
    },
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}

/** For pages inside the authenticated app shell, where `me` is guaranteed. */
export function useMe(): MeResponse {
  const { me } = useSession();
  if (!me) throw new Error('useMe requires an authenticated session');
  return me;
}

export function useCan() {
  const { me } = useSession();
  const role = me?.workspace.role;
  return {
    manageWorkspace: role === 'owner' || role === 'admin',
    manageBilling: role === 'owner' || role === 'admin',
    isOwner: role === 'owner',
    readOnly: me ? !me.billing.canUseFeatures : false,
  };
}
