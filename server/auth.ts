// Every AI and upload endpoint costs money or reads files, so it requires a signed-in Supabase user
// whose access has not been disabled by a super admin.
import type { NextFunction, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const authOptions = { auth: { persistSession: false, autoRefreshToken: false } };
const supabase = url && anonKey ? createClient(url, anonKey, authOptions) : null;

export interface SessionUser {
  userId: string;
  isSuperAdmin: boolean;
  isDisabled: boolean;
}

// Verified tokens are reused briefly so a multi-step run doesn't re-check Supabase on every call.
const CACHE_MS = 60_000;
const verified = new Map<string, SessionUser & { until: number }>();

/** Drops cached checks for a user, so a change to their access applies on their next request. */
export function forgetUser(userId: string) {
  for (const [token, v] of verified) if (v.userId === userId) verified.delete(token);
}

export async function userForToken(token: string): Promise<SessionUser | null> {
  const hit = verified.get(token);
  if (hit && hit.until > Date.now()) return hit;
  if (!supabase || !url || !anonKey) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;

  // Read the flags as the user. A disabled user's row is hidden by row-level security, so no row
  // means no access.
  const asUser = createClient(url, anonKey, { ...authOptions, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: profile } = await asUser.from('profiles').select('is_super_admin, is_disabled').eq('id', data.user.id).maybeSingle();
  const user: SessionUser = {
    userId: data.user.id,
    isSuperAdmin: Boolean(profile?.is_super_admin),
    isDisabled: !profile || Boolean(profile.is_disabled),
  };
  if (verified.size > 1000) verified.clear();
  verified.set(token, { ...user, until: Date.now() + CACHE_MS });
  return user;
}

export async function requireUser(req: Request, res: Response, next: NextFunction) {
  if (!supabase) {
    res.status(503).json({ error: 'Sign-in is not configured on the server (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY).' });
    return;
  }
  const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const user = token ? await userForToken(token).catch(() => null) : null;
  if (!user) {
    res.status(401).json({ error: 'Please sign in to use the AI features.' });
    return;
  }
  if (user.isDisabled) {
    res.status(403).json({ error: 'Your access has been disabled. Please contact your administrator.' });
    return;
  }
  res.locals.userId = user.userId;
  res.locals.isSuperAdmin = user.isSuperAdmin;
  next();
}
