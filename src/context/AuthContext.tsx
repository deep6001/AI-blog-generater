import React, { createContext, useContext, useState, useEffect } from 'react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { openedFromPasswordReset, supabase } from '../lib/supabase';

export type TenantRole = 'owner' | 'admin' | 'member';

export interface Tenant {
  id: string;
  name: string;
  ownerId: string;
  members: Record<string, TenantRole>;
  createdAt: string;
}

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  photoURL?: string;
  currentTenantId: string;
  createdAt: string;
}

/** The subset of the signed-in user the UI relies on. */
export interface AppUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

interface AuthContextType {
  user: AppUser | null;
  userProfile: UserProfile | null;
  currentTenant: Tenant | null;
  tenants: Tenant[];
  loading: boolean;
  error: string | null;
  /** The user arrived from a reset email and must choose a new password. */
  passwordRecovery: boolean;
  sendPasswordReset: (email: string) => Promise<void>;
  updatePassword: (newPassword: string) => Promise<void>;
  loginManual: (email: string, pass: string) => Promise<void>;
  registerManual: (email: string, pass: string, name: string, workspaceName?: string) => Promise<void>;
  createTenant: (workspaceName: string) => Promise<Tenant>;
  switchTenant: (tenantId: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function toAppUser(u: SupabaseUser): AppUser {
  const meta = u.user_metadata || {};
  return {
    uid: u.id,
    email: u.email ?? null,
    displayName: meta.display_name || meta.full_name || null,
    photoURL: meta.avatar_url || null,
  };
}

async function fetchTenants(): Promise<Tenant[]> {
  const { data: tenantRows, error } = await supabase
    .from('tenants')
    .select('id, name, owner_id, created_at, tenant_members (user_id, role)')
    .order('created_at', { ascending: true });
  if (error) throw error;

  return (tenantRows || []).map((t: any) => ({
    id: t.id,
    name: t.name,
    ownerId: t.owner_id,
    createdAt: t.created_at,
    members: Object.fromEntries((t.tenant_members || []).map((m: any) => [m.user_id, m.role])),
  }));
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AppUser | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [currentTenant, setCurrentTenant] = useState<Tenant | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [passwordRecovery, setPasswordRecovery] = useState(openedFromPasswordReset);

  const clearError = () => setError(null);

  // Profile and first workspace are created by the on_auth_user_created trigger.
  const loadWorkspace = async (authUser: SupabaseUser) => {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authUser.id)
      .single();
    if (profileError) throw profileError;

    const list = await fetchTenants();
    const active = list.find((t) => t.id === profile.current_tenant_id) || list[0] || null;

    setUserProfile({
      id: profile.id,
      email: profile.email,
      displayName: profile.display_name || profile.email,
      photoURL: profile.avatar_url || undefined,
      currentTenantId: active?.id || '',
      createdAt: profile.created_at,
    });
    setTenants(list);
    setCurrentTenant(active);
  };

  const clearWorkspace = () => {
    setUser(null);
    setUserProfile(null);
    setCurrentTenant(null);
    setTenants([]);
  };

  useEffect(() => {
    let mounted = true;

    const apply = async (authUser: SupabaseUser | null) => {
      if (!mounted) return;
      if (!authUser) {
        clearWorkspace();
        setLoading(false);
        return;
      }
      setUser(toAppUser(authUser));
      try {
        await loadWorkspace(authUser);
      } catch (err: any) {
        console.error('Could not load workspace:', err);
        if (mounted) setError(`Could not load your workspace: ${err?.message || err}`);
      }
      if (mounted) setLoading(false);
    };

    supabase.auth.getSession().then(({ data }) => apply(data.session?.user ?? null));

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
      // Token refreshes don't change who is signed in; skip the reload.
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        // Defer: Supabase deadlocks if we await its own API inside this callback.
        setTimeout(() => apply(session?.user ?? null), 0);
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const sendPasswordReset = async (email: string) => {
    setError(null);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin,
    });
    if (err) throw new Error(err.message);
  };

  const updatePassword = async (newPassword: string) => {
    setError(null);
    const { error: err } = await supabase.auth.updateUser({ password: newPassword });
    if (err) throw new Error(err.message);
    setPasswordRecovery(false);
  };

  const loginManual = async (email: string, pass: string) => {
    setError(null);
    setLoading(true);
    try {
      const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pass });
      if (err) {
        const msg =
          err.message === 'Invalid login credentials'
            ? 'Incorrect email or password. Please verify your credentials or create a new account.'
            : err.message;
        setError(msg);
        throw new Error(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const registerManual = async (email: string, pass: string, displayName: string, workspaceName?: string) => {
    setError(null);
    setLoading(true);
    try {
      const { data, error: err } = await supabase.auth.signUp({
        email: email.trim(),
        password: pass,
        options: {
          data: { display_name: displayName.trim(), workspace_name: workspaceName?.trim() || '' },
          emailRedirectTo: window.location.origin,
        },
      });
      if (err) {
        setError(err.message);
        throw err;
      }
      if (!data.session) {
        const msg = 'Account created. Check your inbox and confirm your email, then sign in.';
        setError(msg);
        throw new Error(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const createTenant = async (workspaceName: string): Promise<Tenant> => {
    if (!user) throw new Error('You must be signed in to create a workspace.');
    setError(null);

    const { data, error: err } = await supabase.rpc('create_tenant', { tenant_name: workspaceName });
    if (err) {
      setError(err.message);
      throw err;
    }

    const created: Tenant = {
      id: data.id,
      name: data.name,
      ownerId: data.owner_id,
      createdAt: data.created_at,
      members: { [user.uid]: 'owner' },
    };
    setTenants((prev) => [...prev, created]);
    setCurrentTenant(created);
    setUserProfile((prev) => (prev ? { ...prev, currentTenantId: created.id } : prev));
    return created;
  };

  const switchTenant = async (tenantId: string) => {
    const target = tenants.find((t) => t.id === tenantId);
    if (!target || !user) return;

    setCurrentTenant(target);
    setUserProfile((prev) => (prev ? { ...prev, currentTenantId: tenantId } : prev));
    const { error: err } = await supabase.from('profiles').update({ current_tenant_id: tenantId }).eq('id', user.uid);
    if (err) console.warn('Could not persist active workspace:', err.message);
  };

  const logout = async () => {
    await supabase.auth.signOut();
    clearWorkspace();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        userProfile,
        currentTenant,
        tenants,
        loading,
        error,
        passwordRecovery,
        sendPasswordReset,
        updatePassword,
        loginManual,
        registerManual,
        createTenant,
        switchTenant,
        logout,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
