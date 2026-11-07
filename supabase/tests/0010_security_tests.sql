-- =============================================================================
-- Test Suite: 0010_security_tests.sql
-- Description: Security Audit, Two-User Attack Tests, Privilege Verification,
--              and Cleanup for Where Did It Go? (PRD v4.0 Sections 7, 8, 9).
--
-- INSTRUCTIONS FOR SUPABASE SQL EDITOR:
-- 1. This file contains SEPARATE, ready-to-run SQL blocks organized into labelled
--    steps. Supabase's SQL Editor returns the result of the LAST statement in each
--    block. Every non-failing block ends with exactly one SELECT statement.
-- 2. Tests that are expected to fail are isolated as standalone steps so the
--    underlying PostgreSQL error (and SQLSTATE) is directly visible in the editor.
-- 3. Before running PART 2 and PART 3, replace the placeholders 'USER_A_UID' and
--    'USER_B_UID' with two distinct valid auth user UUIDs from auth.users (for example,
--    '11111111-1111-4111-8111-111111111111' and '22222222-2222-4222-8222-222222222222').
-- 4. All test entity UUIDs strictly use valid hex characters (0-9 and a-f) and follow
--    deterministic test patterns ('a0000000-...' for User A, 'b0000000-...' for User B).
-- 5. No statements use DO $$ blocks that hide errors.
-- 6. No special SQL syntax uses schema prefixes (extract, coalesce, trim, least, etc.).
-- =============================================================================


-- =============================================================================
-- PART 1: READ-ONLY AUDIT (RUN AS ADMIN / POSTGRES, NO IMPERSONATION)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Step 1.1: Audit RLS enabled and forced on all public tables
-- -----------------------------------------------------------------------------
-- EXPECTED RESULT:
-- Exactly 7 rows returned.
-- Every table (process_mutations, budgets, categories, goals, profiles, recurring, transactions)
-- must have:
--   rls_enabled = true
--   rls_forced  = true
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'profiles',
    'categories',
    'transactions',
    'goals',
    'budgets',
    'recurring',
    'process_mutations'
  )
order by c.relname asc;


-- -----------------------------------------------------------------------------
-- Step 1.2: Audit anon role privileges
-- -----------------------------------------------------------------------------
-- EXPECTED RESULT:
-- Exactly 0 rows returned.
-- The 'anon' role must possess NO table-level grants on any of these seven tables.
select
  grantee,
  table_schema,
  table_name,
  privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'profiles',
    'categories',
    'transactions',
    'goals',
    'budgets',
    'recurring',
    'process_mutations'
  )
  and grantee = 'anon';


-- -----------------------------------------------------------------------------
-- Step 1.3: Audit authenticated role for DELETE or TRUNCATE privileges
-- -----------------------------------------------------------------------------
-- EXPECTED RESULT:
-- Exactly 0 rows returned.
-- Hard DELETE and TRUNCATE must be strictly revoked from the 'authenticated' role
-- across all synchronized tables (soft-deletes only via UPDATE deleted_at).
select
  grantee,
  table_schema,
  table_name,
  privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'profiles',
    'categories',
    'transactions',
    'goals',
    'budgets',
    'recurring',
    'process_mutations'
  )
  and grantee = 'authenticated'
  and privilege_type in ('DELETE', 'TRUNCATE');


-- -----------------------------------------------------------------------------
-- Step 1.4: Audit public functions (Security Definer, search_path, privileges)
-- -----------------------------------------------------------------------------
-- EXPECTED RESULT:
-- 4 rows returned:
-- 1. apply_mutation:
--    security_definer = false (SECURITY INVOKER)
--    config_search_path = {search_path=""}
--    public_execute = false
--    anon_execute = false
--    authenticated_execute = true
-- 2. generate_recurring_transactions:
--    security_definer = true (SECURITY DEFINER)
--    config_search_path = {search_path=""}
--    public_execute = false
--    anon_execute = false
--    authenticated_execute = false
-- 3. handle_new_user:
--    security_definer = true (SECURITY DEFINER)
--    config_search_path = {search_path=""}
--    public_execute = false
--    anon_execute = false
--    authenticated_execute = false
-- 4. seed_default_categories:
--    security_definer = true (SECURITY DEFINER)
--    config_search_path = {search_path=""}
--    public_execute = false
--    anon_execute = false
--    authenticated_execute = false
select
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  p.prosecdef as security_definer,
  p.proconfig as config_search_path,
  has_function_privilege('public', p.oid, 'EXECUTE') as public_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'apply_mutation',
    'generate_recurring_transactions',
    'seed_default_categories',
    'handle_new_user'
  )
order by p.proname asc;


-- -----------------------------------------------------------------------------
-- Step 1.5a: Audit RLS policies - ensure NO policies grant to public or anon
-- -----------------------------------------------------------------------------
-- EXPECTED RESULT:
-- Exactly 0 rows returned.
-- No policy on these tables may grant access to 'anon' or 'public'.
select
  schemaname,
  tablename,
  policyname,
  roles,
  cmd
from pg_policies
where schemaname = 'public'
  and tablename in (
    'profiles',
    'categories',
    'transactions',
    'goals',
    'budgets',
    'recurring',
    'process_mutations'
  )
  and ('anon' = any(roles) or 'public' = any(roles));


-- -----------------------------------------------------------------------------
-- Step 1.5b: Audit RLS policies - verify all policies enforce auth.uid()
-- -----------------------------------------------------------------------------
-- EXPECTED RESULT:
-- 14 rows returned (2 on profiles, 3 on categories, 3 on budgets, 3 on recurring,
-- 3 on transactions, 3 on goals, 2 on process_mutations).
-- Every row must have:
--   uses_auth_uid = true (both USING and WITH CHECK clauses contain auth.uid()).
select
  tablename,
  policyname,
  roles,
  cmd,
  (
    (qual is not null and qual like '%auth.uid()%')
    or (with_check is not null and with_check like '%auth.uid()%')
  ) as uses_auth_uid
from pg_policies
where schemaname = 'public'
  and tablename in (
    'profiles',
    'categories',
    'transactions',
    'goals',
    'budgets',
    'recurring',
    'process_mutations'
  )
order by tablename asc, policyname asc;



-- =============================================================================
-- PART 2: TWO-USER ATTACK TESTS (USER A OWNS DATA, USER B ATTACKS)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Step 2.0a: Setup initial test rows as User A
-- -----------------------------------------------------------------------------
-- EXPECTED RESULT:
-- 1 row returned:
--   a_categories = 1
--   a_budgets = 1
--   a_recurring = 1
--   a_transactions = 1
--   a_goals = 1
--   a_process_mutations = 1
reset role;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"USER_A_UID","role":"authenticated"}', false);

-- User A category
insert into categories (id, user_id, name, icon, color, type)
values (
  'a0000000-0000-0000-0000-000000000001',
  'USER_A_UID',
  'Groceries',
  'cart',
  '#16a34a',
  'expense'
) on conflict (id) do nothing;

-- User A budget
insert into budgets (id, user_id, category_id, monthly_limit)
values (
  'a0000000-0000-0000-0000-000000000002',
  'USER_A_UID',
  'a0000000-0000-0000-0000-000000000001',
  50000
) on conflict (id) do nothing;

-- User A recurring rule
insert into recurring (
  id,
  user_id,
  type,
  amount,
  category_id,
  note,
  frequency,
  start_date,
  next_date,
  schedule_timezone,
  anchor_day,
  is_active
) values (
  'a0000000-0000-0000-0000-000000000003',
  'USER_A_UID',
  'expense',
  2500,
  'a0000000-0000-0000-0000-000000000001',
  'User A Weekly Groceries',
  'weekly',
  '2026-11-01',
  '2026-11-08',
  'UTC',
  1,
  true
) on conflict (id) do nothing;

-- User A transaction
insert into transactions (
  id,
  user_id,
  type,
  amount,
  category_id,
  note,
  date
) values (
  'a0000000-0000-0000-0000-000000000004',
  'USER_A_UID',
  'expense',
  4500,
  'a0000000-0000-0000-0000-000000000001',
  'User A Supermarket Run',
  '2026-11-04'
) on conflict (id) do nothing;

-- User A savings goal
insert into goals (
  id,
  user_id,
  name,
  target_amount,
  month
) values (
  'a0000000-0000-0000-0000-000000000005',
  'USER_A_UID',
  'User A Emergency Fund',
  100000,
  '2026-11-01'
) on conflict (id) do nothing;

-- User A mutation log row
insert into process_mutations (
  mutation_id,
  user_id,
  entity_table,
  entity_id,
  result
) values (
  'a0000000-0000-0000-0000-000000000006',
  'USER_A_UID',
  'categories',
  'a0000000-0000-0000-0000-000000000001',
  '{"status":"applied"}'::jsonb
) on conflict (mutation_id) do nothing;

select
  (select count(*) from categories where id = 'a0000000-0000-0000-0000-000000000001') as a_categories,
  (select count(*) from budgets where id = 'a0000000-0000-0000-0000-000000000002') as a_budgets,
  (select count(*) from recurring where id = 'a0000000-0000-0000-0000-000000000003') as a_recurring,
  (select count(*) from transactions where id = 'a0000000-0000-0000-0000-000000000004') as a_transactions,
  (select count(*) from goals where id = 'a0000000-0000-0000-0000-000000000005') as a_goals,
  (select count(*) from process_mutations where mutation_id = 'a0000000-0000-0000-0000-000000000006') as a_process_mutations;


-- -----------------------------------------------------------------------------
-- Step 2.0b: Setup baseline category owned by User B
-- -----------------------------------------------------------------------------
-- EXPECTED RESULT:
-- 1 row returned:
--   b_categories = 1
reset role;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"USER_B_UID","role":"authenticated"}', false);

insert into categories (id, user_id, name, icon, color, type)
values (
  'b0000000-0000-0000-0000-000000000001',
  'USER_B_UID',
  'User B Personal',
  'tag',
  '#3b82f6',
  'expense'
) on conflict (id) do nothing;

select count(*) as b_categories
from categories
where id = 'b0000000-0000-0000-0000-000000000001';


-- -----------------------------------------------------------------------------
-- Step 2.1: Attack 1 - User B selects User A's rows from each of the tables
-- -----------------------------------------------------------------------------
-- EXPECTED RESULT:
-- 1 row returned with every count equal to 0 (zero rows):
--   a_profiles_seen_by_b     = 0
--   a_categories_seen_by_b   = 0
--   a_budgets_seen_by_b      = 0
--   a_recurring_seen_by_b    = 0
--   a_transactions_seen_by_b = 0
--   a_goals_seen_by_b        = 0
reset role;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"USER_B_UID","role":"authenticated"}', false);

select
  (select count(*) from profiles where id = 'USER_A_UID') as a_profiles_seen_by_b,
  (select count(*) from categories where id = 'a0000000-0000-0000-0000-000000000001') as a_categories_seen_by_b,
  (select count(*) from budgets where id = 'a0000000-0000-0000-0000-000000000002') as a_budgets_seen_by_b,
  (select count(*) from recurring where id = 'a0000000-0000-0000-0000-000000000003') as a_recurring_seen_by_b,
  (select count(*) from transactions where id = 'a0000000-0000-0000-0000-000000000004') as a_transactions_seen_by_b,
  (select count(*) from goals where id = 'a0000000-0000-0000-0000-000000000005') as a_goals_seen_by_b;


-- -----------------------------------------------------------------------------
-- Step 2.2: Attack 2 - User B inserts a row with user_id = User A (RLS error)
-- -----------------------------------------------------------------------------
-- EXPECTED RESULT:
-- ERROR: new row violates row-level security policy for table "categories" (SQLSTATE 42501)
reset role;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"USER_B_UID","role":"authenticated"}', false);

insert into categories (id, user_id, name, icon, color, type)
values (
  'b0000000-0000-0000-0000-000000000099',
  'USER_A_UID',
  'Spoofed Category',
  'tag',
  '#dc2626',
  'expense'
);


-- -----------------------------------------------------------------------------
-- Step 2.3: Attack 3 - User B updates User A's row directly (0 rows updated)
-- -----------------------------------------------------------------------------
-- EXPECTED RESULT:
-- 1 row returned:
--   rows_updated = 0
-- (User A's row is invisible under RLS, so 0 rows match the UPDATE target).
reset role;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"USER_B_UID","role":"authenticated"}', false);

with updated as (
  update transactions
  set amount = 999999
  where id = 'a0000000-0000-0000-0000-000000000004'
  returning id
)
select count(*) as rows_updated from updated;


-- -----------------------------------------------------------------------------
-- Step 2.4: Attack 4 - User B tries to change user_id of its OWN row to User A
-- -----------------------------------------------------------------------------
-- EXPECTED RESULT:
-- ERROR: Cannot modify immutable column: user_id (SQLSTATE P0001)
-- (Trigger handle_before_update blocks modifying user_id; WITH CHECK also blocks).
reset role;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"USER_B_UID","role":"authenticated"}', false);

update categories
set user_id = 'USER_A_UID'
where id = 'b0000000-0000-0000-0000-000000000001';


-- -----------------------------------------------------------------------------
-- Step 2.5a: Attack 5a - User B tries to soft-delete User A's row (0 rows)
-- -----------------------------------------------------------------------------
-- EXPECTED RESULT:
-- 1 row returned:
--   rows_soft_deleted = 0
reset role;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"USER_B_UID","role":"authenticated"}', false);

with soft_deleted as (
  update transactions
  set deleted_at = now()
  where id = 'a0000000-0000-0000-0000-000000000004'
  returning id
)
select count(*) as rows_soft_deleted from soft_deleted;


-- -----------------------------------------------------------------------------
-- Step 2.5b: Attack 5b - User B tries to hard-delete User A's row (permission denied)
-- -----------------------------------------------------------------------------
-- EXPECTED RESULT:
-- ERROR: permission denied for table transactions (SQLSTATE 42501)
-- (Hard DELETE privilege is strictly revoked from role authenticated).
reset role;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"USER_B_UID","role":"authenticated"}', false);

delete from transactions
where id = 'a0000000-0000-0000-0000-000000000004';


-- -----------------------------------------------------------------------------
-- Step 2.6: Attack 6 - User B uses User A's category_id in a transaction
-- -----------------------------------------------------------------------------
-- EXPECTED RESULT:
-- ERROR: insert or update on table "transactions" violates foreign key constraint "fk_transactions_category" (SQLSTATE 23503)
-- (Composite foreign key enforces (category_id, user_id) references categories(id, user_id)).
reset role;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"USER_B_UID","role":"authenticated"}', false);

insert into transactions (
  id,
  user_id,
  type,
  amount,
  category_id,
  note,
  date
) values (
  'b0000000-0000-0000-0000-000000000002',
  'USER_B_UID',
  'expense',
  3500,
  'a0000000-0000-0000-0000-000000000001',
  'Cross-user category attack',
  '2026-11-05'
);


-- -----------------------------------------------------------------------------
-- Step 2.7: Attack 7 - User B tries to forge version, updated_at, change_seq
-- -----------------------------------------------------------------------------
-- EXPECTED RESULT:
-- 1 row returned showing trigger handle_before_insert successfully overrode all forged values:
--   id                      = 'b0000000-0000-0000-0000-000000000003'
--   version                 = 1
--   updated_at_is_current   = true
--   change_seq_overridden   = true
--   version_is_one          = true
reset role;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"USER_B_UID","role":"authenticated"}', false);

insert into transactions (
  id,
  user_id,
  type,
  amount,
  category_id,
  note,
  date,
  version,
  updated_at,
  change_seq
) values (
  'b0000000-0000-0000-0000-000000000003',
  'USER_B_UID',
  'expense',
  1200,
  'b0000000-0000-0000-0000-000000000001',
  'Trigger metadata override test',
  '2026-11-06',
  999,
  '2001-01-01 00:00:00+00',
  777777
);

select
  id,
  version,
  updated_at > '2026-01-01' as updated_at_is_current,
  change_seq <> 777777 as change_seq_overridden,
  version = 1 as version_is_one
from transactions
where id = 'b0000000-0000-0000-0000-000000000003';


-- -----------------------------------------------------------------------------
-- Step 2.8: Attack 8 - User B calls apply_mutation with User A's entity id
-- -----------------------------------------------------------------------------
-- EXPECTED RESULT:
-- 1 row returned:
--   mutation_result = {"status": "not_found", "entity": null}
-- (apply_mutation scopes entity lookup to auth.uid(), returning not_found).
reset role;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"USER_B_UID","role":"authenticated"}', false);

select public.apply_mutation(
  'b0000000-0000-0000-0000-000000000004'::uuid,
  'categories',
  'a0000000-0000-0000-0000-000000000001'::uuid,
  'update',
  1,
  '{"name": "Hacked Category Name"}'::jsonb
) as mutation_result;


-- -----------------------------------------------------------------------------
-- Step 2.9: Attack 9 - User B reads User A's process_mutations rows
-- -----------------------------------------------------------------------------
-- EXPECTED RESULT:
-- 1 row returned:
--   a_mutations_seen_by_b = 0
-- (RLS policy on process_mutations restricts SELECT to user_id = auth.uid()).
reset role;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"USER_B_UID","role":"authenticated"}', false);

select count(*) as a_mutations_seen_by_b
from public.process_mutations
where user_id = 'USER_A_UID';


-- -----------------------------------------------------------------------------
-- Step 2.10: Attack 10 - User B creates a profile row with id = User A
-- -----------------------------------------------------------------------------
-- EXPECTED RESULT:
-- ERROR: new row violates row-level security policy for table "profiles" (SQLSTATE 42501)
-- (RLS INSERT policy on profiles enforces WITH CHECK (id = auth.uid())).
reset role;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"USER_B_UID","role":"authenticated"}', false);

insert into public.profiles (id, currency, currency_decimals)
values ('USER_A_UID', 'EUR', 2);


-- -----------------------------------------------------------------------------
-- Step 2.11: Reset role after Part 2
-- -----------------------------------------------------------------------------
-- EXPECTED RESULT:
-- Query completes successfully with RESET.
reset role;



-- =============================================================================
-- PART 3: PRIVILEGE TESTS
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Step 3.1a: Authenticated calling generate_recurring_transactions() fails
-- -----------------------------------------------------------------------------
-- EXPECTED RESULT:
-- ERROR: permission denied for function generate_recurring_transactions (SQLSTATE 42501)
reset role;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"USER_A_UID","role":"authenticated"}', false);

select public.generate_recurring_transactions();


-- -----------------------------------------------------------------------------
-- Step 3.1b: Authenticated calling seed_default_categories() fails
-- -----------------------------------------------------------------------------
-- EXPECTED RESULT:
-- ERROR: permission denied for function seed_default_categories (SQLSTATE 42501)
reset role;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"USER_A_UID","role":"authenticated"}', false);

select public.seed_default_categories('USER_A_UID'::uuid);


-- -----------------------------------------------------------------------------
-- Step 3.1c: Authenticated calling handle_new_user() fails
-- -----------------------------------------------------------------------------
-- EXPECTED RESULT:
-- ERROR: permission denied for function handle_new_user (SQLSTATE 42501)
reset role;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"USER_A_UID","role":"authenticated"}', false);

select public.handle_new_user();


-- -----------------------------------------------------------------------------
-- Step 3.2a: Anon role SELECT on profiles fails
-- -----------------------------------------------------------------------------
-- EXPECTED RESULT:
-- ERROR: permission denied for table profiles (SQLSTATE 42501)
reset role;
set role anon;

select count(*) from public.profiles;


-- -----------------------------------------------------------------------------
-- Step 3.2b: Anon role SELECT on categories fails
-- -----------------------------------------------------------------------------
-- EXPECTED RESULT:
-- ERROR: permission denied for table categories (SQLSTATE 42501)
reset role;
set role anon;

select count(*) from public.categories;


-- -----------------------------------------------------------------------------
-- Step 3.2c: Anon role SELECT on transactions fails
-- -----------------------------------------------------------------------------
-- EXPECTED RESULT:
-- ERROR: permission denied for table transactions (SQLSTATE 42501)
reset role;
set role anon;

select count(*) from public.transactions;


-- -----------------------------------------------------------------------------
-- Step 3.2d: Anon role SELECT on budgets fails
-- -----------------------------------------------------------------------------
-- EXPECTED RESULT:
-- ERROR: permission denied for table budgets (SQLSTATE 42501)
reset role;
set role anon;

select count(*) from public.budgets;


-- -----------------------------------------------------------------------------
-- Step 3.2e: Anon role SELECT on recurring fails
-- -----------------------------------------------------------------------------
-- EXPECTED RESULT:
-- ERROR: permission denied for table recurring (SQLSTATE 42501)
reset role;
set role anon;

select count(*) from public.recurring;


-- -----------------------------------------------------------------------------
-- Step 3.2f: Anon role SELECT on goals fails
-- -----------------------------------------------------------------------------
-- EXPECTED RESULT:
-- ERROR: permission denied for table goals (SQLSTATE 42501)
reset role;
set role anon;

select count(*) from public.goals;


-- -----------------------------------------------------------------------------
-- Step 3.2g: Anon role SELECT on process_mutations fails
-- -----------------------------------------------------------------------------
-- EXPECTED RESULT:
-- ERROR: permission denied for table process_mutations (SQLSTATE 42501)
reset role;
set role anon;

select count(*) from public.process_mutations;


-- -----------------------------------------------------------------------------
-- Step 3.2h: Anon role executing apply_mutation fails
-- -----------------------------------------------------------------------------
-- EXPECTED RESULT:
-- ERROR: permission denied for function apply_mutation (SQLSTATE 42501)
reset role;
set role anon;

select public.apply_mutation(
  '00000000-0000-0000-0000-000000000001'::uuid,
  'categories',
  '00000000-0000-0000-0000-000000000002'::uuid,
  'create',
  null,
  '{"name":"Anon Test Category","icon":"tag","color":"#000000","type":"expense"}'::jsonb
);


-- -----------------------------------------------------------------------------
-- Step 3.3: Authenticated role SELECT on cron.job fails
-- -----------------------------------------------------------------------------
-- EXPECTED RESULT:
-- ERROR: permission denied for schema cron (or table job) (SQLSTATE 42501)
reset role;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"USER_A_UID","role":"authenticated"}', false);

select count(*) from cron.job;


-- -----------------------------------------------------------------------------
-- Step 3.4: Reset role after Part 3
-- -----------------------------------------------------------------------------
-- EXPECTED RESULT:
-- Query completes successfully with RESET.
reset role;



-- =============================================================================
-- PART 4: CLEANUP BLOCK (AS ADMIN / POSTGRES)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Step 4.1: Delete all test rows created by these security test suites
-- -----------------------------------------------------------------------------
-- EXPECTED RESULT:
-- 1 row returned verifying zero remaining test records across all tables:
--   remaining_categories        = 0
--   remaining_budgets           = 0
--   remaining_recurring         = 0
--   remaining_transactions      = 0
--   remaining_goals             = 0
--   remaining_process_mutations = 0
reset role;

-- 1. Delete created mutation logs
delete from public.process_mutations
where mutation_id in (
  'a0000000-0000-0000-0000-000000000006',
  'b0000000-0000-0000-0000-000000000004'
);

-- 2. Delete created transactions
delete from public.transactions
where id in (
  'a0000000-0000-0000-0000-000000000004',
  'b0000000-0000-0000-0000-000000000003'
);

-- 3. Delete created budgets
delete from public.budgets
where id in (
  'a0000000-0000-0000-0000-000000000002'
);

-- 4. Delete created recurring rules
delete from public.recurring
where id in (
  'a0000000-0000-0000-0000-000000000003'
);

-- 5. Delete created savings goals
delete from public.goals
where id in (
  'a0000000-0000-0000-0000-000000000005'
);

-- 6. Delete created categories
delete from public.categories
where id in (
  'a0000000-0000-0000-0000-000000000001',
  'b0000000-0000-0000-0000-000000000001'
);

-- Verification: confirm every test row has been completely cleaned up
select
  (
    select count(*)
    from public.categories
    where id in ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001')
  ) as remaining_categories,
  (
    select count(*)
    from public.budgets
    where id in ('a0000000-0000-0000-0000-000000000002')
  ) as remaining_budgets,
  (
    select count(*)
    from public.recurring
    where id in ('a0000000-0000-0000-0000-000000000003')
  ) as remaining_recurring,
  (
    select count(*)
    from public.transactions
    where id in ('a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000003')
  ) as remaining_transactions,
  (
    select count(*)
    from public.goals
    where id in ('a0000000-0000-0000-0000-000000000005')
  ) as remaining_goals,
  (
    select count(*)
    from public.process_mutations
    where mutation_id in ('a0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000004')
  ) as remaining_process_mutations;
