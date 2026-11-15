import React, { useState } from 'react';
import { AlertCircle, ArrowRight, Eye, EyeOff, Lock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const inputClass =
  'w-full pl-9 pr-10 py-2.5 rounded-md bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:focus:ring-slate-700';

/** Shown after the user opens the link from a password reset email. */
export const ResetPasswordScreen: React.FC = () => {
  const { user, updatePassword, logout } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 6) return setError('Password must be at least 6 characters.');
    if (password !== confirm) return setError('The two passwords do not match.');
    setSaving(true);
    try {
      await updatePassword(password);
    } catch (err: any) {
      setError(err.message || 'Could not update your password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center px-4">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-md bg-slate-900 dark:bg-slate-100 text-slate-50 dark:text-slate-900 font-serif text-xl mb-5">
          B
        </div>
        <h1 className="text-3xl text-slate-900 dark:text-slate-100">Choose a new password</h1>
        {user?.email && <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">For {user.email}</p>}
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 sm:p-8 space-y-5">
          {!user ? (
            <div className="space-y-4 text-sm text-slate-600 dark:text-slate-300">
              <p>This reset link has expired or was already used. Request a new one from the sign-in page.</p>
              <button
                type="button"
                onClick={() => logout().then(() => window.location.replace(window.location.origin))}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="p-3.5 rounded-lg bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
              {[
                { label: 'New password', value: password, set: setPassword, auto: true },
                { label: 'Confirm new password', value: confirm, set: setConfirm, auto: false },
              ].map((f) => (
                <div key={f.label} className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">{f.label}</label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                    <input
                      type={show ? 'text' : 'password'}
                      required
                      autoFocus={f.auto}
                      autoComplete="new-password"
                      value={f.value}
                      onChange={(e) => f.set(e.target.value)}
                      placeholder="At least 6 characters"
                      className={inputClass}
                    />
                    {f.auto && (
                      <button
                        type="button"
                        onClick={() => setShow(!show)}
                        className="absolute right-3 top-3 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                      >
                        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <button
                type="submit"
                disabled={saving}
                className="w-full mt-2 h-10 px-4 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
              >
                <span>{saving ? 'Saving…' : 'Save new password'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
