import { DbLike } from '@/db/types';
import { SyncRemote } from './remote';
import { emitTableChange } from '@/db/events';

export interface PullSummary {
  pulled: number;
}

/**
 * Validates the shape of a row pulled from Supabase for categories and transactions.
 * Catches malformed or truncated objects before they corrupt local SQLite tables.
 */
function validatePulledRow(
  table: 'categories' | 'transactions',
  row: Record<string, unknown>
): { ok: true } | { ok: false; error: string } {
  if (!row || typeof row !== 'object') {
    return { ok: false, error: 'Row is not an object' };
  }

  if (typeof row.id !== 'string' || !row.id.trim()) {
    return { ok: false, error: 'Missing or empty id' };
  }

  if (typeof row.user_id !== 'string' || !row.user_id.trim()) {
    return { ok: false, error: 'Missing or empty user_id' };
  }

  if (typeof row.version !== 'number' && typeof row.version !== 'string') {
    return { ok: false, error: 'Missing or invalid version' };
  }

  if (typeof row.change_seq !== 'number' && typeof row.change_seq !== 'string') {
    return { ok: false, error: 'Missing or invalid change_seq' };
  }

  if (typeof row.created_at !== 'string' || !row.created_at) {
    return { ok: false, error: 'Missing or invalid created_at' };
  }

  if (typeof row.updated_at !== 'string' || !row.updated_at) {
    return { ok: false, error: 'Missing or invalid updated_at' };
  }

  if (table === 'categories') {
    if (typeof row.name !== 'string' || !row.name.trim()) {
      return { ok: false, error: 'Category name is required' };
    }
    if (typeof row.icon !== 'string' || !row.icon.trim()) {
      return { ok: false, error: 'Category icon is required' };
    }
    if (typeof row.color !== 'string' || !row.color.trim()) {
      return { ok: false, error: 'Category color is required' };
    }
    if (row.type !== 'income' && row.type !== 'expense') {
      return { ok: false, error: `Invalid category type: ${String(row.type)}` };
    }
  } else if (table === 'transactions') {
    if (row.type !== 'income' && row.type !== 'expense') {
      return { ok: false, error: `Invalid transaction type: ${String(row.type)}` };
    }
    const amountNum = typeof row.amount === 'number' ? row.amount : Number(row.amount);
    if (!Number.isInteger(amountNum) || amountNum <= 0 || amountNum > 9007199254740991) {
      return { ok: false, error: `Invalid transaction amount: ${String(row.amount)}` };
    }
    if (typeof row.category_id !== 'string' || !row.category_id.trim()) {
      return { ok: false, error: 'Transaction category_id is required' };
    }
    if (typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) {
      return { ok: false, error: `Transaction date must be YYYY-MM-DD, got: ${String(row.date)}` };
    }
  }

  return { ok: true };
}

/**
 * Pulls incremental remote changes for categories FIRST, then transactions.
 */
export async function pullChanges(
  db: DbLike,
  remote: SyncRemote
): Promise<PullSummary> {
  const syncTables: ('categories' | 'transactions')[] = ['categories', 'transactions'];
  let totalPulled = 0;
  const pageSize = 500;
  const overlap = 500;

  for (const table of syncTables) {
    // Read the per-table cursor from sync_state_meta
    const metaRow = await db.getFirstAsync<{ last_change_seq: number }>(
      'SELECT last_change_seq FROM sync_state_meta WHERE table_name = ?;',
      [table]
    );

    const storedCursor = metaRow?.last_change_seq ?? 0;

    // Comment per PRD/Spec:
    // change_seq values come from a shared sequence, so a row committed late can have
    // a lower number than rows already seen; upserts are idempotent so the overlap is safe.
    let requestCursor = Math.max(0, storedCursor - overlap);

    while (true) {
      const page = await remote.fetchChanges(table, requestCursor, pageSize);

      if (page.length === 0) {
        break;
      }

      let highestSeqInPage = requestCursor;

      // In ONE SQLite transaction: upsert rows by id and advance cursor.
      // A crash must never advance the cursor without the rows.
      await db.withTransactionAsync(async () => {
        for (const rawRow of page) {
          const rawSeq = rawRow.change_seq;
          const seqNum = typeof rawSeq === 'number' ? rawSeq : Number(rawSeq);
          if (!isNaN(seqNum) && seqNum > highestSeqInPage) {
            highestSeqInPage = seqNum;
          }

          // Shape validation
          const validation = validatePulledRow(table, rawRow);
          if (!validation.ok) {
            const entityId =
              typeof rawRow.id === 'string' && rawRow.id.trim() ? rawRow.id : 'unknown';
            const nowStr = new Date().toISOString();
            await db.runAsync(
              `INSERT INTO sync_errors (
                 mutation_id, table_name, entity_id, code, message, created_at
               ) VALUES (?, ?, ?, 'malformed_row', ?, ?);`,
              [`pull_err_${Date.now()}`, table, entityId, validation.error, nowStr]
            );
            continue;
          }

          // Rule: NEVER overwrite a local row whose sync_state is 'pending' or 'conflict'
          // (leave it for the push and conflict logic); every other row is replaced
          // by the server row (including soft deletes, deleted_at set).
          const localRow = await db.getFirstAsync<{ sync_state: string }>(
            `SELECT sync_state FROM ${table} WHERE id = ?;`,
            [rawRow.id as string]
          );

          if (
            localRow &&
            (localRow.sync_state === 'pending' || localRow.sync_state === 'conflict')
          ) {
            continue;
          }

          if (table === 'categories') {
            await db.runAsync(
              `INSERT INTO categories (
                 id, user_id, name, icon, color, type, archived_at,
                 version, change_seq, created_at, updated_at, deleted_at,
                 local_revision, sync_state
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'synced')
               ON CONFLICT (id) DO UPDATE SET
                 user_id = excluded.user_id,
                 name = excluded.name,
                 icon = excluded.icon,
                 color = excluded.color,
                 type = excluded.type,
                 archived_at = excluded.archived_at,
                 version = excluded.version,
                 change_seq = excluded.change_seq,
                 created_at = excluded.created_at,
                 updated_at = excluded.updated_at,
                 deleted_at = excluded.deleted_at,
                 sync_state = 'synced';`,
              [
                rawRow.id as string,
                rawRow.user_id as string,
                rawRow.name as string,
                rawRow.icon as string,
                rawRow.color as string,
                rawRow.type as string,
                (rawRow.archived_at as string | null) ?? null,
                rawRow.version as number,
                rawRow.change_seq as number,
                rawRow.created_at as string,
                rawRow.updated_at as string,
                (rawRow.deleted_at as string | null) ?? null,
              ]
            );
          } else if (table === 'transactions') {
            await db.runAsync(
              `INSERT INTO transactions (
                 id, user_id, type, amount, category_id, note, date,
                 recurring_id, occurrence_date,
                 version, change_seq, created_at, updated_at, deleted_at,
                 local_revision, sync_state
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'synced')
               ON CONFLICT (id) DO UPDATE SET
                 user_id = excluded.user_id,
                 type = excluded.type,
                 amount = excluded.amount,
                 category_id = excluded.category_id,
                 note = excluded.note,
                 date = excluded.date,
                 recurring_id = excluded.recurring_id,
                 occurrence_date = excluded.occurrence_date,
                 version = excluded.version,
                 change_seq = excluded.change_seq,
                 created_at = excluded.created_at,
                 updated_at = excluded.updated_at,
                 deleted_at = excluded.deleted_at,
                 sync_state = 'synced';`,
              [
                rawRow.id as string,
                rawRow.user_id as string,
                rawRow.type as string,
                rawRow.amount as number,
                rawRow.category_id as string,
                (rawRow.note as string | null) ?? null,
                rawRow.date as string,
                (rawRow.recurring_id as string | null) ?? null,
                (rawRow.occurrence_date as string | null) ?? null,
                rawRow.version as number,
                rawRow.change_seq as number,
                rawRow.created_at as string,
                rawRow.updated_at as string,
                (rawRow.deleted_at as string | null) ?? null,
              ]
            );
          }

          totalPulled++;
        }

        // Advance cursor to the highest change_seq seen in this page
        const newCursor = Math.max(storedCursor, highestSeqInPage);
        const nowIso = new Date().toISOString();
        await db.runAsync(
          `INSERT INTO sync_state_meta (table_name, last_change_seq, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT (table_name) DO UPDATE SET
             last_change_seq = excluded.last_change_seq,
             updated_at = excluded.updated_at;`,
          [table, newCursor, nowIso]
        );
      });

      emitTableChange(table);

      requestCursor = highestSeqInPage;

      if (page.length < pageSize) {
        break;
      }
    }
  }

  return { pulled: totalPulled };
}
