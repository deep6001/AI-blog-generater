// Super admin user management: list users, create users with a password, disable or enable access,
// and set a new password. Uses the Supabase service role key, which only the server holds.
import type { NextFunction, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { forgetUser } from './auth';

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = url && serviceKey ? createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

/** Supabase's way to block sign-in: a ban long enough to be permanent until lifted. */
const DISABLED_BAN = '876000h';

export class AdminError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  lastSignInAt: string | null;
  isSuperAdmin: boolean;
  isDisabled: boolean;
}

/** Runs after requireUser. */
export function requireSuperAdmin(_req: Request, res: Response, next: NextFunction) {
  if (!res.locals.isSuperAdmin) {
    res.status(403).json({ error: 'Only a super admin can manage users.' });
    return;
  }
  if (!admin) {
    res.status(503).json({ error: 'User management needs SUPABASE_SERVICE_ROLE_KEY in the server environment.' });
    return;
  }
  next();
}

const client = () => {
  if (!admin) throw new AdminError(503, 'User management needs SUPABASE_SERVICE_ROLE_KEY in the server environment.');
  return admin;
};

export async function listUsers(): Promise<AdminUser[]> {
  const sb = client();
  const users: any[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new AdminError(502, error.message);
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }
  const { data: profiles, error } = await sb.from('profiles').select('id, display_name, is_super_admin, is_disabled');
  if (error) throw new AdminError(502, error.message);
  const byId = new Map((profiles || []).map((p: any) => [p.id, p]));
  return users
    .map((u) => {
      const p: any = byId.get(u.id) || {};
      return {
        id: u.id,
        email: u.email || '',
        displayName: p.display_name || u.user_metadata?.display_name || '',
        createdAt: u.created_at,
        lastSignInAt: u.last_sign_in_at || null,
        isSuperAdmin: Boolean(p.is_super_admin),
        isDisabled: Boolean(p.is_disabled),
      };
    })
    .sort((a, b) => a.email.localeCompare(b.email));
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const checkPassword = (password: unknown): string => {
  if (typeof password !== 'string' || password.length < 8) throw new AdminError(400, 'The password must be at least 8 characters.');
  return password;
};

export async function createUser(input: { email?: unknown; password?: unknown; displayName?: unknown; workspaceName?: unknown }) {
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  if (!EMAIL.test(email)) throw new AdminError(400, 'Enter a valid email address.');
  const password = checkPassword(input.password);
  const displayName = typeof input.displayName === 'string' ? input.displayName.trim().slice(0, 100) : '';
  const workspaceName = typeof input.workspaceName === 'string' ? input.workspaceName.trim().slice(0, 100) : '';

  // The on_auth_user_created trigger makes their profile and first workspace.
  const { data, error } = await client().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName, workspace_name: workspaceName },
  });
  if (error) {
    const exists = /already|registered|exists/i.test(error.message);
    throw new AdminError(exists ? 409 : 400, exists ? 'A user with this email already exists.' : error.message);
  }
  return { id: data.user.id, email };
}

export async function setAccess(userId: string, enabled: boolean, actorId: string) {
  const sb = client();
  if (userId === actorId) throw new AdminError(400, "You can't disable your own account.");
  const { data: target } = await sb.from('profiles').select('is_super_admin').eq('id', userId).maybeSingle();
  if (!target) throw new AdminError(404, 'User not found.');
  if (!enabled && target.is_super_admin) throw new AdminError(400, "Super admins can't be disabled here.");

  // Block (or allow) sign-in and token refresh, then hide their data from any session still open.
  const { error } = await sb.auth.admin.updateUserById(userId, { ban_duration: enabled ? 'none' : DISABLED_BAN });
  if (error) throw new AdminError(502, error.message);
  const { error: flagError } = await sb.from('profiles').update({ is_disabled: !enabled }).eq('id', userId);
  if (flagError) throw new AdminError(502, flagError.message);
  forgetUser(userId);
}

export async function setPassword(userId: string, password: unknown) {
  const { error } = await client().auth.admin.updateUserById(userId, { password: checkPassword(password) });
  if (error) throw new AdminError(/not found/i.test(error.message) ? 404 : 502, error.message);
}
