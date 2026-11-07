-- =============================================================================
-- Migration: 0009_fix_generate_recurring_transactions.sql
-- Description: Fix pg_catalog.trim function call in public.generate_recurring_transactions
--              by replacing it with pg_catalog.btrim.
-- =============================================================================

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
      v_frequency := pg_catalog.lower(pg_catalog.btrim(v_rule.frequency));
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
-- Security Hardening: Re-apply REVOKE EXECUTE privileges
-- =============================================================================
revoke execute on function public.generate_recurring_transactions(integer) from public;
revoke execute on function public.generate_recurring_transactions(integer) from anon;
revoke execute on function public.generate_recurring_transactions(integer) from authenticated;

-- Note: The cron schedule ('generate-recurring-transactions-hourly', '0 * * * *')
-- defined in 0008_generate_recurring_transactions.sql remains unchanged.
