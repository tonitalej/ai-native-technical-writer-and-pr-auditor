import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';

import { AuthProvider } from './auth/AuthProvider';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './components/ui/Toast';
import { createQueryClient } from './lib/queryClient';
import type { AppAuthClient } from './lib/supabase';
import { AppRoutes } from './routes';

export function AppProviders({
  auth,
  queryClient,
  children,
}: {
  auth: AppAuthClient;
  queryClient?: QueryClient;
  children: ReactNode;
}) {
  const [ownedClient] = useState(() => queryClient ?? createQueryClient());
  const client = queryClient ?? ownedClient;
  return (
    <AuthProvider client={auth} queryClient={client}>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <ErrorBoundary>{children}</ErrorBoundary>
        </ToastProvider>
      </QueryClientProvider>
    </AuthProvider>
  );
}

export function App({ auth }: { auth: AppAuthClient }) {
  return (
    <AppProviders auth={auth}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AppProviders>
  );
}
