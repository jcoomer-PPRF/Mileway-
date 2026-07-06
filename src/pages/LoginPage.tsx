import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { AlertCircle, Gauge, Mail } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { isSupabaseConfigured } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';

type Mode = 'signin' | 'signup';

export function LoginPage() {
  const { session, deactivated, signInWithEmail, signUpWithEmail, signInWithGoogle } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (session) return <Navigate to="/" replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      if (mode === 'signin') {
        const { error } = await signInWithEmail(email, password);
        if (error) setError(error);
      } else {
        const { error, needsConfirmation } = await signUpWithEmail(email, password, fullName);
        if (error) setError(error);
        else if (needsConfirmation) setInfo('Account created. Check your email to confirm, then sign in.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    const { error } = await signInWithGoogle();
    if (error) setError(error);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-600 text-white">
            <Gauge className="h-7 w-7" />
          </div>
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900">Mileway</h1>
          <p className="text-sm text-slate-500">Mileage, vehicles &amp; expenses — Foundation + Operating LLC</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          {deactivated && (
            <div className="mb-4 flex items-start gap-2 rounded-md bg-red-50 p-3 text-sm text-red-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>This account has been deactivated. Contact an administrator if you believe this is an error.</span>
            </div>
          )}

          {!isSupabaseConfigured && (
            <div className="mb-4 flex items-start gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Supabase isn’t configured. Copy <code>.env.example</code> to <code>.env</code> and add your project URL and anon key.</span>
            </div>
          )}

          <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 text-sm font-medium">
            <button
              type="button"
              onClick={() => setMode('signin')}
              className={mode === 'signin' ? 'rounded-md bg-white py-1.5 shadow-sm' : 'py-1.5 text-slate-500'}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => setMode('signup')}
              className={mode === 'signup' ? 'rounded-md bg-white py-1.5 shadow-sm' : 'py-1.5 text-slate-500'}
            >
              Sign up
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            {mode === 'signup' && (
              <Field label="Full name" required>
                <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required autoComplete="name" />
              </Field>
            )}
            <Field label="Email" required>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </Field>
            <Field label="Password" required>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              />
            </Field>

            {error && <p className="text-sm text-red-600">{error}</p>}
            {info && <p className="text-sm text-emerald-700">{info}</p>}

            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? <Spinner className="text-white" /> : <Mail className="h-4 w-4" />}
              {mode === 'signin' ? 'Sign in with email' : 'Create account'}
            </Button>
          </form>

          <div className="my-4 flex items-center gap-3 text-xs text-slate-400">
            <span className="h-px flex-1 bg-slate-200" />
            OR
            <span className="h-px flex-1 bg-slate-200" />
          </div>

          <Button type="button" variant="secondary" className="w-full" onClick={handleGoogle}>
            <GoogleIcon />
            Continue with Google
          </Button>
        </div>

        <p className="mt-4 text-center text-xs text-slate-400">
          The first account created becomes the Administrator.
        </p>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.31 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}
