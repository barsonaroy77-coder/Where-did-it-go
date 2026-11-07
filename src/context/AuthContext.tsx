import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Session, User } from '@supabase/supabase-js';
import { router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import {
  AuthResult,
  SignInSuccessData,
  SignUpSuccessData,
  signInWithEmail as apiSignInWithEmail,
  signUpWithEmail as apiSignUpWithEmail,
  sendPasswordResetEmail as apiSendPasswordResetEmail,
} from '@/lib/auth';
import {
  signInWithGoogle as apiSignInWithGoogle,
  signOutGoogle as apiSignOutGoogle,
} from '@/lib/googleAuth';
import { Profile, fetchProfile } from '@/lib/profile';
import { ToastContext } from '@/components/Toast';

export interface AuthContextValue {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  profileLoading: boolean;
  isConfigured: boolean;
  refreshProfile: () => Promise<Profile | null>;
  setProfile: (profile: Profile | null) => void;
  signIn: (email: string, password: string) => Promise<AuthResult<SignInSuccessData>>;
  signUp: (email: string, password: string) => Promise<AuthResult<SignUpSuccessData>>;
  signInWithGoogle: () => Promise<AuthResult<SignInSuccessData>>;
  signOut: () => Promise<AuthResult<null>>;
  resetPassword: (email: string) => Promise<AuthResult<null>>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export interface AuthProviderProps {
  children: React.ReactNode;
}

// Ensure splash screen remains active during module load and initial auth check
SplashScreen.preventAutoHideAsync().catch(() => {
  // Ignore in environments where native splash screen is already dismissed or unavailable
});

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [profileLoading, setProfileLoading] = useState<boolean>(false);

  // Track user-initiated sign out to distinguish from unexpected session expiry
  const isUserSigningOut = useRef(false);
  // Track previously valid session to detect genuine expirations / failed refreshes
  const prevSessionRef = useRef<Session | null>(null);

  const toastContext = useContext(ToastContext);

  /**
   * Handles session expiration or token refresh failures according to PRD section 9.
   * Does NOT wipe local SQLite records, local outbox, or account partitions.
   * Alerts the user with a Toast notification and routes to the Welcome/sign-in screen.
   */
  const handleSessionExpired = useCallback(() => {
    // Phase 6: Pause background and queued synchronization here when session expires
    if (toastContext?.showToast) {
      toastContext.showToast({
        message: 'Session expired, please sign in again',
        variant: 'error',
      });
    }

    setSession(null);
    setUser(null);
    setProfile(null);
    setProfileLoading(false);
    prevSessionRef.current = null;

    try {
      router.replace('/welcome');
    } catch {
      // Router may not be ready if called during initial root mounting
    }
  }, [toastContext]);

  useEffect(() => {
    let isMounted = true;

    async function initializeAuth() {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) {
          console.warn('[AuthProvider] Failed to restore session on launch:', error.message);
          // Token refresh failed or session corrupted
          if (isMounted) {
            handleSessionExpired();
          }
          return;
        }

        if (isMounted) {
          const initialSession = data.session;
          setSession(initialSession);
          setUser(initialSession?.user ?? null);
          prevSessionRef.current = initialSession;

          if (initialSession?.user) {
            setProfileLoading(true);
            try {
              // Phase 4: Cache the profile locally in SQLite so the app can start offline later.
              // In Phase 4, attempt local SQLite fetch first, then remote fetch/sync.
              const profileRes = await fetchProfile();
              if (isMounted) {
                setProfile(profileRes.data ?? null);
              }
            } catch {
              if (isMounted) {
                setProfile(null);
              }
            } finally {
              if (isMounted) {
                setProfileLoading(false);
              }
            }
          } else {
            setProfile(null);
            setProfileLoading(false);
          }
        }
      } catch (err) {
        console.error('[AuthProvider] Error loading initial session:', err);
        if (isMounted) {
          setProfile(null);
          setProfileLoading(false);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    initializeAuth();

    // Listen to Supabase auth events
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, currentSession) => {
      if (!isMounted) return;

      if (event === 'SIGNED_OUT') {
        const hadPriorSession = prevSessionRef.current !== null;
        prevSessionRef.current = null;
        setSession(null);
        setUser(null);
        setProfile(null);
        setProfileLoading(false);
        setIsLoading(false);

        // If the sign-out was not user-initiated and we previously had an active session,
        // it signifies a session expiry or token refresh failure.
        if (!isUserSigningOut.current && hadPriorSession) {
          handleSessionExpired();
        }
        return;
      }

      if (
        event === 'TOKEN_REFRESHED' ||
        event === 'SIGNED_IN' ||
        event === 'INITIAL_SESSION' ||
        event === 'USER_UPDATED'
      ) {
        setSession(currentSession);
        setUser(currentSession?.user ?? null);
        prevSessionRef.current = currentSession;
        setIsLoading(false);

        if (currentSession?.user) {
          setProfileLoading(true);
          // Phase 4: Cache the profile locally in SQLite so the app can start offline later.
          fetchProfile()
            .then((res) => {
              if (isMounted) {
                setProfile(res.data ?? null);
              }
            })
            .catch(() => {
              if (isMounted) {
                setProfile(null);
              }
            })
            .finally(() => {
              if (isMounted) {
                setProfileLoading(false);
              }
            });
        } else {
          setProfile(null);
          setProfileLoading(false);
        }
        return;
      }

      setSession(currentSession);
      setUser(currentSession?.user ?? null);
      if (currentSession) {
        prevSessionRef.current = currentSession;
      }
      setIsLoading(false);
    });

    // Clean up subscription on unmount
    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [handleSessionExpired]);

  const signIn = useCallback(
    async (email: string, password: string): Promise<AuthResult<SignInSuccessData>> => {
      const result = await apiSignInWithEmail(email, password);
      if (result.data?.session) {
        setSession(result.data.session);
        setUser(result.data.user);
        prevSessionRef.current = result.data.session;
      }
      return result;
    },
    []
  );

  const signUp = useCallback(
    async (email: string, password: string): Promise<AuthResult<SignUpSuccessData>> => {
      const result = await apiSignUpWithEmail(email, password);
      if (result.data?.session) {
        setSession(result.data.session);
        setUser(result.data.user);
        prevSessionRef.current = result.data.session;
      }
      return result;
    },
    []
  );

  const signInWithGoogle = useCallback(async (): Promise<AuthResult<SignInSuccessData>> => {
    const result = await apiSignInWithGoogle();
    if (result.data?.session) {
      setSession(result.data.session);
      setUser(result.data.user);
      prevSessionRef.current = result.data.session;
    }
    return result;
  }, []);

  /**
   * Signs out the user, clearing both the Supabase session and Google session (via signOutGoogle).
   * Does NOT wipe or delete local SQLite data or account partition data.
   */
  const signOut = useCallback(async (): Promise<AuthResult<null>> => {
    isUserSigningOut.current = true;
    try {
      const result = await apiSignOutGoogle();
      setSession(null);
      setUser(null);
      setProfile(null);
      setProfileLoading(false);
      prevSessionRef.current = null;
      return result;
    } finally {
      // Allow asynchronous onAuthStateChange SIGNED_OUT event to pass before resetting flag
      setTimeout(() => {
        isUserSigningOut.current = false;
      }, 1000);
    }
  }, []);

  const resetPassword = useCallback(
    async (email: string): Promise<AuthResult<null>> => {
      return await apiSendPasswordResetEmail(email);
    },
    []
  );

  const refreshProfile = useCallback(async (): Promise<Profile | null> => {
    setProfileLoading(true);
    try {
      // Phase 4: Cache the profile locally in SQLite so the app can start offline later.
      const res = await fetchProfile();
      setProfile(res.data ?? null);
      return res.data ?? null;
    } catch {
      return null;
    } finally {
      setProfileLoading(false);
    }
  }, []);

  const value: AuthContextValue = {
    user,
    session,
    profile,
    isAuthenticated: Boolean(session && user),
    isLoading,
    profileLoading,
    isConfigured: isSupabaseConfigured,
    refreshProfile,
    setProfile,
    signIn,
    signUp,
    signInWithGoogle,
    signOut,
    resetPassword,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

/**
 * Custom hook to consume the AuthContext.
 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider.');
  }
  return context;
}
