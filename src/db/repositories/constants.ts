/**
 * Server-owned value placeholders for local SQLite writes.
 * Per PRD Section 7.1, 7.2 and Offline Sync Architecture (Phase 4 Part 4):
 *
 * The server is the authoritative source for created_at, updated_at,
 * change_seq, and version increments (managed by Postgres BEFORE triggers).
 *
 * When creating entities locally while offline:
 * - version: initialized with the schema default (1); on updates, version preserves
 *   the last known server version without local increment.
 * - change_seq: 0 (placeholder until server pull cursor assigns it).
 * - created_at & updated_at: '1970-01-01T00:00:00.000Z' (unambiguous placeholder string
 *   satisfying the SQLite NOT NULL constraint until real server timestamps arrive).
 * - local_revision: increments with every local write (starts at 1).
 * - sync_state: 'pending'.
 */
export const SERVER_PLACEHOLDER_VERSION = 1;
export const SERVER_PLACEHOLDER_CHANGE_SEQ = 0;
export const SERVER_PLACEHOLDER_TIMESTAMP = '1970-01-01T00:00:00.000Z';
export const DEFAULT_USER_ID_FALLBACK = '00000000-0000-0000-0000-000000000000';
