-- =============================================================================
-- Migration: 0004_seed_categories.sql
-- Description: Idempotent default category seeding on user registration
--              (PRD v4.0 Sections 6.2 and 7).
--
-- Components:
--   1. Sequence resolution hardening for BEFORE INSERT trigger.
--   2. Function public.seed_default_categories(p_user_id uuid).
--   3. Trigger function public.handle_new_user() and AFTER INSERT trigger on auth.users.
--   4. Strict security hardening (SECURITY DEFINER, search_path = '', revoked EXECUTE).
--   5. Interaction explanation with FORCE ROW LEVEL SECURITY.
--   6. Commented-out manual test suite.
--
-- Notes:
--   - Default expense categories (8): Food, Transport, Rent, Bills, Shopping,
--     Health, Entertainment, Other.
--   - Default income categories (4): Salary, Freelance, Gift, Other income.
--   - Color hex codes match tokens in src/theme/colors.ts.
--   - Idempotency guaranteed via deterministic UUIDs: md5(p_user_id || ':' || key)::uuid
--     with ON CONFLICT (id) DO NOTHING so user renames/customizations are preserved.
--   - Profiles are NOT created here (the app creates profiles during onboarding).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Sequence Resolution Hardening
-- -----------------------------------------------------------------------------
-- In 0002_triggers.sql, handle_before_insert() called nextval('global_change_seq')
-- without schema qualification. When invoked inside SECURITY DEFINER functions
-- configured with `search_path = ''`, PostgreSQL cannot resolve unqualified objects.
-- Qualifying nextval('public.global_change_seq') ensures the trigger fires seamlessly.
create or replace function public.handle_before_insert()
returns trigger as $$
begin
  -- Force initial server version
  new.version := 1;

  -- Set server audit timestamps
  new.created_at := now();
  new.updated_at := now();

  -- Advance pull sequence from shared generator using fully-qualified name
  new.change_seq := nextval('public.global_change_seq');

  return new;
end;
$$ language plpgsql;

-- -----------------------------------------------------------------------------
-- 2. Idempotent Category Seeding Function
-- -----------------------------------------------------------------------------
-- Inserts 8 default expense categories and 4 default income categories for a user.
-- Each category ID is generated deterministically from the user's UUID and a fixed key.
-- ON CONFLICT (id) DO NOTHING ensures:
--   - Running the function repeatedly creates zero duplicates.
--   - If the user renames or modifies a default category, their changes are never overwritten.
-- Colors are exact tokens sourced from src/theme/colors.ts:
--   - colors.accent:        #FFE600
--   - colors.positive:      #16A34A
--   - colors.negative:      #DC2626
--   - colors.textSecondary: #4A4A4A
--   - colors.textMuted:     #71717A
create or replace function public.seed_default_categories(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.categories (
    id,
    user_id,
    name,
    icon,
    color,
    type
  )
  values
    -- -------------------------------------------------------------------------
    -- Expense categories (8)
    -- -------------------------------------------------------------------------
    (
      md5(p_user_id::text || ':expense_food')::uuid,
      p_user_id,
      'Food',
      'utensils',
      '#FFE600',
      'expense'
    ),
    (
      md5(p_user_id::text || ':expense_transport')::uuid,
      p_user_id,
      'Transport',
      'car',
      '#4A4A4A',
      'expense'
    ),
    (
      md5(p_user_id::text || ':expense_rent')::uuid,
      p_user_id,
      'Rent',
      'home',
      '#DC2626',
      'expense'
    ),
    (
      md5(p_user_id::text || ':expense_bills')::uuid,
      p_user_id,
      'Bills',
      'receipt',
      '#DC2626',
      'expense'
    ),
    (
      md5(p_user_id::text || ':expense_shopping')::uuid,
      p_user_id,
      'Shopping',
      'shopping-bag',
      '#FFE600',
      'expense'
    ),
    (
      md5(p_user_id::text || ':expense_health')::uuid,
      p_user_id,
      'Health',
      'heart',
      '#DC2626',
      'expense'
    ),
    (
      md5(p_user_id::text || ':expense_entertainment')::uuid,
      p_user_id,
      'Entertainment',
      'film',
      '#FFE600',
      'expense'
    ),
    (
      md5(p_user_id::text || ':expense_other')::uuid,
      p_user_id,
      'Other',
      'more-horizontal',
      '#71717A',
      'expense'
    ),

    -- -------------------------------------------------------------------------
    -- Income categories (4)
    -- -------------------------------------------------------------------------
    (
      md5(p_user_id::text || ':income_salary')::uuid,
      p_user_id,
      'Salary',
      'briefcase',
      '#16A34A',
      'income'
    ),
    (
      md5(p_user_id::text || ':income_freelance')::uuid,
      p_user_id,
      'Freelance',
      'laptop',
      '#16A34A',
      'income'
    ),
    (
      md5(p_user_id::text || ':income_gift')::uuid,
      p_user_id,
      'Gift',
      'gift',
      '#FFE600',
      'income'
    ),
    (
      md5(p_user_id::text || ':income_other_income')::uuid,
      p_user_id,
      'Other income',
      'arrow-down-circle',
      '#16A34A',
      'income'
    )
  on conflict (id) do nothing;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Trigger Function and Trigger on auth.users
-- -----------------------------------------------------------------------------
-- Automatically seeds default categories whenever a new user row is created
-- in auth.users by Supabase Auth (e.g. email signup, OAuth login).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.seed_default_categories(new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- 4. Security Hardening & Privilege Revocation
-- -----------------------------------------------------------------------------
-- Functions run as SECURITY DEFINER with search_path = '' to protect against
-- search path hijack vulnerabilities.
-- REVOKE EXECUTE ensures clients (authenticated or anon) cannot invoke these
-- internal provisioning routines directly via Supabase RPC.
revoke execute on function public.seed_default_categories(uuid) from public;
revoke execute on function public.seed_default_categories(uuid) from anon;
revoke execute on function public.seed_default_categories(uuid) from authenticated;

revoke execute on function public.handle_new_user() from public;
revoke execute on function public.handle_new_user() from anon;
revoke execute on function public.handle_new_user() from authenticated;

-- -----------------------------------------------------------------------------
-- 5. Interaction with FORCE ROW LEVEL SECURITY (from 0003_rls.sql)
-- -----------------------------------------------------------------------------
-- In 0003_rls.sql, FORCE ROW LEVEL SECURITY was enabled on public.categories,
-- and the INSERT policy checks: with check (user_id = (select auth.uid())).
--
-- Why category seeding succeeds despite FORCE RLS:
-- 1. seed_default_categories is defined with SECURITY DEFINER. In PostgreSQL,
--    it executes with the privileges and context of the function owner (the
--    'postgres' superuser/admin role in Supabase).
-- 2. According to PostgreSQL documentation on Row Security:
--    "Superusers and roles with the BYPASSRLS attribute always bypass the row
--     security system when accessing a table."
--    While FORCE ROW LEVEL SECURITY forces RLS on table owners lacking BYPASSRLS,
--    the 'postgres' role in Supabase possesses the BYPASSRLS attribute.
-- 3. Consequently, the function owner bypasses the category INSERT policy,
--    enabling automatic seeding during registration even when auth.uid() is
--    null or unassigned in background/trigger execution.
-- 4. External calls from client roles remain completely blocked by the revoked
--    EXECUTE privileges above.

-- =============================================================================
-- MANUAL TESTS
-- =============================================================================
/*
-- Run this test suite in the Supabase SQL Editor.
-- The entire block runs inside an uncommitted transaction (rolls back at the end)
-- so it tests trigger invocation, seeding, and idempotency without persisting data.

begin;

-- Define a test user UUID
-- Test user: '33333333-3333-3333-3333-333333333333'

-- -----------------------------------------------------------------------------
-- Step 1: Simulate User Signup in auth.users
-- -----------------------------------------------------------------------------
-- Inserting into auth.users fires trigger on_auth_user_created -> seed_default_categories(new.id)
insert into auth.users (id, aud, role, email)
values ('33333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated', 'seed_test@example.com')
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Step 2: Verify Initial Seed
-- -----------------------------------------------------------------------------
-- Should return exactly 12 categories (8 expense, 4 income)
select count(*) as initial_seed_count
from public.categories
where user_id = '33333333-3333-3333-3333-333333333333';

-- Inspect seeded categories, icons, colors, and types
select name, type, icon, color
from public.categories
where user_id = '33333333-3333-3333-3333-333333333333'
order by type, name;

-- -----------------------------------------------------------------------------
-- Step 3: Simulate User Customization (Rename 'Food' to 'Groceries & Dining')
-- -----------------------------------------------------------------------------
update public.categories
set name = 'Groceries & Dining'
where user_id = '33333333-3333-3333-3333-333333333333'
  and id = md5('33333333-3333-3333-3333-333333333333:expense_food')::uuid;

-- -----------------------------------------------------------------------------
-- Step 4: Call seed_default_categories a Second Time (Test Idempotency)
-- -----------------------------------------------------------------------------
select public.seed_default_categories('33333333-3333-3333-3333-333333333333');

-- -----------------------------------------------------------------------------
-- Step 5: Verify Count Did Not Change (Still exactly 12)
-- -----------------------------------------------------------------------------
select count(*) as count_after_reseed
from public.categories
where user_id = '33333333-3333-3333-3333-333333333333';

-- -----------------------------------------------------------------------------
-- Step 6: Verify User Customization Was Preserved
-- -----------------------------------------------------------------------------
-- The renamed category must still be 'Groceries & Dining', NOT overwritten to 'Food'
select id, name, icon, color
from public.categories
where user_id = '33333333-3333-3333-3333-333333333333'
  and id = md5('33333333-3333-3333-3333-333333333333:expense_food')::uuid;

rollback;
*/
