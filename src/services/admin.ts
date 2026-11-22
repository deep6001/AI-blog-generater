import { apiFetch } from '../lib/supabase';

export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  lastSignInAt: string | null;
  isSuperAdmin: boolean;
  isDisabled: boolean;
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (HTTP ${res.status})`);
  return data as T;
}

export const listUsers = () => call<{ users: AdminUser[] }>('/api/admin/users').then((d) => d.users);

export const createUser = (input: { email: string; password: string; displayName: string; workspaceName: string }) =>
  call<{ id: string; email: string }>('/api/admin/users', input);

export const setUserAccess = (id: string, enabled: boolean) => call(`/api/admin/users/${id}/access`, { enabled });

export const setUserPassword = (id: string, password: string) => call(`/api/admin/users/${id}/password`, { password });
