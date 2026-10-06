import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { LoadingScreen } from '../components/ui/Feedback';
import { useAuth } from './AuthProvider';

export function ProtectedRoute() {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return <LoadingScreen label="Checking your session" />;
  }
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <Outlet />;
}
