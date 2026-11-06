// Every AI and upload endpoint costs money or reads files, so it requires a signed-in Supabase user.
import type { NextFunction, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = url && anonKey ? createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

// Verified tokens are reused briefly so a multi-step run doesn't re-check Supabase on every call.
const CACHE_MS = 60_000;
const verified = new Map<string, { userId: string; until: number }>();

export async function userIdForToken(token: string): Promise<string | null> {
  const hit = verified.get(token);
  if (hit && hit.until > Date.now()) return hit.userId;
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  if (verified.size > 1000) verified.clear();
  verified.set(token, { userId: data.user.id, until: Date.now() + CACHE_MS });
  return data.user.id;
}

export async function requireUser(req: Request, res: Response, next: NextFunction) {
  if (!supabase) {
    res.status(503).json({ error: 'Sign-in is not configured on the server (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY).' });
    return;
  }
  const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const userId = token ? await userIdForToken(token).catch(() => null) : null;
  if (!userId) {
    res.status(401).json({ error: 'Please sign in to use the AI features.' });
    return;
  }
  res.locals.userId = userId;
  next();
}
