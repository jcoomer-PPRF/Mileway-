import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Profile, UserRole } from '@/types/db';

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  /** True when the last session belonged to a deactivated account (we signed it out). */
  deactivated: boolean;
  role: UserRole | null;
  isOwner: boolean; // full access incl. settings + user management
  canEditAll: boolean; // owner or manager — edit any operational record
  canWrite: boolean; // owner, manager, or contributor — create records
  canReadFinancials: boolean; // owner, manager, accountant, or auditor
  isAuditor: boolean;
  isAccountant: boolean;
  signInWithEmail: (email: string, password: string) => Promise<{ error: string | null }>;
  signUpWithEmail: (
    email: string,
    password: string,
    fullName: string,
  ) => Promise<{ error: string | null; needsConfirmation: boolean }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [deactivated, setDeactivated] = useState(false);

  async function loadProfile(userId: string) {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
    if (error) {
      console.error('Failed to load profile', error);
      setProfile(null);
      return;
    }
    // A deactivated account must not reach the app, even with a still-valid
    // session. RLS already blocks its data access; this signs it out and
    // routes it to the deactivated-account message on the login screen.
    if (data && data.is_active === false) {
      setProfile(null);
      setDeactivated(true);
      await supabase.auth.signOut();
      return;
    }
    setProfile(data as Profile | null);
  }

  useEffect(() => {
    let active = true;

    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (!active) return;
        setSession(data.session);
        if (data.session?.user) await loadProfile(data.session.user.id);
      })
      .catch((err) => console.error('getSession failed', err))
      .finally(() => {
        if (active) setLoading(false);
      });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession);
      if (newSession?.user) {
        await loadProfile(newSession.user.id);
      } else {
        setProfile(null);
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      session,
      profile,
      loading,
      deactivated,
      role: profile?.role ?? null,
      isOwner: profile?.role === 'owner',
      canEditAll: profile?.role === 'owner' || profile?.role === 'manager',
      canWrite:
        profile?.role === 'owner' || profile?.role === 'manager' || profile?.role === 'contributor',
      canReadFinancials:
        profile?.role === 'owner' ||
        profile?.role === 'manager' ||
        profile?.role === 'accountant' ||
        profile?.role === 'auditor',
      isAuditor: profile?.role === 'auditor',
      isAccountant: profile?.role === 'accountant',
      async signInWithEmail(email, password) {
        setDeactivated(false);
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        return { error: error?.message ?? null };
      },
      async signUpWithEmail(email, password, fullName) {
        setDeactivated(false);
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        });
        return {
          error: error?.message ?? null,
          needsConfirmation: !error && !data.session,
        };
      },
      async signInWithGoogle() {
        setDeactivated(false);
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: window.location.origin },
        });
        return { error: error?.message ?? null };
      },
      async signOut() {
        await supabase.auth.signOut();
      },
      async refreshProfile() {
        if (session?.user) await loadProfile(session.user.id);
      },
    }),
    [session, profile, loading, deactivated],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
