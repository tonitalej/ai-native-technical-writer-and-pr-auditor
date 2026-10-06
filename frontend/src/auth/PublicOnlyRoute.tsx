import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';

import { LoadingScreen } from '../components/ui/Feedback';
import { useAuth } from './AuthProvider';

export function PublicOnlyRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) {
    return <LoadingScreen label="Checking your session" />;
  }
  if (session) {
    return <Navigate to="/repositories" replace />;
  }
  return children;
}
