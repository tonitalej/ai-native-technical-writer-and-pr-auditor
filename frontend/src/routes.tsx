import { Navigate, Route, Routes } from 'react-router-dom';

import { ProtectedRoute } from './auth/ProtectedRoute';
import { PublicOnlyRoute } from './auth/PublicOnlyRoute';
import { useAuth } from './auth/AuthProvider';
import { AppShell } from './components/layout/AppShell';
import { LoadingScreen } from './components/ui/Feedback';
import { AuditPage } from './pages/AuditPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PullRequestPage } from './pages/PullRequestPage';
import { RepositoriesPage } from './pages/RepositoriesPage';
import { RepositoryPage } from './pages/RepositoryPage';
import { SettingsPage } from './pages/SettingsPage';
import { SignupPage } from './pages/SignupPage';

function HomeRedirect() {
  const { session, loading } = useAuth();
  if (loading) {
    return <LoadingScreen label="Checking your session" />;
  }
  return <Navigate to={session ? '/repositories' : '/login'} replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/login" element={<PublicOnlyRoute><LoginPage /></PublicOnlyRoute>} />
      <Route path="/signup" element={<PublicOnlyRoute><SignupPage /></PublicOnlyRoute>} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/repositories" element={<RepositoriesPage />} />
          <Route path="/repositories/:repoId" element={<RepositoryPage />} />
          <Route path="/pull-requests/:prId" element={<PullRequestPage />} />
          <Route path="/audits/:auditId" element={<AuditPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
