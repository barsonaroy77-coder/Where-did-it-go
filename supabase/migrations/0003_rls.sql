-- =============================================================================
-- Migration: 0003_rls.sql
-- Description: Row Level Security (RLS) policies and role permissions for Where
--              Did It Go? (PRD v4.0 Section 9).
--
-- Tables covered:
--   1. profiles
--   2. categories
--   3. budgets
--   4. recurring
--   5. transactions
--   6. goals
--
-- Security rules enforced:
--   - ENABLE and FORCE row level security on all six tables.
--   - REVOKE all privileges on these tables from role 'anon'.
--   - REVOKE hard DELETE from role 'authenticated' (soft deletes only via deleted_at).
--   - GRANT only SELECT, INSERT, UPDATE on these tables to role 'authenticated'.
--   - Policies restrict access using (select auth.uid()).
--   - Cross-user moves prevented on UPDATE via WITH CHECK (user_id = (select auth.uid())).
--   - profiles table uses id = (select auth.uid()) since it has no user_id column.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Enable and Force Row Level Security (RLS)
-- -----------------------------------------------------------------------------
-- Enabling RLS activates policy evaluation for queries.
-- FORCING RLS ensures policies are applied even if queries run as the table owner.

alter table profiles enable row level security;
alter table profiles force row level security;

alter table categories enable row level security;
alter table categories force row level security;

alter table budgets enable row level security;
alter table budgets force row level security;

alter table recurring enable row level security;
alter table recurring force row level security;

alter table transactions enable row level security;
alter table transactions force row level security;

alter table goals enable row level security;
alter table goals force row level security;

-- -----------------------------------------------------------------------------
-- 2. Role Privileges & Grants
-- -----------------------------------------------------------------------------
-- Revoke all table privileges from the unauthenticated role ('anon').
-- Anonymous requests have zero access to user-facing financial tables.
revoke all on table profiles from anon;
revoke all on table categories from anon;
revoke all on table budgets from anon;
revoke all on table recurring from anon;
revoke all on table transactions from anon;
revoke all on table goals from anon;
revoke all on sequence global_change_seq from anon;

-- Establish baseline for the 'authenticated' role by revoking any default grants,
-- then explicitly granting SELECT, INSERT, and UPDATE.
-- DELETE is strictly not granted: this application uses soft deletes (deleted_at).
revoke all on table profiles from authenticated;
revoke all on table categories from authenticated;
revoke all on table budgets from authenticated;
revoke all on table recurring from authenticated;
revoke all on table transactions from authenticated;
revoke all on table goals from authenticated;

grant select, insert, update on table profiles to authenticated;
grant select, insert, update on table categories to authenticated;
grant select, insert, update on table budgets to authenticated;
grant select, insert, update on table recurring to authenticated;
grant select, insert, update on table transactions to authenticated;
grant select, insert, update on table goals to authenticated;

-- Grant sequence usage to authenticated so BEFORE INSERT/UPDATE triggers can advance change_seq
grant usage, select on sequence global_change_seq to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Profiles Policies
-- -----------------------------------------------------------------------------
-- Table: profiles
-- The profiles table uses primary key 'id' referencing auth.users(id).
-- There is no separate user_id column; identity is matched via id = (select auth.uid()).

-- SELECT: Authenticated users can only view their own profile.
drop policy if exists "Users can select own profile" on profiles;
create policy "Users can select own profile"
  on profiles
  for select
  to authenticated
  using (id = (select auth.uid()));

-- INSERT: Authenticated users can only create a profile row for their own auth.uid().
drop policy if exists "Users can insert own profile" on profiles;
create policy "Users can insert own profile"
  on profiles
  for insert
  to authenticated
  with check (id = (select auth.uid()));

-- UPDATE: Authenticated users can only update their own profile row.
-- 'using' ensures only their existing row can be targeted.
-- 'with check' ensures the id cannot be updated to any other user's id.
drop policy if exists "Users can update own profile" on profiles;
create policy "Users can update own profile"
  on profiles
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- 4. Categories Policies
-- -----------------------------------------------------------------------------
-- Table: categories

-- SELECT: Authenticated users can only view categories where user_id matches their auth.uid().
drop policy if exists "Users can select own categories" on categories;
create policy "Users can select own categories"
  on categories
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- INSERT: Authenticated users can only insert categories tagged with their own user_id.
drop policy if exists "Users can insert own categories" on categories;
create policy "Users can insert own categories"
  on categories
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

-- UPDATE: Authenticated users can only modify categories belonging to their user_id.
-- 'using' filters rows so users cannot touch other users' categories.
-- 'with check' ensures user_id cannot be reassigned or moved to another user.
drop policy if exists "Users can update own categories" on categories;
create policy "Users can update own categories"
  on categories
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- 5. Budgets Policies
-- -----------------------------------------------------------------------------
-- Table: budgets

-- SELECT: Authenticated users can only view budgets where user_id matches their auth.uid().
drop policy if exists "Users can select own budgets" on budgets;
create policy "Users can select own budgets"
  on budgets
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- INSERT: Authenticated users can only insert budgets tagged with their own user_id.
drop policy if exists "Users can insert own budgets" on budgets;
create policy "Users can insert own budgets"
  on budgets
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

-- UPDATE: Authenticated users can only modify budgets belonging to their user_id.
-- 'using' filters rows so users cannot touch other users' budgets.
-- 'with check' ensures user_id cannot be reassigned or moved to another user.
drop policy if exists "Users can update own budgets" on budgets;
create policy "Users can update own budgets"
  on budgets
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- 6. Recurring Policies
-- -----------------------------------------------------------------------------
-- Table: recurring

-- SELECT: Authenticated users can only view recurring rules where user_id matches their auth.uid().
drop policy if exists "Users can select own recurring" on recurring;
create policy "Users can select own recurring"
  on recurring
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- INSERT: Authenticated users can only insert recurring rules tagged with their own user_id.
drop policy if exists "Users can insert own recurring" on recurring;
create policy "Users can insert own recurring"
  on recurring
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

-- UPDATE: Authenticated users can only modify recurring rules belonging to their user_id.
-- 'using' filters rows so users cannot touch other users' recurring rules.
-- 'with check' ensures user_id cannot be reassigned or moved to another user.
drop policy if exists "Users can update own recurring" on recurring;
create policy "Users can update own recurring"
  on recurring
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- 7. Transactions Policies
-- -----------------------------------------------------------------------------
-- Table: transactions

-- SELECT: Authenticated users can only view transactions where user_id matches their auth.uid().
drop policy if exists "Users can select own transactions" on transactions;
create policy "Users can select own transactions"
  on transactions
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- INSERT: Authenticated users can only insert transactions tagged with their own user_id.
drop policy if exists "Users can insert own transactions" on transactions;
create policy "Users can insert own transactions"
  on transactions
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

-- UPDATE: Authenticated users can only modify transactions belonging to their user_id.
-- 'using' filters rows so users cannot touch other users' transactions.
-- 'with check' ensures user_id cannot be reassigned or moved to another user.
drop policy if exists "Users can update own transactions" on transactions;
create policy "Users can update own transactions"
  on transactions
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- 8. Goals Policies
-- -----------------------------------------------------------------------------
-- Table: goals

-- SELECT: Authenticated users can only view savings goals where user_id matches their auth.uid().
drop policy if exists "Users can select own goals" on goals;
create policy "Users can select own goals"
  on goals
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- INSERT: Authenticated users can only insert savings goals tagged with their own user_id.
drop policy if exists "Users can insert own goals" on goals;
create policy "Users can insert own goals"
  on goals
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

-- UPDATE: Authenticated users can only modify savings goals belonging to their user_id.
-- 'using' filters rows so users cannot touch other users' savings goals.
-- 'with check' ensures user_id cannot be reassigned or moved to another user.
drop policy if exists "Users can update own goals" on goals;
create policy "Users can update own goals"
  on goals
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- =============================================================================
-- MANUAL TESTS
-- =============================================================================
/*
-- Run this test suite in the Supabase SQL Editor.
-- The entire block runs inside an uncommitted transaction (rolls back at the end)
-- so it verifies RLS and role permissions cleanly without persisting test data.

begin;

-- Seed two test users in auth.users to satisfy foreign key constraints
insert into auth.users (id, aud, role, email)
values
  ('11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'user_a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'user_b@example.com')
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Step 1: Simulate User A
-- -----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

-- Verify active user
select auth.uid() as current_user_a; -- Expect: 11111111-1111-1111-1111-111111111111

-- User A inserts own profile
insert into profiles (id, currency, currency_decimals)
values ('11111111-1111-1111-1111-111111111111', 'USD', 2);

-- User A inserts own category
insert into categories (id, user_id, name, icon, color, type)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Groceries', 'cart', '#22C55E', 'expense');

-- User A inserts own budget
insert into budgets (id, user_id, category_id, monthly_limit)
values ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 50000);

-- User A inserts own recurring rule
insert into recurring (id, user_id, type, amount, category_id, note, frequency, start_date, next_date, schedule_timezone, anchor_day, is_active)
values ('aaaaaaaa-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'expense', 2000, 'aaaaaaaa-0000-0000-0000-000000000001', 'Weekly shopping', 'weekly', '2026-11-01', '2026-11-08', 'UTC', 1, true);

-- User A inserts own transaction
insert into transactions (id, user_id, type, amount, category_id, note, date)
values ('aaaaaaaa-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'expense', 4500, 'aaaaaaaa-0000-0000-0000-000000000001', 'Supermarket run', '2026-11-04');

-- User A inserts own goal
insert into goals (id, user_id, name, target_amount, month)
values ('aaaaaaaa-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Emergency Fund', 100000, '2026-11-01');

-- User A reads own rows (all counts must be 1)
select
  (select count(*) from profiles)     as user_a_profiles,
  (select count(*) from categories)   as user_a_categories,
  (select count(*) from budgets)      as user_a_budgets,
  (select count(*) from recurring)    as user_a_recurring,
  (select count(*) from transactions) as user_a_transactions,
  (select count(*) from goals)        as user_a_goals;

-- User A updates own category (must succeed, affects 1 row)
update categories set name = 'Food & Groceries' where id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- -----------------------------------------------------------------------------
-- Step 2: Simulate User B
-- -----------------------------------------------------------------------------
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

-- Verify active user
select auth.uid() as current_user_b; -- Expect: 22222222-2222-2222-2222-222222222222

-- TEST 1: User B CANNOT read User A's rows (all counts must return 0)
select
  (select count(*) from profiles)     as user_b_profiles,
  (select count(*) from categories)   as user_b_categories,
  (select count(*) from budgets)      as user_b_budgets,
  (select count(*) from recurring)    as user_b_recurring,
  (select count(*) from transactions) as user_b_transactions,
  (select count(*) from goals)        as user_b_goals;

-- TEST 2: User B CANNOT update User A's rows (affects 0 rows because rows are filtered out by USING)
update categories set name = 'Hacked Category' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
update transactions set amount = 999999 where id = 'aaaaaaaa-0000-0000-0000-000000000004';
update profiles set currency = 'EUR' where id = '11111111-1111-1111-1111-111111111111';

-- TEST 3: User B CANNOT insert rows claiming to be User A
-- (Each of the following statement blocks will raise an RLS WITH CHECK policy violation error if executed):
--
-- do $$
-- begin
--   insert into categories (id, user_id, name, icon, color, type)
--   values ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Spoofed', 'tag', '#000', 'expense');
--   raise exception 'TEST FAILED: User B was able to insert category as User A';
-- exception when check_violation or insufficient_privilege then
--   raise notice 'TEST PASSED: Blocked cross-user insert on categories';
-- end $$;

-- TEST 4: User B inserts own category, but CANNOT move it to User A
insert into categories (id, user_id, name, icon, color, type)
values ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'User B Personal', 'tag', '#3B82F6', 'expense');

-- Attempting to update user_id to User A's user_id is blocked by WITH CHECK and immutable trigger:
-- update categories set user_id = '11111111-1111-1111-1111-111111111111' where id = 'bbbbbbbb-0000-0000-0000-000000000002';

-- TEST 5: User B CANNOT perform a hard DELETE on any table (hard DELETE not granted)
-- delete from categories where id = 'bbbbbbbb-0000-0000-0000-000000000002';
-- Expect: ERROR: permission denied for table categories

-- -----------------------------------------------------------------------------
-- Step 3: Simulate Anonymous Role ('anon')
-- -----------------------------------------------------------------------------
set local role anon;

-- TEST 6: Anon role has NO SELECT/INSERT/UPDATE/DELETE access on any table
-- select * from categories;
-- Expect: ERROR: permission denied for table categories

rollback;
*/
