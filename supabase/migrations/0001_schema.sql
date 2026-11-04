-- =============================================================================
-- Migration: 0001_schema.sql
-- Description: Core database schema for Where Did It Go? (PRD v4.0 Section 7.2)
-- Tables:
--   1. profiles
--   2. categories
--   3. budgets
--   4. recurring
--   5. transactions
--   6. goals
--
-- Shared pull sequence: global_change_seq
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Shared Sequence for Pull Protocol Cursor
-- -----------------------------------------------------------------------------
-- Monotonically increasing sequence used across all synchronized tables
-- to allow clients to pull incremental changes (change_seq > last_seen_cursor).
create sequence if not exists global_change_seq as bigint start with 1 increment by 1;

-- -----------------------------------------------------------------------------
-- 2. Profiles Table (Account Settings & Preferences)
-- -----------------------------------------------------------------------------
-- Stores account-level settings (currency code and decimal precision).
-- Identified by the auth.users id (1:1 relationship, no independent user_id).
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  currency text not null,
  currency_decimals integer not null default 2 check (currency_decimals >= 0 and currency_decimals <= 4),
  version bigint not null default 1,
  change_seq bigint not null default nextval('global_change_seq'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 3. Categories Table
-- -----------------------------------------------------------------------------
-- Expense and income categories owned by users.
-- Client-generated UUID for offline creation.
create table if not exists categories (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  icon text not null,
  color text not null,
  type text not null check (type in ('income', 'expense')),
  archived_at timestamptz null,
  version bigint not null default 1,
  change_seq bigint not null default nextval('global_change_seq'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  -- Ensures composite foreign keys from other tables can reference (id, user_id),
  -- guaranteeing that category references belong to the same user.
  constraint categories_id_user_id_key unique (id, user_id)
);

-- -----------------------------------------------------------------------------
-- 4. Budgets Table
-- -----------------------------------------------------------------------------
-- Repeating monthly spending limits per category.
-- Limit stored as an integer in the smallest currency unit.
create table if not exists budgets (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null,
  monthly_limit bigint not null check (monthly_limit > 0 and monthly_limit <= 9007199254740991),
  version bigint not null default 1,
  change_seq bigint not null default nextval('global_change_seq'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  -- Ensures budget and category belong to the same user
  constraint fk_budgets_category foreign key (category_id, user_id)
    references categories(id, user_id) on delete cascade
);

-- -----------------------------------------------------------------------------
-- 5. Recurring Table
-- -----------------------------------------------------------------------------
-- Rules for repeating transactions generated on the server.
-- Amounts stored as integers in the smallest currency unit.
create table if not exists recurring (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('income', 'expense')),
  amount bigint not null check (amount > 0 and amount <= 9007199254740991),
  category_id uuid not null,
  note text null,
  frequency text not null,
  start_date date not null,
  next_date date not null,
  schedule_timezone text not null,
  anchor_day integer not null check (anchor_day >= 1 and anchor_day <= 31),
  is_active boolean not null default true,
  version bigint not null default 1,
  change_seq bigint not null default nextval('global_change_seq'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  -- Ensures recurring rule and category belong to the same user
  constraint fk_recurring_category foreign key (category_id, user_id)
    references categories(id, user_id) on delete cascade
);

-- -----------------------------------------------------------------------------
-- 6. Transactions Table
-- -----------------------------------------------------------------------------
-- Financial transactions (income/expense) with client-generated UUID.
-- Amounts stored as positive integers in the smallest currency unit (<= MAX_SAFE_INTEGER).
create table if not exists transactions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('income', 'expense')),
  amount bigint not null check (amount > 0 and amount <= 9007199254740991),
  category_id uuid not null,
  note text null,
  date date not null,
  recurring_id uuid null references recurring(id) on delete set null,
  occurrence_date date null,
  version bigint not null default 1,
  change_seq bigint not null default nextval('global_change_seq'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  -- Ensures transaction and referenced category belong to the same user
  constraint fk_transactions_category foreign key (category_id, user_id)
    references categories(id, user_id) on delete cascade
);

-- -----------------------------------------------------------------------------
-- 7. Goals Table
-- -----------------------------------------------------------------------------
-- Monthly savings target benchmarks.
-- month date is restricted to the first day of the calendar month (YYYY-MM-01).
create table if not exists goals (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  target_amount bigint not null check (target_amount > 0 and target_amount <= 9007199254740991),
  month date not null check (extract(day from month) = 1),
  version bigint not null default 1,
  change_seq bigint not null default nextval('global_change_seq'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

-- -----------------------------------------------------------------------------
-- 8. Indexes & Constraints
-- -----------------------------------------------------------------------------

-- Partial unique index: at most one active budget per category
create unique index if not exists idx_budgets_category_active
  on budgets (category_id)
  where deleted_at is null;

-- Partial unique index: deduplicate recurring transaction occurrences
create unique index if not exists idx_transactions_recurring_occurrence
  on transactions (recurring_id, occurrence_date)
  where recurring_id is not null;

-- Pull cursor indexes: (user_id, change_seq) on each table for efficient incremental sync
create index if not exists idx_profiles_id_change_seq
  on profiles (id, change_seq);

create index if not exists idx_categories_user_change_seq
  on categories (user_id, change_seq);

create index if not exists idx_budgets_user_change_seq
  on budgets (user_id, change_seq);

create index if not exists idx_recurring_user_change_seq
  on recurring (user_id, change_seq);

create index if not exists idx_transactions_user_change_seq
  on transactions (user_id, change_seq);

create index if not exists idx_goals_user_change_seq
  on goals (user_id, change_seq);

-- Query performance index: (user_id, date) on transactions for dashboard and list queries
create index if not exists idx_transactions_user_date
  on transactions (user_id, date);
