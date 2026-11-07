-- =============================================================================
-- Migration: 0008_generate_recurring_transactions.sql
-- Description: Server-side recurring transaction generation and scheduling
--              (PRD v4.0 Sections 6.7, 7.2, 8, 9; Phase 3, Part 7).
--
-- Components:
--   1. Function public.generate_recurring_transactions(p_max_per_rule integer default 400)
--      returns integer (count of transactions created).
--   2. Security hardening:
--      - SECURITY DEFINER (required to process recurring rules across all users).
--      - SET search_path = '' (defense-in-depth against search path manipulation).
--      - Fully schema-qualified relation and function identifiers.
--      - Revoked EXECUTE privileges from public, anon, and authenticated roles.
--   3. Scheduling via pg_cron (runs hourly: '0 * * * *'), idempotent unschedule/schedule.
--   4. Commented-out manual test suite for Supabase SQL Editor.
-- =============================================================================

-- =============================================================================
-- 1. Function: public.generate_recurring_transactions
-- =============================================================================
-- Security Justification for SECURITY DEFINER:
--   This function is designed to be executed strictly by the server's automated
--   scheduler (e.g. pg_cron daemon) or by database administrators. It must evaluate
--   and generate transactions across all registered user accounts. Under Row Level
--   Security (RLS), normal user queries are constrained to `auth.uid()`, meaning an
--   unauthenticated scheduler daemon or single-user session cannot inspect or generate
--   records across multiple user accounts. SECURITY DEFINER elevates the function's
--   execution context so that it can scan active recurring rules globally.
--
-- How Tenant Isolation & User Ownership are strictly respected:
--   1. Every generated transaction copies `user_id` directly from the locked
--      recurring rule (`transactions.user_id = r.user_id`).
--   2. Category validation verifies that `category_id` exists in `public.categories`
--      and belongs to that identical user (`c.user_id = r.user_id`).
--   3. The database foreign key constraint (`fk_transactions_category`) enforces that
--      `(category_id, user_id)` matches `public.categories(id, user_id)`, physically
--      prohibiting cross-user category assignments.
--   4. No user-supplied parameters can alter the target user or bypass ownership checks.
--   5. EXECUTE permissions are revoked from `public`, `anon`, and `authenticated`,
--      preventing client apps or external API callers from invoking this routine directly.
create or replace function public.generate_recurring_transactions(
  p_max_per_rule integer default 400
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max_per_rule integer;
  v_total_created integer := 0;
  v_rule record;
  v_today date;
  v_cur_date date;
  v_next_candidate date;
  v_handled_for_rule integer;
  v_inserted_count integer;
  v_tx_id uuid;
  v_frequency text;
  v_year integer;
  v_month integer;
  v_last_day integer;
  v_target_day integer;
  v_next_month_start date;
  v_cat_exists boolean;
begin
  -- Validate / sanitize p_max_per_rule parameter
  v_max_per_rule := coalesce(p_max_per_rule, 400);
  if v_max_per_rule <= 0 then
    return 0;
  end if;

  -- Select active, non-deleted rules whose next occurrence date is due
  -- (next_date <= today in the rule's schedule_timezone).
  -- FOR UPDATE OF r SKIP LOCKED provides concurrency isolation so parallel
  -- runs do not collide or duplicate work.
  for v_rule in
    select
      r.id,
      r.user_id,
      r.type,
      r.amount,
      r.category_id,
      r.note,
      r.frequency,
      r.start_date,
      r.next_date,
      r.schedule_timezone,
      r.anchor_day,
      r.is_active
    from public.recurring r
    where r.is_active = true
      and r.deleted_at is null
      and r.next_date <= (pg_catalog.now() at time zone r.schedule_timezone)::date
    order by r.next_date asc, r.id asc
    for update of r skip locked
  loop
    -- Process each rule inside an isolated exception block so one failing rule
    -- never halts or rolls back the generation of other rules.
    begin
      -- Compute current calendar date in the rule's specific timezone
      v_today := (pg_catalog.now() at time zone v_rule.schedule_timezone)::date;

      -- Double check next_date boundary in case timezone shifted
      if v_rule.next_date > v_today then
        continue;
      end if;

      -- Validate category:
      -- Must exist, belong to the rule's user, not soft-deleted, not archived,
      -- and have a type matching the recurring rule ('income' or 'expense').
      select exists (
        select 1
        from public.categories c
        where c.id = v_rule.category_id
          and c.user_id = v_rule.user_id
          and c.deleted_at is null
          and c.archived_at is null
          and c.type = v_rule.type
      ) into v_cat_exists;

      if not v_cat_exists then
        -- Category missing, deleted, archived, or type-incompatible: skip rule safely
        continue;
      end if;

      -- Normalize frequency (values from 0001 schema / PRD)
      v_frequency := pg_catalog.lower(pg_catalog.trim(v_rule.frequency));
      if v_frequency not in ('daily', 'weekly', 'biweekly', 'bi-weekly', 'monthly', 'yearly', 'annually') then
        raise warning 'Recurring rule % has unsupported frequency: %', v_rule.id, v_rule.frequency;
        continue;
      end if;

      v_cur_date := v_rule.next_date;
      v_handled_for_rule := 0;

      -- Generate missed occurrences (catch-up), oldest first, up to v_max_per_rule
      while v_cur_date <= v_today and v_handled_for_rule < v_max_per_rule loop
        -- Deterministic transaction UUID ensures complete idempotency
        v_tx_id := pg_catalog.md5(v_rule.id::text || ':' || v_cur_date::text)::uuid;

        -- Insert occurrence transaction.
        -- Triggers handle version, created_at, updated_at, and change_seq automatically.
        -- ON CONFLICT DO NOTHING relies on primary key (id) and unique index
        -- idx_transactions_recurring_occurrence (recurring_id, occurrence_date).
        insert into public.transactions (
          id,
          user_id,
          type,
          amount,
          category_id,
          note,
          date,
          recurring_id,
          occurrence_date
        ) values (
          v_tx_id,
          v_rule.user_id,
          v_rule.type,
          v_rule.amount,
          v_rule.category_id,
          v_rule.note,
          v_cur_date,
          v_rule.id,
          v_cur_date
        )
        on conflict do nothing;

        get diagnostics v_inserted_count = row_count;
        v_total_created := v_total_created + v_inserted_count;
        v_handled_for_rule := v_handled_for_rule + 1;

        -- Advance to next occurrence date based on rule frequency and anchor day
        case v_frequency
          when 'daily' then
            v_next_candidate := v_cur_date + 1;

          when 'weekly' then
            v_next_candidate := v_cur_date + 7;

          when 'biweekly', 'bi-weekly' then
            v_next_candidate := v_cur_date + 14;

          when 'monthly' then
            -- Month-end rule: compute each occurrence from the original anchor_day,
            -- using the last day of shorter months (e.g. Feb 28/29, Apr 30) without
            -- ever mutating or losing the original anchor_day.
            v_next_month_start := (pg_catalog.make_date(
              extract(year from v_cur_date)::integer,
              extract(month from v_cur_date)::integer,
              1
            ) + interval '1 month')::date;

            v_year := extract(year from v_next_month_start)::integer;
            v_month := extract(month from v_next_month_start)::integer;
            v_last_day := extract(day from (v_next_month_start + interval '1 month' - interval '1 day'))::integer;
            v_target_day := least(v_rule.anchor_day, v_last_day);

            v_next_candidate := pg_catalog.make_date(v_year, v_month, v_target_day);

          when 'yearly', 'annually' then
            -- Leap-year rule for Feb 29: use anchor_day and start_date's month
            v_month := extract(month from v_rule.start_date)::integer;
            v_year := extract(year from v_cur_date)::integer + 1;
            v_last_day := extract(day from (pg_catalog.make_date(v_year, v_month, 1) + interval '1 month' - interval '1 day'))::integer;
            v_target_day := least(v_rule.anchor_day, v_last_day);

            v_next_candidate := pg_catalog.make_date(v_year, v_month, v_target_day);
        end case;

        -- Safeguard against clock anomalies or non-advancing dates
        if v_next_candidate <= v_cur_date then
          raise exception 'Calculated next date % is not after % for rule %', v_next_candidate, v_cur_date, v_rule.id;
        end if;

        v_cur_date := v_next_candidate;
      end loop;

      -- Advance the rule's next_date to the first occurrence that has not yet been handled.
      -- If all due occurrences were caught up, v_cur_date is the first occurrence in the future.
      -- If generation stopped due to p_max_per_rule, v_cur_date is the next pending occurrence.
      -- The BEFORE UPDATE trigger on recurring automatically advances version, updated_at, and change_seq.
      if v_handled_for_rule > 0 then
        update public.recurring
        set next_date = v_cur_date
        where id = v_rule.id;
      end if;

    exception when others then
      -- Log warning with rule ID and error details, allowing other rules to continue uninterrupted
      raise warning 'generate_recurring_transactions: failed processing rule %: %', v_rule.id, sqlerrm;
    end;
  end loop;

  return v_total_created;
end;
$$;

-- =============================================================================
-- 2. Security Hardening & Privilege Lockdown
-- =============================================================================
-- Deny execution privileges to public, anon, and authenticated roles so that
-- no external client or unauthorized session can invoke recurring generation.
revoke all on function public.generate_recurring_transactions(integer) from public;
revoke all on function public.generate_recurring_transactions(integer) from anon;
revoke all on function public.generate_recurring_transactions(integer) from authenticated;

-- =============================================================================
-- 3. Scheduling via pg_cron
-- =============================================================================
-- Enables pg_cron extension if available and schedules an hourly job.
-- Note: On Supabase, the pg_cron extension can also be enabled directly in the
-- Supabase Dashboard under Database -> Extensions -> pg_cron.

-- Attempt to enable pg_cron if present in available extensions
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
  end if;
exception when others then
  raise notice 'pg_cron extension could not be enabled via SQL (can be enabled in Supabase Dashboard): %', sqlerrm;
end;
$$;

-- Idempotently schedule the hourly recurring transaction generation job
do $$
declare
  v_job_id bigint;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Unschedule existing job if already registered to guarantee idempotency
    for v_job_id in
      select jobid from cron.job where jobname = 'generate-recurring-transactions-hourly'
    loop
      perform cron.unschedule(v_job_id);
    end loop;

    -- Schedule job to execute at minute 0 of every hour
    perform cron.schedule(
      'generate-recurring-transactions-hourly',
      '0 * * * *',
      'select public.generate_recurring_transactions();'
    );
  else
    raise notice 'pg_cron extension is not active; hourly cron job was not scheduled.';
  end if;
exception when others then
  raise notice 'Could not register cron schedule: %', sqlerrm;
end;
$$;

-- =============================================================================
-- 4. Manual Tests (Run as Admin / postgres role in Supabase SQL Editor)
-- =============================================================================
/*
-- -----------------------------------------------------------------------------
-- Instructions:
-- 1. Replace the string placeholder 'USER_A_UID' with an existing user's UUID
--    from auth.users (e.g. '11111111-1111-4111-8111-111111111111').
-- 2. Run the test block below as admin / service_role.
-- 3. After testing, execute the cleanup section at the end to delete test rows.
-- -----------------------------------------------------------------------------

begin;

-- Step 1: Seed test categories for USER_A_UID
insert into public.categories (id, user_id, name, icon, color, type)
values
  ('a1111111-1111-4111-8111-111111111111'::uuid, 'USER_A_UID'::uuid, 'Test Active Expense', 'tag', '#FFE600', 'expense'),
  ('a2222222-2222-4222-8222-222222222222'::uuid, 'USER_A_UID'::uuid, 'Test Archived Expense', 'archive', '#DC2626', 'expense')
on conflict (id) do nothing;

-- Archive category a2222222 for testing archived category skip
update public.categories
set archived_at = now()
where id = 'a2222222-2222-4222-8222-222222222222'::uuid;

-- Step 2: Seed test recurring rules
-- Rule 1: Monthly rule anchored to the 31st with past next_date in leap year 2024
-- Tests Feb 29 leap day, 30-day months (Apr, Jun, Sep, Nov), 31-day months, and Feb 28 in 2025/2026.
insert into public.recurring (
  id, user_id, type, amount, category_id, note, frequency,
  start_date, next_date, schedule_timezone, anchor_day, is_active
) values (
  'd1111111-1111-4111-8111-111111111111'::uuid,
  'USER_A_UID'::uuid,
  'expense',
  15000,
  'a1111111-1111-4111-8111-111111111111'::uuid,
  'Monthly anchor 31 test',
  'monthly',
  '2024-01-31',
  '2024-01-31',
  'UTC',
  31,
  true
) on conflict (id) do nothing;

-- Rule 2: Weekly rule 3 weeks behind (expected to generate exactly 3 catch-up transactions)
insert into public.recurring (
  id, user_id, type, amount, category_id, note, frequency,
  start_date, next_date, schedule_timezone, anchor_day, is_active
) values (
  'd2222222-2222-4222-8222-222222222222'::uuid,
  'USER_A_UID'::uuid,
  'expense',
  2500,
  'a1111111-1111-4111-8111-111111111111'::uuid,
  'Weekly catch-up test',
  'weekly',
  (now() at time zone 'UTC')::date - 14,
  (now() at time zone 'UTC')::date - 14,
  'UTC',
  1,
  true
) on conflict (id) do nothing;

-- Rule 3: Rule with an archived category (should be skipped)
insert into public.recurring (
  id, user_id, type, amount, category_id, note, frequency,
  start_date, next_date, schedule_timezone, anchor_day, is_active
) values (
  'd3333333-3333-4333-8333-333333333333'::uuid,
  'USER_A_UID'::uuid,
  'expense',
  5000,
  'a2222222-2222-4222-8222-222222222222'::uuid,
  'Archived category rule test',
  'monthly',
  '2024-01-01',
  '2024-01-01',
  'UTC',
  1,
  true
) on conflict (id) do nothing;

-- Rule 4: Inactive rule (should be skipped)
insert into public.recurring (
  id, user_id, type, amount, category_id, note, frequency,
  start_date, next_date, schedule_timezone, anchor_day, is_active
) values (
  'd4444444-4444-4444-8444-444444444444'::uuid,
  'USER_A_UID'::uuid,
  'expense',
  7500,
  'a1111111-1111-4111-8111-111111111111'::uuid,
  'Inactive rule test',
  'weekly',
  (now() at time zone 'UTC')::date - 14,
  (now() at time zone 'UTC')::date - 14,
  'UTC',
  1,
  false
) on conflict (id) do nothing;

-- Step 3: Run recurring transaction generator (First Run)
select public.generate_recurring_transactions() as rows_created_run_1;

-- Verification 1: Check Weekly Rule Catch-up (Rule 2)
-- Expect exactly 3 transactions: today - 14, today - 7, today.
select count(*) as weekly_catchup_tx_count
from public.transactions
where recurring_id = 'd2222222-2222-4222-8222-222222222222'::uuid;

-- Verify Rule 2 next_date has advanced to future (today + 7)
select next_date as rule_2_next_date, (now() at time zone 'UTC')::date + 7 as expected_next_date
from public.recurring
where id = 'd2222222-2222-4222-8222-222222222222'::uuid;

-- Verification 2: Check Monthly Rule with Anchor Day 31 (Rule 1)
-- Check Feb 29 (leap year 2024), 30-day month April 30, and Feb 28 (2025/2026)
select occurrence_date, date
from public.transactions
where recurring_id = 'd1111111-1111-4111-8111-111111111111'::uuid
  and occurrence_date in ('2024-01-31', '2024-02-29', '2024-03-31', '2024-04-30', '2025-02-28')
order by occurrence_date asc;

-- Verify Rule 1 anchor_day was preserved as 31 and next_date is in the future
select anchor_day, next_date
from public.recurring
where id = 'd1111111-1111-4111-8111-111111111111'::uuid;

-- Verification 3: Check Rule 3 (Archived Category) was skipped (0 transactions)
select count(*) as archived_cat_tx_count
from public.transactions
where recurring_id = 'd3333333-3333-4333-8333-333333333333'::uuid;

-- Verification 4: Check Rule 4 (Inactive) was skipped (0 transactions)
select count(*) as inactive_rule_tx_count
from public.transactions
where recurring_id = 'd4444444-4444-4444-8444-444444444444'::uuid;

-- Step 4: Run recurring transaction generator (Second Run - Idempotency Check)
-- Expect 0 new rows created!
select public.generate_recurring_transactions() as rows_created_run_2;

rollback; -- Use rollback if testing without persisting, OR commit and run cleanup below.

-- -----------------------------------------------------------------------------
-- Cleanup Test Data (Run after committing manual test data)
-- Delete all created test transactions, recurring rules, and categories:
-- -----------------------------------------------------------------------------
delete from public.transactions where recurring_id in (
  'd1111111-1111-4111-8111-111111111111'::uuid,
  'd2222222-2222-4222-8222-222222222222'::uuid,
  'd3333333-3333-4333-8333-333333333333'::uuid,
  'd4444444-4444-4444-8444-444444444444'::uuid
);

delete from public.recurring where id in (
  'd1111111-1111-4111-8111-111111111111'::uuid,
  'd2222222-2222-4222-8222-222222222222'::uuid,
  'd3333333-3333-4333-8333-333333333333'::uuid,
  'd4444444-4444-4444-8444-444444444444'::uuid
);

delete from public.categories where id in (
  'a1111111-1111-4111-8111-111111111111'::uuid,
  'a2222222-2222-4222-8222-222222222222'::uuid
);
*/
