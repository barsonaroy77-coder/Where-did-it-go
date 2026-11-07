import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import {
  AuthResult,
  SignInSuccessData,
  SignUpSuccessData,
  getSession,
  signInWithEmail as apiSignInWithEmail,
  signUpWithEmail as apiSignUpWithEmail,
  sendPasswordResetEmail as apiSendPasswordResetEmail,
} from '@/lib/auth';
import {
  signInWithGoogle as apiSignInWithGoogle,
  signOutGoogle as apiSignOutGoogle,
} from '@/lib/googleAuth';

export interface AuthContextValue {
  user: User | null;
  session: Session | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isConfigured: boolean;
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

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    let isMounted = true;

    async function initializeAuth() {
      try {
        const initialSession = await getSession();
        if (isMounted) {
          setSession(initialSession);
          setUser(initialSession?.user ?? null);
        }
      } catch (err) {
        console.error('[AuthProvider] Error loading initial session:', err);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    initializeAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      if (isMounted) {
        setSession(currentSession);
        setUser(currentSession?.user ?? null);
        setIsLoading(false);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(
    async (email: string, password: string): Promise<AuthResult<SignInSuccessData>> => {
      const result = await apiSignInWithEmail(email, password);
      if (result.data?.session) {
        setSession(result.data.session);
        setUser(result.data.user);
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
    }
    return result;
  }, []);

  const signOut = useCallback(async (): Promise<AuthResult<null>> => {
    const result = await apiSignOutGoogle();
    setSession(null);
    setUser(null);
    return result;
  }, []);

  const resetPassword = useCallback(
    async (email: string): Promise<AuthResult<null>> => {
      return await apiSendPasswordResetEmail(email);
    },
    []
  );

  const value: AuthContextValue = {
    user,
    session,
    isAuthenticated: Boolean(session && user),
    isLoading,
    isConfigured: isSupabaseConfigured,
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
