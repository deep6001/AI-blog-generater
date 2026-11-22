import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, KeyRound, Loader2, Search, ShieldCheck, UserPlus, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { AdminUser, createUser, listUsers, setUserAccess, setUserPassword } from '../services/admin';

const input =
  'w-full px-3 py-2 rounded-md bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-slate-700';
const btn =
  'inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium transition-colors disabled:opacity-50';

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Never');

/** A readable random password the admin can copy and share. */
function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

export const AdminPanel: React.FC = () => {
  const { user } = useAuth();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [passwordFor, setPasswordFor] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ displayName: '', email: '', password: generatePassword(), workspaceName: '' });
  const [creating, setCreating] = useState(false);

  const load = () =>
    listUsers()
      .then((u) => {
        setUsers(u);
        setError(null);
      })
      .catch((err) => setError(err.message));

  useEffect(() => {
    load();
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (users || []).filter((u) => !q || u.email.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q));
  }, [users, query]);

  const run = async (id: string, action: () => Promise<unknown>, message: string) => {
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(message);
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
      setConfirmId(null);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      await createUser(form);
      setNotice(`Created ${form.email.trim()}. Share this password with them: ${form.password}`);
      setForm({ displayName: '', email: '', password: generatePassword(), workspaceName: '' });
      setShowForm(false);
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const active = (users || []).filter((u) => !u.isDisabled).length;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl text-slate-900 dark:text-slate-100">Users</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {users ? `${users.length} users, ${active} with access` : 'Create users and control who can sign in.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className={`${btn} h-9 px-4 bg-indigo-600 hover:bg-indigo-700 text-white text-sm`}
        >
          {showForm ? <X className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
          <span>{showForm ? 'Close' : 'Add user'}</span>
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-sm flex gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-sm flex gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="break-all">{notice}</span>
        </div>
      )}

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 grid gap-4 sm:grid-cols-2"
        >
          <label className="space-y-1.5 text-xs font-medium text-slate-700 dark:text-slate-300">
            <span>Name</span>
            <input className={input} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} placeholder="e.g. Dr Sarah Khan" />
          </label>
          <label className="space-y-1.5 text-xs font-medium text-slate-700 dark:text-slate-300">
            <span>Email</span>
            <input className={input} type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@clinic.com" />
          </label>
          <label className="space-y-1.5 text-xs font-medium text-slate-700 dark:text-slate-300">
            <span>Password (at least 8 characters)</span>
            <div className="flex gap-2">
              <input className={`${input} font-mono`} required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              <button type="button" onClick={() => setForm({ ...form, password: generatePassword() })} className={`${btn} h-auto border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300`}>
                New
              </button>
            </div>
          </label>
          <label className="space-y-1.5 text-xs font-medium text-slate-700 dark:text-slate-300">
            <span>Workspace name</span>
            <input className={input} value={form.workspaceName} onChange={(e) => setForm({ ...form, workspaceName: e.target.value })} placeholder="e.g. London Medical Clinic" />
          </label>
          <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-500 dark:text-slate-400">They can sign in straight away. Share the password privately; they can change it with "Forgot password?".</p>
            <button type="submit" disabled={creating} className={`${btn} h-9 px-4 bg-indigo-600 hover:bg-indigo-700 text-white text-sm`}>
              {creating && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>Create user</span>
            </button>
          </div>
        </form>
      )}

      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
        <input className={`${input} pl-9`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or email" />
      </div>

      {!users && !error ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Loading users</span>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          {shown.map((u) => {
            const self = u.id === user?.uid;
            const busy = busyId === u.id;
            return (
              <li key={u.id} className="p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-slate-900 dark:text-slate-100 break-all">{u.displayName || u.email}</span>
                      {u.isSuperAdmin && (
                        <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300">
                          <ShieldCheck className="w-3 h-3" /> Super admin
                        </span>
                      )}
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-full ${
                          u.isDisabled
                            ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300'
                            : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                        }`}
                      >
                        {u.isDisabled ? 'Disabled' : 'Active'}
                      </span>
                      {self && <span className="text-[11px] text-slate-400">You</span>}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 break-all">
                      {u.displayName ? `${u.email} · ` : ''}Added {date(u.createdAt)} · Last sign-in {date(u.lastSignInAt)}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setPasswordFor(passwordFor === u.id ? null : u.id);
                        setNewPassword(generatePassword());
                      }}
                      className={`${btn} border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800`}
                    >
                      <KeyRound className="w-3.5 h-3.5" /> Set password
                    </button>
                    {!self && !(u.isSuperAdmin && !u.isDisabled) &&
                      (u.isDisabled ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => run(u.id, () => setUserAccess(u.id, true), `${u.email} can sign in again.`)}
                          className={`${btn} bg-emerald-600 hover:bg-emerald-700 text-white`}
                        >
                          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Enable access
                        </button>
                      ) : confirmId === u.id ? (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => run(u.id, () => setUserAccess(u.id, false), `${u.email} has been disabled and signed out.`)}
                            className={`${btn} bg-rose-600 hover:bg-rose-700 text-white`}
                          >
                            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Confirm disable
                          </button>
                          <button type="button" onClick={() => setConfirmId(null)} className={`${btn} text-slate-500`}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmId(u.id)}
                          className={`${btn} border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40`}
                        >
                          Disable access
                        </button>
                      ))}
                  </div>
                </div>
                {passwordFor === u.id && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      run(u.id, () => setUserPassword(u.id, newPassword), `New password for ${u.email}: ${newPassword}`).then(() => setPasswordFor(null));
                    }}
                    className="flex flex-wrap gap-2"
                  >
                    <input className={`${input} font-mono max-w-xs`} minLength={8} required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                    <button type="submit" disabled={busy} className={`${btn} h-auto bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900`}>
                      Save password
                    </button>
                  </form>
                )}
              </li>
            );
          })}
          {users && !shown.length && <li className="p-4 text-sm text-slate-500">No users match "{query}".</li>}
        </ul>
      )}
    </div>
  );
};
