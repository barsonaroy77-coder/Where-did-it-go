import { DbLike } from './types';
import { migrations } from './migrations';

/**
 * Runs pending database migrations sequentially.
 *
 * 1. Reads the current version from SQLite via PRAGMA user_version.
 * 2. Runs every newer migration IN ORDER.
 * 3. Executes each migration inside one atomic transaction together with the version bump.
 * 4. Stops with a clear error if any migration fails.
 * 5. Running it twice changes nothing (idempotent).
 *
 * @param db The SQLite database or DbLike instance.
 * @returns The final schema version number.
 */
export async function runMigrations(db: DbLike): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
  const currentVersion = row?.user_version ?? 0;

  const pending = migrations
    .filter((m) => m.version > currentVersion)
    .sort((a, b) => a.version - b.version);

  if (pending.length === 0) {
    return currentVersion;
  }

  let latestVersion = currentVersion;

  for (const migration of pending) {
    try {
      await db.withTransactionAsync(async () => {
        for (const statement of migration.statements) {
          const sql = statement.trim();
          if (sql.length > 0) {
            await db.execAsync(sql);
          }
        }
        await db.execAsync(`PRAGMA user_version = ${migration.version};`);
      });
      latestVersion = migration.version;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Migration to version ${migration.version} failed: ${message}`);
    }
  }

  return latestVersion;
}
