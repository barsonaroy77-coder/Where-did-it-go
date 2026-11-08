import { DbLike, ProfileRow } from '../types';
import { RepositoryResult, ServerProfileInput } from './types';
import { emitTableChange } from '../events';

/**
 * Profile repository.
 *
 * Requirements (Task 1):
 * - Read-only cache: getProfile, upsertProfileFromServer.
 * - Profile mutations are executed directly against Supabase auth/profiles during
 *   onboarding/setup per PRD Sections 1.3 & 5.2.
 * - Profile changes NEVER write to or use the local outbox.
 */

/**
 * Retrieves the current cached user profile from the partitioned SQLite database.
 * Returns null if the profile has not yet been synced or cached locally.
 */
export async function getProfile(db: DbLike): Promise<ProfileRow | null> {
  return db.getFirstAsync<ProfileRow>('SELECT * FROM profiles LIMIT 1;');
}

/**
 * Upserts a profile downloaded from the server into the local SQLite cache.
 * Sets sync_state to 'synced' and local_revision to 0.
 * Never writes to the mutation outbox.
 */
export async function upsertProfileFromServer(
  db: DbLike,
  profile: ServerProfileInput
): Promise<RepositoryResult<ProfileRow>> {
  try {
    const version = profile.version ?? 1;
    const changeSeq = profile.change_seq ?? 0;

    await db.runAsync(
      `INSERT INTO profiles (
        id, currency, currency_decimals, version, change_seq,
        created_at, updated_at, local_revision, sync_state
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'synced')
      ON CONFLICT (id) DO UPDATE SET
        currency = excluded.currency,
        currency_decimals = excluded.currency_decimals,
        version = excluded.version,
        change_seq = excluded.change_seq,
        updated_at = excluded.updated_at,
        sync_state = 'synced';`,
      [
        profile.id,
        profile.currency,
        profile.currency_decimals,
        version,
        changeSeq,
        profile.created_at,
        profile.updated_at,
      ]
    );

    const row = await db.getFirstAsync<ProfileRow>(
      'SELECT * FROM profiles WHERE id = ?;',
      [profile.id]
    );

    if (!row) {
      return { ok: false, error: 'Failed to retrieve cached profile after upsert' };
    }

    emitTableChange('profiles');
    return { ok: true, value: row };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: errorMsg };
  }
}
