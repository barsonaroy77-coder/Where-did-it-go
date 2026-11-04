-- =============================================================================
-- Migration: 0002_triggers.sql
-- Description: Server-controlled audit timestamps, version increments, and
--              change sequence tracking via reusable BEFORE triggers.
-- Tables affected: profiles, categories, budgets, recurring, transactions, goals
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Reusable Trigger Function: BEFORE INSERT
-- -----------------------------------------------------------------------------
-- Enforces server control over versioning, creation/update timestamps, and
-- the pull cursor sequence on new entity insertion. Any client-provided values
-- for these metadata fields are strictly overridden.
create or replace function handle_before_insert()
returns trigger as $$
begin
  -- Force initial server version
  new.version := 1;

  -- Set server audit timestamps
  new.created_at := now();
  new.updated_at := now();

  -- Advance pull sequence from shared generator
  new.change_seq := nextval('global_change_seq');

  return new;
end;
$$ language plpgsql;

-- -----------------------------------------------------------------------------
-- 2. Reusable Trigger Function: BEFORE UPDATE
-- -----------------------------------------------------------------------------
-- Protects immutable identity fields (id and user_id), preserves original
-- created_at timestamp, increments the entity version, updates updated_at,
-- and advances change_seq. Handles soft deletes transparently (since soft
-- deletes are updates setting deleted_at).
create or replace function handle_before_update()
returns trigger as $$
begin
  -- id is immutable across all tables
  if new.id is distinct from old.id then
    raise exception 'Cannot modify immutable column: id';
  end if;

  -- user_id is immutable; profiles table has no user_id column so handle explicitly
  if tg_table_name <> 'profiles' then
    if new.user_id is distinct from old.user_id then
      raise exception 'Cannot modify immutable column: user_id';
    end if;
  end if;

  -- created_at must remain unchanged
  new.created_at := old.created_at;

  -- Increment server-controlled version for optimistic concurrency
  new.version := old.version + 1;

  -- Refresh update timestamp
  new.updated_at := now();

  -- Advance pull sequence cursor
  new.change_seq := nextval('global_change_seq');

  return new;
end;
$$ language plpgsql;

-- -----------------------------------------------------------------------------
-- 3. Attach Triggers to Tables
-- -----------------------------------------------------------------------------

-- Table: profiles
drop trigger if exists trg_profiles_before_insert on profiles;
create trigger trg_profiles_before_insert
  before insert on profiles
  for each row
  execute function handle_before_insert();

drop trigger if exists trg_profiles_before_update on profiles;
create trigger trg_profiles_before_update
  before update on profiles
  for each row
  execute function handle_before_update();

-- Table: categories
drop trigger if exists trg_categories_before_insert on categories;
create trigger trg_categories_before_insert
  before insert on categories
  for each row
  execute function handle_before_insert();

drop trigger if exists trg_categories_before_update on categories;
create trigger trg_categories_before_update
  before update on categories
  for each row
  execute function handle_before_update();

-- Table: budgets
drop trigger if exists trg_budgets_before_insert on budgets;
create trigger trg_budgets_before_insert
  before insert on budgets
  for each row
  execute function handle_before_insert();

drop trigger if exists trg_budgets_before_update on budgets;
create trigger trg_budgets_before_update
  before update on budgets
  for each row
  execute function handle_before_update();

-- Table: recurring
drop trigger if exists trg_recurring_before_insert on recurring;
create trigger trg_recurring_before_insert
  before insert on recurring
  for each row
  execute function handle_before_insert();

drop trigger if exists trg_recurring_before_update on recurring;
create trigger trg_recurring_before_update
  before update on recurring
  for each row
  execute function handle_before_update();

-- Table: transactions
drop trigger if exists trg_transactions_before_insert on transactions;
create trigger trg_transactions_before_insert
  before insert on transactions
  for each row
  execute function handle_before_insert();

drop trigger if exists trg_transactions_before_update on transactions;
create trigger trg_transactions_before_update
  before update on transactions
  for each row
  execute function handle_before_update();

-- Table: goals
drop trigger if exists trg_goals_before_insert on goals;
create trigger trg_goals_before_insert
  before insert on goals
  for each row
  execute function handle_before_insert();

drop trigger if exists trg_goals_before_update on goals;
create trigger trg_goals_before_update
  before update on goals
  for each row
  execute function handle_before_update();
