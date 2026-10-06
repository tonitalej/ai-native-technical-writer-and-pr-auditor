import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { ConfigError } from './components/ConfigError';
import { loadEnv } from './config/env';
import { setApiBase } from './api/client';
import { createSupabaseAuth } from './lib/supabase';
import './styles/base.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element is missing.');
}

const loaded = loadEnv(import.meta.env);
if (!loaded.ok) {
  createRoot(root).render(<ConfigError problems={loaded.problems} />);
} else {
  setApiBase(loaded.env.apiUrl);
  const auth = createSupabaseAuth(loaded.env.supabaseUrl, loaded.env.supabaseKey);
  createRoot(root).render(
    <StrictMode>
      <App auth={auth} />
    </StrictMode>,
  );
}
