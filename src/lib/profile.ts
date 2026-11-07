import { supabase, isSupabaseConfigured } from './supabase';
import { getCurrency } from './currencies';

export interface Profile {
  id: string;
  currency: string;
  currency_decimals: number;
  version: number;
  change_seq?: number;
  created_at: string;
  updated_at: string;
}

export type ProfileErrorCode =
  | 'offline'
  | 'permission'
  | 'not_authenticated'
  | 'invalid_currency'
  | 'unknown';

export interface ProfileError {
  code: ProfileErrorCode;
  message: string;
}

export interface ProfileResult<T = Profile> {
  data: T | null;
  error: ProfileError | null;
}

/**
 * Classifies errors into clear, typed ProfileError categories.
 * Never logs sensitive tokens, credentials, or money amounts.
 */
export function classifyProfileError(error: unknown): ProfileError {
  if (!error || typeof error !== 'object') {
    return {
      code: 'unknown',
      message: 'An unexpected profile error occurred.',
    };
  }

  const err = error as { message?: string; code?: string; status?: number; details?: string };
  const rawMsg = (err.message || '').toLowerCase();
  const rawDetails = (err.details || '').toLowerCase();

  // Network / connectivity issues
  if (
    rawMsg.includes('network') ||
    rawMsg.includes('fetch') ||
    rawMsg.includes('failed to fetch') ||
    rawMsg.includes('offline') ||
    rawMsg.includes('network request failed') ||
    rawMsg.includes('connection refused') ||
    rawMsg.includes('load failed')
  ) {
    return {
      code: 'offline',
      message: 'Internet connection is required. Please check your connectivity and try again.',
    };
  }

  // RLS or PostgreSQL permission violation
  if (
    err.code === '42501' ||
    rawMsg.includes('permission') ||
    rawMsg.includes('violates row-level security policy') ||
    rawMsg.includes('not authorized') ||
    rawDetails.includes('row-level security')
  ) {
    return {
      code: 'permission',
      message: 'Permission denied accessing account profile.',
    };
  }

  return {
    code: 'unknown',
    message: err.message || 'An unexpected error occurred while accessing your profile.',
  };
}

/**
 * Select the current authenticated user's profile (or null if not created yet).
 * Returns a typed ProfileResult with clear errors (offline, permission, unknown).
 * Never logs tokens, financial values, or money.
 */
export async function fetchProfile(): Promise<ProfileResult<Profile | null>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: {
        code: 'unknown',
        message: 'Supabase credentials are not configured.',
      },
    };
  }

  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return {
        data: null,
        error: {
          code: 'not_authenticated',
          message: 'No authenticated user session found.',
        },
      };
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('id, currency, currency_decimals, version, created_at, updated_at')
      .eq('id', user.id)
      .maybeSingle();

    if (error) {
      return {
        data: null,
        error: classifyProfileError(error),
      };
    }

    // Phase 4: Cache the profile locally in SQLite so the app can start offline later.
    // Example: await localProfileRepository.upsert(data);

    return {
      data: data as Profile | null,
      error: null,
    };
  } catch (err) {
    return {
      data: null,
      error: classifyProfileError(err),
    };
  }
}

/**
 * Insert the profile row for the current authenticated user:
 * { id: user.id, currency, currency_decimals }.
 *
 * NOTE: Never sends version or timestamps (server triggers handle these).
 * If the row already exists (duplicate key), treats that as success and loads it.
 * Never logs tokens, financial values, or money.
 */
export async function createProfile(currencyCode: string): Promise<ProfileResult<Profile>> {
  if (!isSupabaseConfigured) {
    return {
      data: null,
      error: {
        code: 'unknown',
        message: 'Supabase credentials are not configured.',
      },
    };
  }

  const currency = getCurrency(currencyCode);
  if (!currency) {
    return {
      data: null,
      error: {
        code: 'invalid_currency',
        message: `Unsupported currency code: ${currencyCode}`,
      },
    };
  }

  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return {
        data: null,
        error: {
          code: 'not_authenticated',
          message: 'No authenticated user session found.',
        },
      };
    }

    // Use exact profiles columns: id, currency, currency_decimals.
    // The server sets version, created_at, and updated_at by trigger (0002_triggers.sql).
    // RLS allows a user to insert only the row where id = auth.uid() (0003_rls.sql).
    const { data, error } = await supabase
      .from('profiles')
      .insert({
        id: user.id,
        currency: currency.code,
        currency_decimals: currency.decimals,
      })
      .select('id, currency, currency_decimals, version, created_at, updated_at')
      .single();

    if (error) {
      // If the row already exists (duplicate key error), treat that as success and load it.
      const isDuplicate =
        error.code === '23505' ||
        error.message?.toLowerCase().includes('duplicate key') ||
        error.message?.toLowerCase().includes('already exists') ||
        error.message?.toLowerCase().includes('profiles_pkey');

      if (isDuplicate) {
        const fetchRes = await fetchProfile();
        if (fetchRes.data) {
          return { data: fetchRes.data, error: null };
        }
        if (fetchRes.error) {
          return { data: null, error: fetchRes.error };
        }
      }

      return {
        data: null,
        error: classifyProfileError(error),
      };
    }

    // Phase 4: Cache the newly created profile locally in SQLite so the app can start offline later.
    // Example: await localProfileRepository.upsert(data);

    return {
      data: data as Profile,
      error: null,
    };
  } catch (err) {
    return {
      data: null,
      error: classifyProfileError(err),
    };
  }
}
