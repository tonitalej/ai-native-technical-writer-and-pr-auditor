import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ConfigError } from '../../src/components/ConfigError';
import { loadEnv, resetEnvWarningForTests } from '../../src/config/env';

describe('environment', () => {
  it('reads the publishable key when it is present', () => {
    resetEnvWarningForTests();
    const result = loadEnv({
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
      VITE_SUPABASE_ANON_KEY: 'anon-legacy',
      VITE_API_URL: 'http://localhost:3000',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.env.supabaseKey).toBe('sb_publishable_test');
      expect(result.env.supabaseKeySource).toBe('publishable');
    }
  });

  it('falls back to the anon key and warns once', () => {
    resetEnvWarningForTests();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = loadEnv({
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon-legacy',
      VITE_API_URL: 'http://localhost:3000/',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.env.supabaseKey).toBe('anon-legacy');
      expect(result.env.apiUrl).toBe('http://localhost:3000');
    }
    expect(warn).toHaveBeenCalledOnce();
    loadEnv({
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon-legacy',
      VITE_API_URL: 'http://localhost:3000',
    });
    expect(warn).toHaveBeenCalledOnce();
  });

  it('shows a configuration error when required values are missing', () => {
    const result = loadEnv({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      render(<ConfigError problems={result.problems} />);
    }
    expect(screen.getByRole('heading', { name: /missing its environment/i })).toBeTruthy();
    expect(screen.getByText(/VITE_SUPABASE_URL is missing/)).toBeTruthy();
    expect(screen.getByText(/VITE_API_URL is missing/)).toBeTruthy();
    expect(screen.getByText(/VITE_SUPABASE_PUBLISHABLE_KEY is missing/)).toBeTruthy();
  });
});
