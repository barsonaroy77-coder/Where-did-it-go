export const version = 2;

export const statements: string[] = [
  // ---------------------------------------------------------------------------
  // 1. Mirror Table: profiles
  // ---------------------------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY NOT NULL,
    currency TEXT NOT NULL,
    currency_decimals INTEGER NOT NULL DEFAULT 2 CHECK (currency_decimals >= 0 AND currency_decimals <= 4),
    version INTEGER NOT NULL DEFAULT 1,
    change_seq INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    local_revision INTEGER NOT NULL DEFAULT 0,
    sync_state TEXT NOT NULL DEFAULT 'synced' CHECK (sync_state IN ('synced', 'pending', 'conflict'))
  );`,

  `CREATE INDEX IF NOT EXISTS idx_profiles_sync_state ON profiles (sync_state);`,

  // ---------------------------------------------------------------------------
  // 2. Mirror Table: categories
  // ---------------------------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    icon TEXT NOT NULL,
    color TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    archived_at TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    change_seq INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    local_revision INTEGER NOT NULL DEFAULT 0,
    sync_state TEXT NOT NULL DEFAULT 'synced' CHECK (sync_state IN ('synced', 'pending', 'conflict')),
    CONSTRAINT uq_categories_id_user_id UNIQUE (id, user_id)
  );`,

  `CREATE INDEX IF NOT EXISTS idx_categories_sync_state ON categories (sync_state);`,

  // ---------------------------------------------------------------------------
  // 3. Mirror Table: budgets
  // ---------------------------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS budgets (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    category_id TEXT NOT NULL,
    monthly_limit INTEGER NOT NULL CHECK (monthly_limit > 0 AND monthly_limit <= 9007199254740991),
    version INTEGER NOT NULL DEFAULT 1,
    change_seq INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    local_revision INTEGER NOT NULL DEFAULT 0,
    sync_state TEXT NOT NULL DEFAULT 'synced' CHECK (sync_state IN ('synced', 'pending', 'conflict')),
    CONSTRAINT fk_budgets_category FOREIGN KEY (category_id, user_id) REFERENCES categories (id, user_id) ON DELETE CASCADE
  );`,

  `CREATE UNIQUE INDEX IF NOT EXISTS idx_budgets_category_active
    ON budgets (category_id)
    WHERE deleted_at IS NULL;`,

  `CREATE INDEX IF NOT EXISTS idx_budgets_sync_state ON budgets (sync_state);`,

  // ---------------------------------------------------------------------------
  // 4. Mirror Table: recurring
  // ---------------------------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS recurring (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    amount INTEGER NOT NULL CHECK (amount > 0 AND amount <= 9007199254740991),
    category_id TEXT NOT NULL,
    note TEXT,
    frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'biweekly', 'bi-weekly', 'monthly', 'yearly', 'annually')),
    start_date TEXT NOT NULL,
    next_date TEXT NOT NULL,
    schedule_timezone TEXT NOT NULL,
    anchor_day INTEGER NOT NULL CHECK (anchor_day >= 1 AND anchor_day <= 31),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    version INTEGER NOT NULL DEFAULT 1,
    change_seq INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    local_revision INTEGER NOT NULL DEFAULT 0,
    sync_state TEXT NOT NULL DEFAULT 'synced' CHECK (sync_state IN ('synced', 'pending', 'conflict')),
    CONSTRAINT fk_recurring_category FOREIGN KEY (category_id, user_id) REFERENCES categories (id, user_id) ON DELETE CASCADE
  );`,

  `CREATE INDEX IF NOT EXISTS idx_recurring_sync_state ON recurring (sync_state);`,

  // ---------------------------------------------------------------------------
  // 5. Mirror Table: transactions
  // ---------------------------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    amount INTEGER NOT NULL CHECK (amount > 0 AND amount <= 9007199254740991),
    category_id TEXT NOT NULL,
    note TEXT,
    date TEXT NOT NULL,
    recurring_id TEXT REFERENCES recurring (id) ON DELETE SET NULL,
    occurrence_date TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    change_seq INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    local_revision INTEGER NOT NULL DEFAULT 0,
    sync_state TEXT NOT NULL DEFAULT 'synced' CHECK (sync_state IN ('synced', 'pending', 'conflict')),
    CONSTRAINT fk_transactions_category FOREIGN KEY (category_id, user_id) REFERENCES categories (id, user_id) ON DELETE CASCADE
  );`,

  `CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions (date);`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_category_id ON transactions (category_id);`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_deleted_at ON transactions (deleted_at);`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_sync_state ON transactions (sync_state);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_recurring_occurrence
    ON transactions (recurring_id, occurrence_date)
    WHERE recurring_id IS NOT NULL;`,

  // ---------------------------------------------------------------------------
  // 6. Mirror Table: goals
  // ---------------------------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS goals (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    target_amount INTEGER NOT NULL CHECK (target_amount > 0 AND target_amount <= 9007199254740991),
    month TEXT NOT NULL CHECK (strftime('%d', month) = '01'),
    version INTEGER NOT NULL DEFAULT 1,
    change_seq INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    local_revision INTEGER NOT NULL DEFAULT 0,
    sync_state TEXT NOT NULL DEFAULT 'synced' CHECK (sync_state IN ('synced', 'pending', 'conflict'))
  );`,

  `CREATE INDEX IF NOT EXISTS idx_goals_sync_state ON goals (sync_state);`,

  // ---------------------------------------------------------------------------
  // 7. Metadata Table: outbox
  // ---------------------------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS outbox (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    mutation_id TEXT NOT NULL UNIQUE,
    table_name TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    op TEXT NOT NULL CHECK (op IN ('create', 'update', 'delete')),
    base_version INTEGER,
    payload TEXT,
    local_revision INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_flight', 'failed', 'blocked')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    next_attempt_at TEXT,
    created_at TEXT NOT NULL
  );`,

  `CREATE INDEX IF NOT EXISTS idx_outbox_status_sequence ON outbox (status, sequence);`,

  // ---------------------------------------------------------------------------
  // 8. Metadata Table: sync_state_meta
  // ---------------------------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS sync_state_meta (
    table_name TEXT PRIMARY KEY NOT NULL,
    last_change_seq INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );`,

  // ---------------------------------------------------------------------------
  // 9. Metadata Table: sync_errors
  // ---------------------------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS sync_errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mutation_id TEXT NOT NULL,
    table_name TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    code TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL
  );`,

  // ---------------------------------------------------------------------------
  // 10. Metadata Table: conflicts
  // ---------------------------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS conflicts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mutation_id TEXT NOT NULL,
    table_name TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    local_payload TEXT NOT NULL,
    server_row TEXT NOT NULL,
    created_at TEXT NOT NULL,
    resolved_at TEXT,
    resolution TEXT CHECK (resolution IN ('keep_mine', 'use_server'))
  );`,
];

export default {
  version,
  statements,
};
