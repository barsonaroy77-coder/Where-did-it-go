import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Session, User, isAuthRetryableFetchError } from '@supabase/supabase-js';
import { router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { SQLiteDatabase } from 'expo-sqlite';
import { supabase, isSupabaseConfigured, ExpoSecureStoreAdapter } from '@/lib/supabase';
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
import { openDatabaseForUser, getCurrentDatabase, closeDatabase } from '@/db/database';
import { getProfile, upsertProfileFromServer } from '@/db/repositories/profile';

export type SyncPausedReason = 'offline' | 'session_expired' | null;

export interface AuthContextValue {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  profileLoading: boolean;
  isConfigured: boolean;
  syncPaused: SyncPausedReason;
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

/**
 * Checks if an error is a transient network or offline error.
 * A network failure must never sign the user out.
 */
function isNetworkError(error: unknown): boolean {
  if (!error) return false;
  if (isAuthRetryableFetchError(error)) {
    return true;
  }
  if (typeof error === 'object') {
    const err = error as { name?: string; message?: string; status?: number };
    if (err.name === 'AuthRetryableFetchError') {
      return true;
    }
    const msg = (err.message || '').toLowerCase();
    if (
      msg.includes('network') ||
      msg.includes('fetch') ||
      msg.includes('failed to fetch') ||
      msg.includes('offline') ||
      msg.includes('timeout') ||
      msg.includes('network request failed') ||
      msg.includes('connection refused') ||
      msg.includes('load failed') ||
      msg.includes('aborted')
    ) {
      return true;
    }
    if (err.status === 0 || (err.status && err.status >= 500 && err.status < 600)) {
      return true;
    }
  }
  if (typeof navigator !== 'undefined' && 'onLine' in navigator && !navigator.onLine) {
    return true;
  }
  return false;
}

/**
 * Retrieves the stored session from device storage fallback when network fails
 * during proactive token refresh.
 */
async function getStoredSessionFallback(): Promise<Session | null> {
  try {
    const storageKey =
      (supabase.auth as unknown as { storageKey?: string }).storageKey ||
      'supabase.auth.token';
    const raw = await ExpoSecureStoreAdapter.getItem(storageKey);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.user) {
      return parsed as Session;
    }
    return null;
  } catch {
    return null;
  }
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfileState] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [profileLoading, setProfileLoading] = useState<boolean>(false);
  const [syncPaused, setSyncPaused] = useState<SyncPausedReason>(null);

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
    setSyncPaused('session_expired');
    if (toastContext?.showToast) {
      toastContext.showToast({
        message: 'Session expired, please sign in again',
        variant: 'error',
      });
    }

    setSession(null);
    setUser(null);
    setProfileState(null);
    setProfileLoading(false);
    prevSessionRef.current = null;

    try {
      router.replace('/welcome');
    } catch {
      // Router may not be ready if called during initial root mounting
    }
  }, [toastContext]);

  /**
   * Updates profile state and updates the local SQLite profile cache if available.
   */
  const setProfile = useCallback((newProfile: Profile | null) => {
    setProfileState(newProfile);
    if (newProfile) {
      const db = getCurrentDatabase();
      if (db) {
        upsertProfileFromServer(db, newProfile).catch(() => {
          // Ignore cache errors in background
        });
      }
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function initializeAuth() {
      try {
        let initialSession: Session | null = null;
        let getSessionError: unknown = null;

        try {
          const { data, error } = await supabase.auth.getSession();
          initialSession = data?.session ?? null;
          getSessionError = error;
        } catch (e) {
          getSessionError = e;
        }

        if (getSessionError) {
          if (isNetworkError(getSessionError)) {
            // A NETWORK failure (offline, timeout, token refresh could not reach the server)
            // must NEVER sign the user out. The app keeps the stored session, opens the
            // user's local database, and continues with local data.
            setSyncPaused('offline');
            if (!initialSession) {
              initialSession = await getStoredSessionFallback();
            }
          } else {
            // Genuine AUTH failure (the refresh token is invalid or revoked)
            setSyncPaused('session_expired');
            if (isMounted) {
              handleSessionExpired();
            }
            return;
          }
        } else if (!initialSession) {
          const isOffline =
            typeof navigator !== 'undefined' && 'onLine' in navigator && !navigator.onLine;
          if (isOffline) {
            const fallback = await getStoredSessionFallback();
            if (fallback) {
              initialSession = fallback;
              setSyncPaused('offline');
            }
          }
        }

        if (isMounted) {
          setSession(initialSession);
          setUser(initialSession?.user ?? null);
          prevSessionRef.current = initialSession;

          if (initialSession?.user) {
            setProfileLoading(true);

            // Profile loading:
            // 1. Read the cached profile from the user's local SQLite first (profile repository).
            // 2. If online, fetch the server profile and refresh the cache.
            // 3. If there is no local profile and no connection, show the existing Onboarding
            //    screen's "first setup needs internet" message instead of crashing or looping.
            // 4. A stored session with a cached profile must reach the Dashboard placeholder in airplane mode.
            let localDb: SQLiteDatabase | null = null;
            let cachedProfile: Profile | null = null;

            try {
              localDb = await openDatabaseForUser(initialSession.user.id);
              const cachedRow = await getProfile(localDb);
              if (cachedRow) {
                cachedProfile = cachedRow;
                if (isMounted) {
                  setProfileState(cachedRow);
                }
              }
            } catch (dbErr) {
              console.warn('[AuthProvider] Failed to open local database or read cached profile:', dbErr);
            }

            const isOfflineNow =
              (typeof navigator !== 'undefined' && 'onLine' in navigator && !navigator.onLine) ||
              syncPaused === 'offline';

            if (!isOfflineNow) {
              try {
                const profileRes = await fetchProfile();
                if (profileRes.data) {
                  if (isMounted) {
                    setProfileState(profileRes.data);
                  }
                  if (localDb) {
                    await upsertProfileFromServer(localDb, profileRes.data);
                  }
                } else if (profileRes.error?.code === 'offline') {
                  setSyncPaused('offline');
                }
              } catch (fetchErr) {
                if (isNetworkError(fetchErr)) {
                  setSyncPaused('offline');
                }
              }
            } else {
              setSyncPaused('offline');
            }

            if (isMounted) {
              setProfileLoading(false);
            }
          } else {
            setProfileState(null);
            setProfileLoading(false);
          }
        }
      } catch (err) {
        console.error('[AuthProvider] Error loading initial session:', err);
        if (isMounted) {
          setProfileState(null);
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
    } = supabase.auth.onAuthStateChange(async (event, currentSession) => {
      if (!isMounted) return;

      if (event === 'SIGNED_OUT') {
        const hadPriorSession = prevSessionRef.current !== null;
        prevSessionRef.current = null;
        setSession(null);
        setUser(null);
        setProfileState(null);
        setProfileLoading(false);
        setIsLoading(false);

        // If the sign-out was not user-initiated and we previously had an active session,
        // it signifies a genuine session expiry or revoked refresh token.
        if (!isUserSigningOut.current && hadPriorSession) {
          setSyncPaused('session_expired');
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

          let localDb: SQLiteDatabase | null = null;
          try {
            localDb = await openDatabaseForUser(currentSession.user.id);
            const cachedRow = await getProfile(localDb);
            if (cachedRow && isMounted) {
              setProfileState(cachedRow);
            }
          } catch {
            // Ignore local db open error during event
          }

          fetchProfile()
            .then(async (res) => {
              if (res.data) {
                if (isMounted) {
                  setProfileState(res.data);
                }
                if (localDb) {
                  await upsertProfileFromServer(localDb, res.data);
                }
              } else if (res.error?.code === 'offline') {
                setSyncPaused('offline');
              }
            })
            .catch((err) => {
              if (isNetworkError(err)) {
                setSyncPaused('offline');
              }
            })
            .finally(() => {
              if (isMounted) {
                setProfileLoading(false);
              }
            });
        } else {
          setProfileState(null);
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
  }, [handleSessionExpired, syncPaused]);

  const signIn = useCallback(
    async (email: string, password: string): Promise<AuthResult<SignInSuccessData>> => {
      const result = await apiSignInWithEmail(email, password);
      if (result.data?.session) {
        setSession(result.data.session);
        setUser(result.data.user);
        prevSessionRef.current = result.data.session;
        setSyncPaused(null);
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
        setSyncPaused(null);
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
      setSyncPaused(null);
    }
    return result;
  }, []);

  /**
   * Signs out the user, clearing both the Supabase session and Google session.
   * Keeps local SQLite database file intact (never deletes or overwrites).
   */
  const signOut = useCallback(async (): Promise<AuthResult<null>> => {
    isUserSigningOut.current = true;
    setSyncPaused(null);
    try {
      const result = await apiSignOutGoogle();
      setSession(null);
      setUser(null);
      setProfileState(null);
      setProfileLoading(false);
      prevSessionRef.current = null;
      await closeDatabase();
      return result;
    } finally {
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
      const db = getCurrentDatabase();
      if (db) {
        const cached = await getProfile(db);
        if (cached) {
          setProfileState(cached);
        }
      }

      const res = await fetchProfile();
      if (res.data) {
        setProfileState(res.data);
        if (db) {
          await upsertProfileFromServer(db, res.data);
        }
        return res.data;
      }
      if (res.error?.code === 'offline') {
        setSyncPaused('offline');
      }
      return profile;
    } catch (err) {
      if (isNetworkError(err)) {
        setSyncPaused('offline');
      }
      return profile;
    } finally {
      setProfileLoading(false);
    }
  }, [profile]);

  const value: AuthContextValue = {
    user,
    session,
    profile,
    isAuthenticated: Boolean(session && user),
    isLoading,
    profileLoading,
    isConfigured: isSupabaseConfigured,
    syncPaused,
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
