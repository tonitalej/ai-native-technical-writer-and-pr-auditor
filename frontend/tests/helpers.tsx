import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { setApiBase } from '../src/api/client';
import { AppProviders } from '../src/App';
import { AppRoutes } from '../src/routes';
import { createQueryClient } from '../src/lib/queryClient';
import type { AppAuthClient, AppSession } from '../src/lib/supabase';

export const session: AppSession = {
  access_token: 'test-access-token',
  user: { id: '22222222-2222-4222-8222-222222222222', email: 'ada@example.com' },
};

export function createFakeAuth(options?: {
  session?: AppSession | null;
  signupSession?: AppSession | null;
  signInError?: boolean;
}): AppAuthClient & {
  refreshCalls: () => number;
  signedOut: () => boolean;
  lastSignup: () => unknown;
} {
  let current = options && 'session' in options ? options.session ?? null : session;
  if (options && options.session === null) {
    current = null;
  }
  let signedOut = false;
  let signup: unknown = null;
  let refreshCalls = 0;
  const listeners = new Set<(event: string, next: AppSession | null) => void>();
  const client: AppAuthClient = {
    async getSession() {
      return { data: { session: current }, error: null };
    },
    async refreshSession() {
      refreshCalls += 1;
      return { data: { session: current }, error: null };
    },
    onAuthStateChange(callback) {
      listeners.add(callback);
      return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
    },
    async signInWithPassword() {
      if (options?.signInError) {
        return { data: { session: null }, error: { message: 'Invalid login credentials' } };
      }
      current = session;
      return { data: { session: current }, error: null };
    },
    async signUp(credentials) {
      signup = credentials;
      const next = options && 'signupSession' in options ? options.signupSession ?? null : session;
      current = next;
      return { data: { session: next }, error: null };
    },
    async signOut() {
      signedOut = true;
      current = null;
      listeners.forEach((listener) => listener('SIGNED_OUT', null));
      return { error: null };
    },
  };
  return Object.assign(client, {
    refreshCalls: () => refreshCalls,
    signedOut: () => signedOut,
    lastSignup: () => signup,
  });
}

export function renderAt(path: string, auth = createFakeAuth()) {
  setApiBase('http://localhost:3000');
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({ queries: { retry: false } });
  const view = render(
    <AppProviders auth={auth} queryClient={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </AppProviders>,
  );
  return { ...view, auth, queryClient };
}
