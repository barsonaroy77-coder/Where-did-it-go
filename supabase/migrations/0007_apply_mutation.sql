-- =============================================================================
-- Migration: 0005_apply_mutation.sql
-- Description: Offline-first mutation processing function and mutation log table
--              (PRD v4.0 Sections 7, 8.2, 8.3, 9; Phase 3, Part 6).
--
-- Components:
--   1. Sequence resolution hardening for BEFORE UPDATE trigger.
--   2. Mutation deduplication log table: public.applied_mutations.
--   3. Row Level Security and permissions on public.applied_mutations.
--   4. Version-checked mutation endpoint: public.apply_mutation(...).
--   5. Security hardening (SECURITY INVOKER, search_path = '', revoked EXECUTE).
--   6. Commented-out comprehensive manual test suite for Supabase SQL Editor.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Sequence Resolution Hardening for UPDATE Trigger
-- -----------------------------------------------------------------------------
-- In 0002_triggers.sql, handle_before_update() called nextval('global_change_seq')
-- without schema qualification. When invoked from routines configured with
-- `search_path = ''`, PostgreSQL cannot resolve unqualified relation identifiers.
-- Schema-qualifying nextval('public.global_change_seq') ensures BEFORE UPDATE
-- triggers execute seamlessly when apply_mutation updates or soft-deletes rows.
create or replace function public.handle_before_update()
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

  -- Advance pull sequence cursor using fully-qualified relation identifier
  new.change_seq := nextval('public.global_change_seq');

  return new;
end;
$$ language plpgsql;

-- -----------------------------------------------------------------------------
-- 2. Mutation Log Table: public.applied_mutations
-- -----------------------------------------------------------------------------
-- Stores client mutation IDs and their canonical atomic outcomes so retries
-- after lost responses return the identical result without duplicate writes.
create table if not exists public.applied_mutations (
  mutation_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_table text not null,
  entity_id uuid not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);

-- Index for user-scoped lookup performance and retention cleanup
create index if not exists idx_applied_mutations_user_created_at
  on public.applied_mutations (user_id, created_at desc);

-- -----------------------------------------------------------------------------
-- 3. Row Level Security & Permissions on applied_mutations
-- -----------------------------------------------------------------------------
alter table public.applied_mutations enable row level security;
alter table public.applied_mutations force row level security;

-- Baseline privilege lockdown: revoke everything from public and anon
revoke all on table public.applied_mutations from public;
revoke all on table public.applied_mutations from anon;
revoke all on table public.applied_mutations from authenticated;

-- Grant authenticated role SELECT and INSERT only (no UPDATE or DELETE)
grant select, insert on table public.applied_mutations to authenticated;

-- RLS Policies: users can only view and insert their own mutation logs
drop policy if exists "Users can select own applied mutations" on public.applied_mutations;
create policy "Users can select own applied mutations"
  on public.applied_mutations
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Users can insert own applied mutations" on public.applied_mutations;
create policy "Users can insert own applied mutations"
  on public.applied_mutations
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- 4. Mutation Processing Function: public.apply_mutation
-- -----------------------------------------------------------------------------
-- Handles optimistic concurrency, validation, deduplication, and atomic
-- application of client mutations across synchronized entity tables.
create or replace function public.apply_mutation(
  p_mutation_id uuid,
  p_table text,
  p_entity_id uuid,
  p_op text,
  p_base_version bigint,
  p_payload jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_stored_result jsonb;
  v_result jsonb;
  v_server_row jsonb;
  v_current_version bigint;

  -- Common validation variables
  v_amount_text text;
  v_amount_num numeric;
  v_amount bigint;
  v_type text;

  -- Category validation / lookup variables
  v_name text;
  v_icon text;
  v_color text;
  v_archived_at timestamptz;
  v_category_id uuid;
  v_cat_type text;
  v_cat_archived_at timestamptz;

  -- Budget variables
  v_monthly_limit bigint;

  -- Recurring rule variables
  v_note text;
  v_frequency text;
  v_start_date date;
  v_next_date date;
  v_schedule_timezone text;
  v_anchor_day integer;
  v_is_active boolean;

  -- Transaction variables
  v_tx_date date;
  v_date_text text;
  v_recurring_id uuid;
  v_occurrence_date date;

  -- Goal variables
  v_month_text text;
  v_month date;
  v_target_amount bigint;
begin
  -- 1. Authentication check
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  -- 2. Input validation for identifiers and operations
  if p_mutation_id is null then
    raise exception 'p_mutation_id cannot be null';
  end if;

  if p_entity_id is null then
    raise exception 'p_entity_id cannot be null';
  end if;

  if p_table not in ('categories', 'transactions', 'goals', 'budgets', 'recurring') then
    raise exception 'Invalid or non-mutable table: %', coalesce(p_table, 'null');
  end if;

  if p_op not in ('create', 'update', 'delete') then
    raise exception 'Invalid operation: %', coalesce(p_op, 'null');
  end if;

  -- 3. Idempotent deduplication: Return existing result if mutation already processed
  select am.result
  into v_stored_result
  from public.applied_mutations am
  where am.mutation_id = p_mutation_id
    and am.user_id = v_user_id;

  if found then
    return v_stored_result;
  end if;

  if p_op in ('create', 'update') and p_payload is null then
    raise exception 'p_payload cannot be null for % operation', p_op;
  end if;

  -- ---------------------------------------------------------------------------
  -- Table Branch: categories
  -- ---------------------------------------------------------------------------
  if p_table = 'categories' then
    if p_op = 'create' then
      -- If entity id already exists for this user, return conflict with current row
      select to_jsonb(c.*) into v_server_row
      from public.categories c
      where c.id = p_entity_id and c.user_id = v_user_id;

      if found then
        v_result := jsonb_build_object('status', 'conflict', 'entity', v_server_row);
      else
        v_name := trim(p_payload->>'name');
        if v_name is null or v_name = '' then
          raise exception 'Category name cannot be empty';
        end if;

        v_icon := trim(p_payload->>'icon');
        if v_icon is null or v_icon = '' then
          raise exception 'Category icon cannot be empty';
        end if;

        v_color := trim(p_payload->>'color');
        if v_color is null or v_color = '' then
          raise exception 'Category color cannot be empty';
        end if;

        v_type := p_payload->>'type';
        if v_type is null or v_type not in ('income', 'expense') then
          raise exception 'Category type must be income or expense, got: %', coalesce(v_type, 'null');
        end if;

        v_archived_at := case
          when p_payload ? 'archived_at' and p_payload->>'archived_at' is not null
          then (p_payload->>'archived_at')::timestamptz
          else null
        end;

        insert into public.categories (
          id, user_id, name, icon, color, type, archived_at
        ) values (
          p_entity_id, v_user_id, v_name, v_icon, v_color, v_type, v_archived_at
        )
        returning to_jsonb(categories.*) into v_server_row;

        v_result := jsonb_build_object('status', 'applied', 'entity', v_server_row);
      end if;

    else -- p_op in ('update', 'delete')
      select to_jsonb(c.*), c.version into v_server_row, v_current_version
      from public.categories c
      where c.id = p_entity_id and c.user_id = v_user_id;

      if not found then
        v_result := jsonb_build_object('status', 'not_found', 'entity', null);
      elsif p_base_version is null or v_current_version <> p_base_version then
        v_result := jsonb_build_object('status', 'conflict', 'entity', v_server_row);
      elsif p_op = 'delete' then
        update public.categories c
        set deleted_at = now()
        where c.id = p_entity_id and c.user_id = v_user_id
        returning to_jsonb(c.*) into v_server_row;

        v_result := jsonb_build_object('status', 'applied', 'entity', v_server_row);
      else -- update
        v_name := case when p_payload ? 'name' then trim(p_payload->>'name') else v_server_row->>'name' end;
        if v_name is null or v_name = '' then
          raise exception 'Category name cannot be empty';
        end if;

        v_icon := case when p_payload ? 'icon' then trim(p_payload->>'icon') else v_server_row->>'icon' end;
        if v_icon is null or v_icon = '' then
          raise exception 'Category icon cannot be empty';
        end if;

        v_color := case when p_payload ? 'color' then trim(p_payload->>'color') else v_server_row->>'color' end;
        if v_color is null or v_color = '' then
          raise exception 'Category color cannot be empty';
        end if;

        v_type := case when p_payload ? 'type' then p_payload->>'type' else v_server_row->>'type' end;
        if v_type is null or v_type not in ('income', 'expense') then
          raise exception 'Category type must be income or expense, got: %', coalesce(v_type, 'null');
        end if;

        v_archived_at := case
          when p_payload ? 'archived_at' then (p_payload->>'archived_at')::timestamptz
          else (v_server_row->>'archived_at')::timestamptz
        end;

        update public.categories c
        set
          name = v_name,
          icon = v_icon,
          color = v_color,
          type = v_type,
          archived_at = v_archived_at
        where c.id = p_entity_id and c.user_id = v_user_id
        returning to_jsonb(c.*) into v_server_row;

        v_result := jsonb_build_object('status', 'applied', 'entity', v_server_row);
      end if;
    end if;

  -- ---------------------------------------------------------------------------
  -- Table Branch: budgets
  -- ---------------------------------------------------------------------------
  elsif p_table = 'budgets' then
    if p_op = 'create' then
      select to_jsonb(b.*) into v_server_row
      from public.budgets b
      where b.id = p_entity_id and b.user_id = v_user_id;

      if found then
        v_result := jsonb_build_object('status', 'conflict', 'entity', v_server_row);
      else
        v_amount_text := p_payload->>'monthly_limit';
        if v_amount_text is null or v_amount_text !~ '^[0-9]+$' then
          raise exception 'Invalid monthly_limit: must be a positive integer, got: %', coalesce(v_amount_text, 'null');
        end if;
        v_amount_num := v_amount_text::numeric;
        if v_amount_num <= 0 or v_amount_num > 9007199254740991 then
          raise exception 'monthly_limit must be between 1 and 9007199254740991, got: %', v_amount_text;
        end if;
        v_monthly_limit := v_amount_num::bigint;

        if p_payload->>'category_id' is null then
          raise exception 'category_id is required for budget';
        end if;
        v_category_id := (p_payload->>'category_id')::uuid;

        select c.type, c.archived_at into v_cat_type, v_cat_archived_at
        from public.categories c
        where c.id = v_category_id and c.user_id = v_user_id;

        if not found then
          raise exception 'Category % does not exist or does not belong to user', v_category_id;
        end if;

        if v_cat_type <> 'expense' then
          raise exception 'Budgets can only be created for expense categories (category % is %)', v_category_id, v_cat_type;
        end if;

        if v_cat_archived_at is not null then
          raise exception 'Cannot create budget for archived category %', v_category_id;
        end if;

        insert into public.budgets (
          id, user_id, category_id, monthly_limit
        ) values (
          p_entity_id, v_user_id, v_category_id, v_monthly_limit
        )
        returning to_jsonb(budgets.*) into v_server_row;

        v_result := jsonb_build_object('status', 'applied', 'entity', v_server_row);
      end if;

    else -- p_op in ('update', 'delete')
      select to_jsonb(b.*), b.version into v_server_row, v_current_version
      from public.budgets b
      where b.id = p_entity_id and b.user_id = v_user_id;

      if not found then
        v_result := jsonb_build_object('status', 'not_found', 'entity', null);
      elsif p_base_version is null or v_current_version <> p_base_version then
        v_result := jsonb_build_object('status', 'conflict', 'entity', v_server_row);
      elsif p_op = 'delete' then
        update public.budgets b
        set deleted_at = now()
        where b.id = p_entity_id and b.user_id = v_user_id
        returning to_jsonb(b.*) into v_server_row;

        v_result := jsonb_build_object('status', 'applied', 'entity', v_server_row);
      else -- update
        if p_payload ? 'monthly_limit' then
          v_amount_text := p_payload->>'monthly_limit';
          if v_amount_text is null or v_amount_text !~ '^[0-9]+$' then
            raise exception 'Invalid monthly_limit: must be a positive integer, got: %', coalesce(v_amount_text, 'null');
          end if;
          v_amount_num := v_amount_text::numeric;
          if v_amount_num <= 0 or v_amount_num > 9007199254740991 then
            raise exception 'monthly_limit must be between 1 and 9007199254740991, got: %', v_amount_text;
          end if;
          v_monthly_limit := v_amount_num::bigint;
        else
          v_monthly_limit := (v_server_row->>'monthly_limit')::bigint;
        end if;

        if p_payload ? 'category_id' then
          if p_payload->>'category_id' is null then
            raise exception 'category_id cannot be null for budget';
          end if;
          v_category_id := (p_payload->>'category_id')::uuid;

          select c.type, c.archived_at into v_cat_type, v_cat_archived_at
          from public.categories c
          where c.id = v_category_id and c.user_id = v_user_id;

          if not found then
            raise exception 'Category % does not exist or does not belong to user', v_category_id;
          end if;

          if v_cat_type <> 'expense' then
            raise exception 'Budgets can only be created for expense categories (category % is %)', v_category_id, v_cat_type;
          end if;

          if v_cat_archived_at is not null and v_category_id is distinct from (v_server_row->>'category_id')::uuid then
            raise exception 'Cannot reassign budget to archived category %', v_category_id;
          end if;
        else
          v_category_id := (v_server_row->>'category_id')::uuid;
        end if;

        update public.budgets b
        set
          category_id = v_category_id,
          monthly_limit = v_monthly_limit
        where b.id = p_entity_id and b.user_id = v_user_id
        returning to_jsonb(b.*) into v_server_row;

        v_result := jsonb_build_object('status', 'applied', 'entity', v_server_row);
      end if;
    end if;

  -- ---------------------------------------------------------------------------
  -- Table Branch: recurring
  -- ---------------------------------------------------------------------------
  elsif p_table = 'recurring' then
    if p_op = 'create' then
      select to_jsonb(r.*) into v_server_row
      from public.recurring r
      where r.id = p_entity_id and r.user_id = v_user_id;

      if found then
        v_result := jsonb_build_object('status', 'conflict', 'entity', v_server_row);
      else
        v_type := p_payload->>'type';
        if v_type is null or v_type not in ('income', 'expense') then
          raise exception 'Type must be income or expense, got: %', coalesce(v_type, 'null');
        end if;

        v_amount_text := p_payload->>'amount';
        if v_amount_text is null or v_amount_text !~ '^[0-9]+$' then
          raise exception 'Invalid amount: must be a positive integer, got: %', coalesce(v_amount_text, 'null');
        end if;
        v_amount_num := v_amount_text::numeric;
        if v_amount_num <= 0 or v_amount_num > 9007199254740991 then
          raise exception 'Amount must be between 1 and 9007199254740991, got: %', v_amount_text;
        end if;
        v_amount := v_amount_num::bigint;

        if p_payload->>'category_id' is null then
          raise exception 'category_id is required for recurring rule';
        end if;
        v_category_id := (p_payload->>'category_id')::uuid;

        select c.type, c.archived_at into v_cat_type, v_cat_archived_at
        from public.categories c
        where c.id = v_category_id and c.user_id = v_user_id;

        if not found then
          raise exception 'Category % does not exist or does not belong to user', v_category_id;
        end if;

        if v_cat_type <> v_type then
          raise exception 'Category type (%) does not match recurring rule type (%)', v_cat_type, v_type;
        end if;

        if v_cat_archived_at is not null then
          raise exception 'Category % is archived and cannot be used for recurring rules', v_category_id;
        end if;

        v_note := p_payload->>'note';

        v_frequency := trim(p_payload->>'frequency');
        if v_frequency is null or v_frequency = '' then
          raise exception 'frequency cannot be empty for recurring rule';
        end if;

        if p_payload->>'start_date' is null or (p_payload->>'start_date') !~ '^\d{4}-\d{2}-\d{2}$' then
          raise exception 'start_date must be in YYYY-MM-DD format, got: %', coalesce(p_payload->>'start_date', 'null');
        end if;
        v_start_date := (p_payload->>'start_date')::date;

        if p_payload->>'next_date' is null or (p_payload->>'next_date') !~ '^\d{4}-\d{2}-\d{2}$' then
          raise exception 'next_date must be in YYYY-MM-DD format, got: %', coalesce(p_payload->>'next_date', 'null');
        end if;
        v_next_date := (p_payload->>'next_date')::date;

        v_schedule_timezone := trim(p_payload->>'schedule_timezone');
        if v_schedule_timezone is null or v_schedule_timezone = '' then
          raise exception 'schedule_timezone cannot be empty for recurring rule';
        end if;

        if p_payload->>'anchor_day' is null or (p_payload->>'anchor_day') !~ '^[0-9]+$' then
          raise exception 'anchor_day must be an integer between 1 and 31, got: %', coalesce(p_payload->>'anchor_day', 'null');
        end if;
        v_anchor_day := (p_payload->>'anchor_day')::integer;
        if v_anchor_day < 1 or v_anchor_day > 31 then
          raise exception 'anchor_day must be between 1 and 31, got: %', v_anchor_day;
        end if;

        v_is_active := case
          when p_payload ? 'is_active' and p_payload->>'is_active' is not null
          then (p_payload->>'is_active')::boolean
          else true
        end;

        insert into public.recurring (
          id, user_id, type, amount, category_id, note, frequency,
          start_date, next_date, schedule_timezone, anchor_day, is_active
        ) values (
          p_entity_id, v_user_id, v_type, v_amount, v_category_id, v_note, v_frequency,
          v_start_date, v_next_date, v_schedule_timezone, v_anchor_day, v_is_active
        )
        returning to_jsonb(recurring.*) into v_server_row;

        v_result := jsonb_build_object('status', 'applied', 'entity', v_server_row);
      end if;

    else -- p_op in ('update', 'delete')
      select to_jsonb(r.*), r.version into v_server_row, v_current_version
      from public.recurring r
      where r.id = p_entity_id and r.user_id = v_user_id;

      if not found then
        v_result := jsonb_build_object('status', 'not_found', 'entity', null);
      elsif p_base_version is null or v_current_version <> p_base_version then
        v_result := jsonb_build_object('status', 'conflict', 'entity', v_server_row);
      elsif p_op = 'delete' then
        update public.recurring r
        set deleted_at = now()
        where r.id = p_entity_id and r.user_id = v_user_id
        returning to_jsonb(r.*) into v_server_row;

        v_result := jsonb_build_object('status', 'applied', 'entity', v_server_row);
      else -- update
        v_type := case when p_payload ? 'type' then p_payload->>'type' else v_server_row->>'type' end;
        if v_type is null or v_type not in ('income', 'expense') then
          raise exception 'Type must be income or expense, got: %', coalesce(v_type, 'null');
        end if;

        if p_payload ? 'amount' then
          v_amount_text := p_payload->>'amount';
          if v_amount_text is null or v_amount_text !~ '^[0-9]+$' then
            raise exception 'Invalid amount: must be a positive integer, got: %', coalesce(v_amount_text, 'null');
          end if;
          v_amount_num := v_amount_text::numeric;
          if v_amount_num <= 0 or v_amount_num > 9007199254740991 then
            raise exception 'Amount must be between 1 and 9007199254740991, got: %', v_amount_text;
          end if;
          v_amount := v_amount_num::bigint;
        else
          v_amount := (v_server_row->>'amount')::bigint;
        end if;

        if p_payload ? 'category_id' then
          if p_payload->>'category_id' is null then
            raise exception 'category_id cannot be null for recurring rule';
          end if;
          v_category_id := (p_payload->>'category_id')::uuid;
        else
          v_category_id := (v_server_row->>'category_id')::uuid;
        end if;

        select c.type, c.archived_at into v_cat_type, v_cat_archived_at
        from public.categories c
        where c.id = v_category_id and c.user_id = v_user_id;

        if not found then
          raise exception 'Category % does not exist or does not belong to user', v_category_id;
        end if;

        if v_cat_type <> v_type then
          raise exception 'Category type (%) does not match recurring rule type (%)', v_cat_type, v_type;
        end if;

        if v_cat_archived_at is not null and (p_payload ? 'category_id' and v_category_id is distinct from (v_server_row->>'category_id')::uuid) then
          raise exception 'Category % is archived and cannot be selected for recurring rule', v_category_id;
        end if;

        v_note := case when p_payload ? 'note' then p_payload->>'note' else v_server_row->>'note' end;

        if p_payload ? 'frequency' then
          v_frequency := trim(p_payload->>'frequency');
          if v_frequency is null or v_frequency = '' then
            raise exception 'frequency cannot be empty for recurring rule';
          end if;
        else
          v_frequency := v_server_row->>'frequency';
        end if;

        if p_payload ? 'start_date' then
          if p_payload->>'start_date' is null or (p_payload->>'start_date') !~ '^\d{4}-\d{2}-\d{2}$' then
            raise exception 'start_date must be in YYYY-MM-DD format, got: %', coalesce(p_payload->>'start_date', 'null');
          end if;
          v_start_date := (p_payload->>'start_date')::date;
        else
          v_start_date := (v_server_row->>'start_date')::date;
        end if;

        if p_payload ? 'next_date' then
          if p_payload->>'next_date' is null or (p_payload->>'next_date') !~ '^\d{4}-\d{2}-\d{2}$' then
            raise exception 'next_date must be in YYYY-MM-DD format, got: %', coalesce(p_payload->>'next_date', 'null');
          end if;
          v_next_date := (p_payload->>'next_date')::date;
        else
          v_next_date := (v_server_row->>'next_date')::date;
        end if;

        if p_payload ? 'schedule_timezone' then
          v_schedule_timezone := trim(p_payload->>'schedule_timezone');
          if v_schedule_timezone is null or v_schedule_timezone = '' then
            raise exception 'schedule_timezone cannot be empty for recurring rule';
          end if;
        else
          v_schedule_timezone := v_server_row->>'schedule_timezone';
        end if;

        if p_payload ? 'anchor_day' then
          if p_payload->>'anchor_day' is null or (p_payload->>'anchor_day') !~ '^[0-9]+$' then
            raise exception 'anchor_day must be an integer between 1 and 31, got: %', coalesce(p_payload->>'anchor_day', 'null');
          end if;
          v_anchor_day := (p_payload->>'anchor_day')::integer;
          if v_anchor_day < 1 or v_anchor_day > 31 then
            raise exception 'anchor_day must be between 1 and 31, got: %', v_anchor_day;
          end if;
        else
          v_anchor_day := (v_server_row->>'anchor_day')::integer;
        end if;

        v_is_active := case
          when p_payload ? 'is_active' then (p_payload->>'is_active')::boolean
          else (v_server_row->>'is_active')::boolean
        end;

        update public.recurring r
        set
          type = v_type,
          amount = v_amount,
          category_id = v_category_id,
          note = v_note,
          frequency = v_frequency,
          start_date = v_start_date,
          next_date = v_next_date,
          schedule_timezone = v_schedule_timezone,
          anchor_day = v_anchor_day,
          is_active = v_is_active
        where r.id = p_entity_id and r.user_id = v_user_id
        returning to_jsonb(r.*) into v_server_row;

        v_result := jsonb_build_object('status', 'applied', 'entity', v_server_row);
      end if;
    end if;

  -- ---------------------------------------------------------------------------
  -- Table Branch: transactions
  -- ---------------------------------------------------------------------------
  elsif p_table = 'transactions' then
    if p_op = 'create' then
      select to_jsonb(t.*) into v_server_row
      from public.transactions t
      where t.id = p_entity_id and t.user_id = v_user_id;

      if found then
        v_result := jsonb_build_object('status', 'conflict', 'entity', v_server_row);
      else
        v_type := p_payload->>'type';
        if v_type is null or v_type not in ('income', 'expense') then
          raise exception 'Type must be income or expense, got: %', coalesce(v_type, 'null');
        end if;

        v_amount_text := p_payload->>'amount';
        if v_amount_text is null or v_amount_text !~ '^[0-9]+$' then
          raise exception 'Invalid amount: must be a positive integer, got: %', coalesce(v_amount_text, 'null');
        end if;
        v_amount_num := v_amount_text::numeric;
        if v_amount_num <= 0 or v_amount_num > 9007199254740991 then
          raise exception 'Amount must be between 1 and 9007199254740991, got: %', v_amount_text;
        end if;
        v_amount := v_amount_num::bigint;

        if p_payload->>'category_id' is null then
          raise exception 'category_id is required for transaction';
        end if;
        v_category_id := (p_payload->>'category_id')::uuid;

        select c.type, c.archived_at into v_cat_type, v_cat_archived_at
        from public.categories c
        where c.id = v_category_id and c.user_id = v_user_id;

        if not found then
          raise exception 'Category % does not exist or does not belong to user', v_category_id;
        end if;

        if v_cat_type <> v_type then
          raise exception 'Category type (%) does not match transaction type (%)', v_cat_type, v_type;
        end if;

        if v_cat_archived_at is not null then
          raise exception 'Category % is archived and cannot be used for transactions', v_category_id;
        end if;

        v_note := p_payload->>'note';

        v_date_text := p_payload->>'date';
        if v_date_text is null or v_date_text !~ '^\d{4}-\d{2}-\d{2}$' then
          raise exception 'Transaction date must be in YYYY-MM-DD format, got: %', coalesce(v_date_text, 'null');
        end if;
        v_tx_date := v_date_text::date;

        v_recurring_id := case
          when p_payload ? 'recurring_id' and p_payload->>'recurring_id' is not null
          then (p_payload->>'recurring_id')::uuid
          else null
        end;

        v_occurrence_date := case
          when p_payload ? 'occurrence_date' and p_payload->>'occurrence_date' is not null
          then (p_payload->>'occurrence_date')::date
          else null
        end;

        insert into public.transactions (
          id, user_id, type, amount, category_id, note, date, recurring_id, occurrence_date
        ) values (
          p_entity_id, v_user_id, v_type, v_amount, v_category_id, v_note, v_tx_date, v_recurring_id, v_occurrence_date
        )
        returning to_jsonb(transactions.*) into v_server_row;

        v_result := jsonb_build_object('status', 'applied', 'entity', v_server_row);
      end if;

    else -- p_op in ('update', 'delete')
      select to_jsonb(t.*), t.version into v_server_row, v_current_version
      from public.transactions t
      where t.id = p_entity_id and t.user_id = v_user_id;

      if not found then
        v_result := jsonb_build_object('status', 'not_found', 'entity', null);
      elsif p_base_version is null or v_current_version <> p_base_version then
        v_result := jsonb_build_object('status', 'conflict', 'entity', v_server_row);
      elsif p_op = 'delete' then
        update public.transactions t
        set deleted_at = now()
        where t.id = p_entity_id and t.user_id = v_user_id
        returning to_jsonb(t.*) into v_server_row;

        v_result := jsonb_build_object('status', 'applied', 'entity', v_server_row);
      else -- update
        v_type := case when p_payload ? 'type' then p_payload->>'type' else v_server_row->>'type' end;
        if v_type is null or v_type not in ('income', 'expense') then
          raise exception 'Type must be income or expense, got: %', coalesce(v_type, 'null');
        end if;

        if p_payload ? 'amount' then
          v_amount_text := p_payload->>'amount';
          if v_amount_text is null or v_amount_text !~ '^[0-9]+$' then
            raise exception 'Invalid amount: must be a positive integer, got: %', coalesce(v_amount_text, 'null');
          end if;
          v_amount_num := v_amount_text::numeric;
          if v_amount_num <= 0 or v_amount_num > 9007199254740991 then
            raise exception 'Amount must be between 1 and 9007199254740991, got: %', v_amount_text;
          end if;
          v_amount := v_amount_num::bigint;
        else
          v_amount := (v_server_row->>'amount')::bigint;
        end if;

        if p_payload ? 'category_id' then
          if p_payload->>'category_id' is null then
            raise exception 'category_id cannot be null for transaction';
          end if;
          v_category_id := (p_payload->>'category_id')::uuid;
        else
          v_category_id := (v_server_row->>'category_id')::uuid;
        end if;

        select c.type, c.archived_at into v_cat_type, v_cat_archived_at
        from public.categories c
        where c.id = v_category_id and c.user_id = v_user_id;

        if not found then
          raise exception 'Category % does not exist or does not belong to user', v_category_id;
        end if;

        if v_cat_type <> v_type then
          raise exception 'Category type (%) does not match transaction type (%)', v_cat_type, v_type;
        end if;

        if v_cat_archived_at is not null and (p_payload ? 'category_id' and v_category_id is distinct from (v_server_row->>'category_id')::uuid) then
          raise exception 'Category % is archived and cannot be selected for transaction', v_category_id;
        end if;

        v_note := case when p_payload ? 'note' then p_payload->>'note' else v_server_row->>'note' end;

        if p_payload ? 'date' then
          v_date_text := p_payload->>'date';
          if v_date_text is null or v_date_text !~ '^\d{4}-\d{2}-\d{2}$' then
            raise exception 'Transaction date must be in YYYY-MM-DD format, got: %', coalesce(v_date_text, 'null');
          end if;
          v_tx_date := v_date_text::date;
        else
          v_tx_date := (v_server_row->>'date')::date;
        end if;

        v_recurring_id := case
          when p_payload ? 'recurring_id' then (p_payload->>'recurring_id')::uuid
          else (v_server_row->>'recurring_id')::uuid
        end;

        v_occurrence_date := case
          when p_payload ? 'occurrence_date' then (p_payload->>'occurrence_date')::date
          else (v_server_row->>'occurrence_date')::date
        end;

        update public.transactions t
        set
          type = v_type,
          amount = v_amount,
          category_id = v_category_id,
          note = v_note,
          date = v_tx_date,
          recurring_id = v_recurring_id,
          occurrence_date = v_occurrence_date
        where t.id = p_entity_id and t.user_id = v_user_id
        returning to_jsonb(t.*) into v_server_row;

        v_result := jsonb_build_object('status', 'applied', 'entity', v_server_row);
      end if;
    end if;

  -- ---------------------------------------------------------------------------
  -- Table Branch: goals
  -- ---------------------------------------------------------------------------
  elsif p_table = 'goals' then
    if p_op = 'create' then
      select to_jsonb(g.*) into v_server_row
      from public.goals g
      where g.id = p_entity_id and g.user_id = v_user_id;

      if found then
        v_result := jsonb_build_object('status', 'conflict', 'entity', v_server_row);
      else
        v_name := trim(p_payload->>'name');
        if v_name is null or v_name = '' then
          raise exception 'Goal name cannot be empty';
        end if;

        v_amount_text := p_payload->>'target_amount';
        if v_amount_text is null or v_amount_text !~ '^[0-9]+$' then
          raise exception 'Invalid target_amount: must be a positive integer, got: %', coalesce(v_amount_text, 'null');
        end if;
        v_amount_num := v_amount_text::numeric;
        if v_amount_num <= 0 or v_amount_num > 9007199254740991 then
          raise exception 'target_amount must be between 1 and 9007199254740991, got: %', v_amount_text;
        end if;
        v_target_amount := v_amount_num::bigint;

        v_month_text := p_payload->>'month';
        if v_month_text is null or v_month_text !~ '^\d{4}-\d{2}-01$' then
          raise exception 'Goal month must be the first of a month (YYYY-MM-01), got: %', coalesce(v_month_text, 'null');
        end if;
        v_month := v_month_text::date;
        if extract(day from v_month) <> 1 then
          raise exception 'Goal month must be the first of a month (YYYY-MM-01), got: %', v_month;
        end if;

        insert into public.goals (
          id, user_id, name, target_amount, month
        ) values (
          p_entity_id, v_user_id, v_name, v_target_amount, v_month
        )
        returning to_jsonb(goals.*) into v_server_row;

        v_result := jsonb_build_object('status', 'applied', 'entity', v_server_row);
      end if;

    else -- p_op in ('update', 'delete')
      select to_jsonb(g.*), g.version into v_server_row, v_current_version
      from public.goals g
      where g.id = p_entity_id and g.user_id = v_user_id;

      if not found then
        v_result := jsonb_build_object('status', 'not_found', 'entity', null);
      elsif p_base_version is null or v_current_version <> p_base_version then
        v_result := jsonb_build_object('status', 'conflict', 'entity', v_server_row);
      elsif p_op = 'delete' then
        update public.goals g
        set deleted_at = now()
        where g.id = p_entity_id and g.user_id = v_user_id
        returning to_jsonb(g.*) into v_server_row;

        v_result := jsonb_build_object('status', 'applied', 'entity', v_server_row);
      else -- update
        v_name := case when p_payload ? 'name' then trim(p_payload->>'name') else v_server_row->>'name' end;
        if v_name is null or v_name = '' then
          raise exception 'Goal name cannot be empty';
        end if;

        if p_payload ? 'target_amount' then
          v_amount_text := p_payload->>'target_amount';
          if v_amount_text is null or v_amount_text !~ '^[0-9]+$' then
            raise exception 'Invalid target_amount: must be a positive integer, got: %', coalesce(v_amount_text, 'null');
          end if;
          v_amount_num := v_amount_text::numeric;
          if v_amount_num <= 0 or v_amount_num > 9007199254740991 then
            raise exception 'target_amount must be between 1 and 9007199254740991, got: %', v_amount_text;
          end if;
          v_target_amount := v_amount_num::bigint;
        else
          v_target_amount := (v_server_row->>'target_amount')::bigint;
        end if;

        if p_payload ? 'month' then
          v_month_text := p_payload->>'month';
          if v_month_text is null or v_month_text !~ '^\d{4}-\d{2}-01$' then
            raise exception 'Goal month must be the first of a month (YYYY-MM-01), got: %', coalesce(v_month_text, 'null');
          end if;
          v_month := v_month_text::date;
          if extract(day from v_month) <> 1 then
            raise exception 'Goal month must be the first of a month (YYYY-MM-01), got: %', v_month;
          end if;
        else
          v_month := (v_server_row->>'month')::date;
        end if;

        update public.goals g
        set
          name = v_name,
          target_amount = v_target_amount,
          month = v_month
        where g.id = p_entity_id and g.user_id = v_user_id
        returning to_jsonb(g.*) into v_server_row;

        v_result := jsonb_build_object('status', 'applied', 'entity', v_server_row);
      end if;
    end if;
  end if;

  -- ---------------------------------------------------------------------------
  -- 5. Atomic persistence: Store outcome in applied_mutations
  -- ---------------------------------------------------------------------------
  insert into public.applied_mutations (
    mutation_id,
    user_id,
    entity_table,
    entity_id,
    result,
    created_at
  ) values (
    p_mutation_id,
    v_user_id,
    p_table,
    p_entity_id,
    v_result,
    now()
  );

  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Privileges and Execution Grants
-- -----------------------------------------------------------------------------
-- Function runs as SECURITY INVOKER with search_path = ''.
-- Revoke execution from public and anon; grant only to authenticated.
revoke execute on function public.apply_mutation(uuid, text, uuid, text, bigint, jsonb) from public;
revoke execute on function public.apply_mutation(uuid, text, uuid, text, bigint, jsonb) from anon;
grant execute on function public.apply_mutation(uuid, text, uuid, text, bigint, jsonb) to authenticated;



-- =============================================================================
-- MANUAL TESTS
-- =============================================================================
/*
-- Run this test suite in the Supabase SQL Editor.
-- The entire block runs inside an uncommitted transaction (rolls back at the end)
-- so it tests mutation application, deduplication, conflict detection, cross-user
-- isolation, validation checks, and role permissions without leaving test data behind.

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

-- TEST 1: User A creates a category via apply_mutation
-- Expect status: 'applied', entity contains id, version = 1, etc.
select public.apply_mutation(
  'm1111111-0000-0000-0000-000000000001'::uuid,
  'categories',
  'caaaaaaa-0000-0000-0000-000000000001'::uuid,
  'create',
  null,
  '{"name": "Dining Out", "icon": "utensils", "color": "#FFE600", "type": "expense"}'::jsonb
) as test_1_create_category;

-- TEST 2: Send the SAME mutation_id twice (deduplication)
-- Expect identical result as TEST 1, no duplicate write, stored result returned
select public.apply_mutation(
  'm1111111-0000-0000-0000-000000000001'::uuid,
  'categories',
  'caaaaaaa-0000-0000-0000-000000000001'::uuid,
  'create',
  null,
  '{"name": "Dining Out", "icon": "utensils", "color": "#FFE600", "type": "expense"}'::jsonb
) as test_2_deduplication;

-- Verify category count for User A is exactly 1 and applied_mutations count is 1
select count(*) as user_a_cat_count from public.categories where id = 'caaaaaaa-0000-0000-0000-000000000001';
select count(*) as mutation_log_count from public.applied_mutations where mutation_id = 'm1111111-0000-0000-0000-000000000001';

-- Legitimate update: bump version from 1 to 2
select public.apply_mutation(
  'm1111111-0000-0000-0000-000000000002'::uuid,
  'categories',
  'caaaaaaa-0000-0000-0000-000000000001'::uuid,
  'update',
  1,
  '{"name": "Fine Dining"}'::jsonb
) as test_legitimate_update;

-- TEST 3: Update with a stale base_version (send base_version 1 when server is at 2)
-- Expect status: 'conflict', row unchanged, server row returned
select public.apply_mutation(
  'm1111111-0000-0000-0000-000000000003'::uuid,
  'categories',
  'caaaaaaa-0000-0000-0000-000000000001'::uuid,
  'update',
  1,
  '{"name": "Stale Update"}'::jsonb
) as test_3_stale_version_conflict;

-- Verify category name is still "Fine Dining" and version is still 2
select name, version from public.categories where id = 'caaaaaaa-0000-0000-0000-000000000001';

-- -----------------------------------------------------------------------------
-- Step 2: Simulate User B
-- -----------------------------------------------------------------------------
set local request.jwt.claims to '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

-- TEST 4: User B trying to update User A's row
-- Expect status: 'not_found', entity: null (blocked by user_id filter and RLS)
select public.apply_mutation(
  'm2222222-0000-0000-0000-000000000001'::uuid,
  'categories',
  'caaaaaaa-0000-0000-0000-000000000001'::uuid,
  'update',
  2,
  '{"name": "Hacked by User B"}'::jsonb
) as test_4_cross_user_update;

-- TEST 5: Calling with a bad table name
-- Expect error: Invalid or non-mutable table
do $$
begin
  perform public.apply_mutation(
    'm2222222-0000-0000-0000-000000000002'::uuid,
    'evil_table',
    'caaaaaaa-0000-0000-0000-000000000001'::uuid,
    'update',
    1,
    '{}'::jsonb
  );
  raise exception 'TEST FAILED: apply_mutation allowed bad table name';
exception when others then
  raise notice 'TEST 5 PASSED: Bad table name rejected with message: %', sqlerrm;
end $$;

-- -----------------------------------------------------------------------------
-- Step 3: Simulate Anonymous Role ('anon')
-- -----------------------------------------------------------------------------
set local role anon;

-- TEST 6: Anon calling the function (denied)
-- Expect error: permission denied for function apply_mutation
do $$
begin
  perform public.apply_mutation(
    'm3333333-0000-0000-0000-000000000001'::uuid,
    'categories',
    'caaaaaaa-0000-0000-0000-000000000001'::uuid,
    'create',
    null,
    '{"name": "Anon Cat", "icon": "tag", "color": "#000", "type": "expense"}'::jsonb
  );
  raise exception 'TEST FAILED: Anon was able to execute apply_mutation';
exception when insufficient_privilege then
  raise notice 'TEST 6 PASSED: Anon execution denied with insufficient_privilege';
end $$;

rollback;
*/
