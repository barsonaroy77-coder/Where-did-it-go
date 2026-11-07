import { openDatabaseAsync, SQLiteDatabase } from 'expo-sqlite';
import { DbLike } from './types';
import { runMigrations } from './migrate';

let currentDb: SQLiteDatabase | null = null;
let currentUserId: string | null = null;
let activeOpenPromise: Promise<SQLiteDatabase> | null = null;

/**
 * Computes a deterministic 64-bit FNV-1a hash formatted as a 16-character hex string.
 */
function hashString(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x84222325;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code;
    h2 = Math.imul(h2, 0x01000193);
  }
  const p1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const p2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `${p1}${p2}`;
}

/**
 * Derives a safe, sanitized or hashed database file name for a given user ID.
 * Contains no raw user data beyond the sanitized ID or hash.
 */
export function getDatabaseNameForUser(userId: string): string {
  if (!userId || typeof userId !== 'string' || !userId.trim()) {
    throw new Error('A valid userId is required to determine the database name.');
  }

  const trimmed = userId.trim();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);

  if (isUuid) {
    const sanitized = trimmed.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    return `user_${sanitized}.db`;
  }

  const safeHash = hashString(trimmed);
  return `user_${safeHash}.db`;
}

/**
 * Closes the currently cached database connection, if one exists.
 * Does not remove or delete the database file from disk.
 */
export async function closeDatabase(): Promise<void> {
  if (activeOpenPromise) {
    try {
      await activeOpenPromise;
    } catch {
      // Ignore open failure during close
    }
  }

  if (currentDb) {
    const dbToClose = currentDb;
    currentDb = null;
    currentUserId = null;
    try {
      await dbToClose.closeAsync();
    } catch {
      // Ignore errors if already closed
    }
  }
}

/**
 * Returns the currently cached database instance, or null if no connection is active.
 */
export function getCurrentDatabase(): SQLiteDatabase | null {
  return currentDb;
}

/**
 * Asserts that the database belongs to the given user ID.
 *
 * Requirements (Phase 4 Part 5):
 * - In app_meta store owner_user_id the first time a database is created.
 * - On every open, verify it equals the signed-in user id; on mismatch close
 *   the database, do not use it, and surface a clear error (never read, write,
 *   or delete its data).
 *
 * Comment per PRD/Spec: An outbox is only ever pushed by the owner's own session, never another user's.
 */
export async function assertDatabaseOwner(db: DbLike, userId: string): Promise<void> {
  if (!userId || typeof userId !== 'string' || !userId.trim()) {
    throw new Error('A valid userId is required to assert database ownership.');
  }

  const normalizedUserId = userId.trim();

  // Ensure app_meta table exists
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT
    );
  `);

  const metaRow = await db.getFirstAsync<{ value: string | null }>(
    "SELECT value FROM app_meta WHERE key = 'owner_user_id';"
  );

  if (!metaRow || metaRow.value === null || metaRow.value === undefined) {
    // First time database is created: store owner_user_id
    await db.runAsync(
      "INSERT INTO app_meta (key, value) VALUES ('owner_user_id', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value;",
      [normalizedUserId]
    );
    return;
  }

  if (metaRow.value !== normalizedUserId) {
    // Owner mismatch: close database if closable, do not use it, surface clear error
    if ('closeAsync' in db && typeof (db as { closeAsync?: () => Promise<void> }).closeAsync === 'function') {
      try {
        await (db as { closeAsync: () => Promise<void> }).closeAsync();
      } catch {
        // Ignore close error on mismatch
      }
    }
    throw new Error(
      `Database owner mismatch: database is owned by user '${metaRow.value}', but accessed by user '${normalizedUserId}'. Access rejected.`
    );
  }
}

/**
 * An outbox is only ever pushed by the owner's own session, never another user's.
 *
 * Verifies whether the provided session user ID matches the stored database owner.
 * Returns false when owners differ, or if the database has no owner or an error occurs.
 *
 * @param db The SQLite database instance.
 * @param sessionUserId The user ID from the active authentication session.
 */
export async function canSync(db: DbLike, sessionUserId: string): Promise<boolean> {
  if (!sessionUserId || typeof sessionUserId !== 'string' || !sessionUserId.trim()) {
    return false;
  }

  try {
    const row = await db.getFirstAsync<{ value: string | null }>(
      "SELECT value FROM app_meta WHERE key = 'owner_user_id';"
    );
    if (!row || !row.value) {
      return false;
    }
    return row.value === sessionUserId.trim();
  } catch {
    return false;
  }
}

/**
 * Opens or retrieves a cached database connection for the specified user account.
 * Automatically closes any previously open connection for another user.
 * Enables WAL mode and foreign keys as documented in official expo-sqlite docs.
 * Runs migrations and verifies that the database owner matches the signed-in user id.
 *
 * @param userId The unique user identifier.
 * @returns A promise resolving to the SQLiteDatabase instance.
 */
export async function openDatabaseForUser(userId: string): Promise<SQLiteDatabase> {
  if (!userId || typeof userId !== 'string' || !userId.trim()) {
    throw new Error('A valid userId is required to open a database.');
  }

  const normalizedUserId = userId.trim();

  // Return existing cached connection if already open for this user
  if (currentDb && currentUserId === normalizedUserId) {
    return currentDb;
  }

  // If opening is currently in flight for the same user, reuse the promise
  if (activeOpenPromise && currentUserId === normalizedUserId) {
    return activeOpenPromise;
  }

  // If connected or opening for a different user, close the old connection first
  if (currentDb || activeOpenPromise) {
    await closeDatabase();
  }

  currentUserId = normalizedUserId;
  const dbName = getDatabaseNameForUser(normalizedUserId);

  activeOpenPromise = (async () => {
    let db: SQLiteDatabase | null = null;
    try {
      db = await openDatabaseAsync(dbName);

      // Configure WAL journal mode and enable foreign keys
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
      `);

      // Run pending migrations so app_meta and tables exist
      await runMigrations(db);

      // Verify or store owner_user_id; throws and closes on mismatch
      await assertDatabaseOwner(db, normalizedUserId);

      currentDb = db;
      return db;
    } catch (err) {
      if (db) {
        try {
          await db.closeAsync();
        } catch {
          // Ignore errors during emergency close
        }
      }
      currentDb = null;
      currentUserId = null;
      throw err;
    } finally {
      activeOpenPromise = null;
    }
  })();

  return activeOpenPromise;
}

/**
 * Development-only helper that logs the table count and the migration version once.
 * Strictly avoids logging any user identifiers, sensitive data, or table rows.
 */
export async function logDatabaseDevStats(db: SQLiteDatabase, version: number): Promise<void> {
  if (!__DEV__) {
    return;
  }
  try {
    const result = await db.getFirstAsync<{ count: number }>(
      "SELECT count(*) as count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%';"
    );
    const tableCount = result?.count ?? 0;
    console.log(`db ready, version ${version}, ${tableCount} tables`);
  } catch {
    // Silently ignore in development logging
  }
}
