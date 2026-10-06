import { createClient, type Session } from '@supabase/supabase-js';

export interface AppSession {
  access_token: string;
  user: { id: string; email?: string | null };
}

export interface AuthResult {
  data: { session: AppSession | null };
  error: { message: string } | null;
}

export interface AppAuthClient {
  getSession: () => Promise<AuthResult>;
  refreshSession: () => Promise<AuthResult>;
  onAuthStateChange: (
    callback: (event: string, session: AppSession | null) => void,
  ) => { data: { subscription: { unsubscribe: () => void } } };
  signInWithPassword: (credentials: { email: string; password: string }) => Promise<AuthResult>;
  signUp: (credentials: {
    email: string;
    password: string;
    options?: { data?: { display_name?: string } };
  }) => Promise<AuthResult>;
  signOut: () => Promise<{ error: { message: string } | null }>;
}

export function createSupabaseAuth(url: string, key: string): AppAuthClient {
  const client = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return {
    async getSession() {
      const { data, error } = await client.auth.getSession();
      return { data: { session: toSession(data.session) }, error: error ? { message: error.message } : null };
    },
    async refreshSession() {
      const { data, error } = await client.auth.refreshSession();
      return { data: { session: toSession(data.session) }, error: error ? { message: error.message } : null };
    },
    onAuthStateChange(callback) {
      const { data } = client.auth.onAuthStateChange((event, session) => {
        callback(event, toSession(session));
      });
      return { data };
    },
    async signInWithPassword(credentials) {
      const { data, error } = await client.auth.signInWithPassword(credentials);
      return { data: { session: toSession(data.session) }, error: error ? { message: error.message } : null };
    },
    async signUp(credentials) {
      const { data, error } = await client.auth.signUp(credentials);
      return { data: { session: toSession(data.session) }, error: error ? { message: error.message } : null };
    },
    async signOut() {
      const { error } = await client.auth.signOut();
      return { error: error ? { message: error.message } : null };
    },
  };
}

function toSession(session: Session | null): AppSession | null {
  if (!session) {
    return null;
  }
  return {
    access_token: session.access_token,
    user: { id: session.user.id, email: session.user.email },
  };
}
