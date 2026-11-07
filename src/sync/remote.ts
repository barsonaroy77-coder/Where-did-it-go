import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import { OutboxRow } from '@/db/types';

function getSupabaseClient() {
  // Lazily require supabase client to prevent unmocked timers in test environments
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { supabase } = require('@/lib/supabase');
  return supabase;
}

export type OutboxEntry = Pick<
  OutboxRow,
  'sequence' | 'mutation_id' | 'table_name' | 'entity_id' | 'op' | 'base_version' | 'payload'
> & {
  local_revision?: number;
};

export type MutationStatus = 'applied' | 'conflict' | 'not_found';

export interface RemoteMutationResult {
  status: MutationStatus;
  entity: Record<string, unknown> | null;
}

export type SyncErrorClassification = 'network' | 'auth' | 'server';

export class SyncRemoteError extends Error {
  readonly classification: SyncErrorClassification;
  readonly originalError?: unknown;

  constructor(
    classification: SyncErrorClassification,
    message: string,
    originalError?: unknown
  ) {
    super(message);
    this.name = 'SyncRemoteError';
    this.classification = classification;
    this.originalError = originalError;
    Object.setPrototypeOf(this, SyncRemoteError.prototype);
  }
}

/**
 * Classifies an unknown error into network, auth, or server per PRD Section 8 and 9.
 */
export function classifyRemoteError(error: unknown): SyncErrorClassification {
  if (!error) return 'server';

  if (error instanceof SyncRemoteError) {
    return error.classification;
  }

  if (isAuthRetryableFetchError(error)) {
    return 'network';
  }

  if (typeof error === 'object' && error !== null) {
    const err = error as {
      name?: string;
      message?: string;
      code?: string;
      status?: number;
      details?: string;
    };

    const msg = `${err.message || ''} ${err.details || ''} ${err.code || ''}`.toLowerCase();

    // 1. Network errors: no response, offline, aborts, timeouts, 502-504 gateway errors
    if (
      err.name === 'AuthRetryableFetchError' ||
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
      return 'network';
    }

    if (err.status === 0 || (err.status !== undefined && err.status >= 502 && err.status <= 504)) {
      return 'network';
    }

    // 2. Auth errors: invalid or expired session, revoked token, 401/403
    if (
      err.status === 401 ||
      err.status === 403 ||
      err.code === 'PGRST301' ||
      msg.includes('jwt expired') ||
      msg.includes('invalid jwt') ||
      msg.includes('not authenticated') ||
      msg.includes('invalid token') ||
      msg.includes('session expired') ||
      msg.includes('unauthorized') ||
      msg.includes('refresh token')
    ) {
      return 'auth';
    }
  }

  if (typeof navigator !== 'undefined' && 'onLine' in navigator && !navigator.onLine) {
    return 'network';
  }

  // 3. Server errors: database constraint, validation error, schema violation
  return 'server';
}

export interface SyncRemote {
  applyMutation(entry: OutboxEntry): Promise<RemoteMutationResult>;
  fetchChanges(
    table: string,
    afterChangeSeq: number,
    limit: number
  ): Promise<Record<string, unknown>[]>;
}

/**
 * Production implementation of SyncRemote using the active Supabase client.
 * Strictly executes as the signed-in user with RLS applied. Never uses a service key.
 */
export class SupabaseSyncRemote implements SyncRemote {
  async applyMutation(entry: OutboxEntry): Promise<RemoteMutationResult> {
    let payloadObj: Record<string, unknown> | null = null;
    if (entry.payload) {
      try {
        payloadObj = JSON.parse(entry.payload) as Record<string, unknown>;
      } catch {
        payloadObj = null;
      }
    }

    const client = getSupabaseClient();
    const { data, error } = await client.rpc('apply_mutation', {
      p_mutation_id: entry.mutation_id,
      p_table: entry.table_name,
      p_entity_id: entry.entity_id,
      p_op: entry.op,
      p_base_version: entry.base_version,
      p_payload: payloadObj,
    });

    if (error) {
      const classification = classifyRemoteError(error);
      throw new SyncRemoteError(
        classification,
        error.message || 'apply_mutation RPC returned an error',
        error
      );
    }

    const response = data as {
      status?: string;
      entity?: Record<string, unknown> | null;
    } | null;

    if (!response || typeof response !== 'object' || !response.status) {
      throw new SyncRemoteError(
        'server',
        'apply_mutation returned invalid or malformed response'
      );
    }

    const status = response.status as MutationStatus;
    if (status !== 'applied' && status !== 'conflict' && status !== 'not_found') {
      throw new SyncRemoteError(
        'server',
        `apply_mutation returned unexpected status: ${String(response.status)}`
      );
    }

    return {
      status,
      entity: response.entity ?? null,
    };
  }

  async fetchChanges(
    table: string,
    afterChangeSeq: number,
    limit: number
  ): Promise<Record<string, unknown>[]> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from(table)
      .select('*')
      .gt('change_seq', afterChangeSeq)
      .order('change_seq', { ascending: true })
      .limit(limit);

    if (error) {
      const classification = classifyRemoteError(error);
      throw new SyncRemoteError(
        classification,
        error.message || `fetchChanges failed for table ${table}`,
        error
      );
    }

    return (data ?? []) as Record<string, unknown>[];
  }
}

export const defaultSyncRemote = new SupabaseSyncRemote();
