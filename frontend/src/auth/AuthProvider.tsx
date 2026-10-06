import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { QueryClient } from '@tanstack/react-query';

import { setAuthBridge } from '../api/authBridge';
import type { AppAuthClient, AppSession } from '../lib/supabase';

interface AuthContextValue {
  session: AppSession | null;
  loading: boolean;
  signIn: AppAuthClient['signInWithPassword'];
  signUp: AppAuthClient['signUp'];
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  client,
  queryClient,
  children,
}: {
  client: AppAuthClient;
  queryClient: QueryClient;
  children: ReactNode;
}) {
  const [session, setSession] = useState<AppSession | null>(null);
  const [loading, setLoading] = useState(true);

  setAuthBridge({
    getAccessToken: async () => (await client.getSession()).data.session?.access_token ?? null,
    refreshAccessToken: async () => (await client.refreshSession()).data.session?.access_token ?? null,
    signOut: async () => {
      queryClient.clear();
      await client.signOut();
      setSession(null);
    },
  });

  useEffect(() => {
    let live = true;
    void client.getSession().then(({ data }) => {
      if (!live) {
        return;
      }
      setSession(data.session);
      setLoading(false);
    });
    const { data } = client.onAuthStateChange((_event, next) => {
      setSession(next);
      setLoading(false);
    });
    return () => {
      live = false;
      data.subscription.unsubscribe();
    };
  }, [client]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      loading,
      signIn: async (credentials) => {
        const result = await client.signInWithPassword(credentials);
        if (result.data.session) {
          setSession(result.data.session);
        }
        return result;
      },
      signUp: async (credentials) => {
        const result = await client.signUp(credentials);
        if (result.data.session) {
          setSession(result.data.session);
        }
        return result;
      },
      signOut: async () => {
        queryClient.clear();
        await client.signOut();
        setSession(null);
      },
    }),
    [client, loading, queryClient, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used within AuthProvider.');
  }
  return value;
}
