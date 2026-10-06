import { userSchema, type User } from '../types/api';
import { apiFetch } from './client';

export async function getMe(): Promise<{ user: User; requestId: string | null }> {
  const result = await apiFetch('/api/me', userSchema);
  return { user: result.data, requestId: result.requestId };
}

export async function updateMe(displayName: string | null): Promise<{ user: User; requestId: string | null }> {
  const result = await apiFetch('/api/me', userSchema, {
    method: 'PATCH',
    body: { display_name: displayName },
  });
  return { user: result.data, requestId: result.requestId };
}
