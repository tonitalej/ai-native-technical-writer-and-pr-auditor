import { NavLink, Outlet } from 'react-router-dom';

import { useAuth } from '../../auth/AuthProvider';
import { useMe } from '../../hooks/useServerState';
import { Button } from '../ui/Button';

export function AppShell() {
  const { session, signOut } = useAuth();
  const me = useMe(Boolean(session));
  const profile = me.data?.user;
  const label = profile?.display_name || profile?.email || session?.user.email || 'Signed in';
  return (
    <>
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <header className="app-header">
        <NavLink className="brand" to="/repositories">
          <span className="brand-mark" aria-hidden="true" />
          PR Auditor
        </NavLink>
        <nav className="nav" aria-label="Primary">
          <NavLink to="/repositories">Repositories</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        <div className="header-spacer" />
        <div className="who">
          <span>{label}</span>
          <Button variant="ghost" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </header>
      <main id="content" className="page">
        <Outlet />
      </main>
    </>
  );
}
