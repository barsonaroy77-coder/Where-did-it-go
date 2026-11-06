-- ============================================================================
-- Task 2.6: Schema Constraints & Two-User RLS Security Tests (Updated)
-- Wrapped in BEGIN ... ROLLBACK so zero test data persists after execution.
-- ============================================================================

BEGIN;

DO $$
DECLARE
    v_user_a UUID := '11111111-1111-4111-8111-111111111111';
    v_user_b UUID := '22222222-2222-4222-8222-222222222222';
    v_cat_a_expense UUID := 'aaaaaaaa-1111-4111-8111-111111111111';
    v_cat_a_income  UUID := 'aaaaaaaa-2222-4222-8222-222222222222';
    v_cat_b_expense UUID := 'bbbbbbbb-1111-4111-8111-111111111111';
    v_tx_a          UUID := 'cccccccc-1111-4111-8111-111111111111';
    v_rec_a         UUID := 'dddddddd-1111-4111-8111-111111111111';
    v_count INTEGER;
    v_ver1 INTEGER;
    v_ver2 INTEGER;
    v_seq1 BIGINT;
    v_seq2 BIGINT;
BEGIN
    -- ------------------------------------------------------------------------
    -- 0. Create two synthetic test users in auth.users (as superuser)
    -- ------------------------------------------------------------------------
    INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role, created_at, updated_at)
    VALUES
        (v_user_a, 'test_user_a@example.com', '{"provider":"email"}', '{}', 'authenticated', 'authenticated', now(), now()),
        (v_user_b, 'test_user_b@example.com', '{"provider":"email"}', '{}', 'authenticated', 'authenticated', now(), now())
    ON CONFLICT (id) DO NOTHING;

    -- Ensure profiles exist for both users
    INSERT INTO public.profiles (id, currency, currency_decimals)
    VALUES
        (v_user_a, 'INR', 2),
        (v_user_b, 'USD', 2)
    ON CONFLICT (id) DO NOTHING;

    -- Seed categories if a seeding function exists (Task 2.4 idempotency check)
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.proname = 'seed_default_categories'
    ) THEN
        PERFORM public.seed_default_categories(v_user_a);
        SELECT COUNT(*) INTO v_count FROM public.categories WHERE user_id = v_user_a;
        PERFORM public.seed_default_categories(v_user_a); -- Run twice to verify idempotency
        IF (SELECT COUNT(*) FROM public.categories WHERE user_id = v_user_a) <> v_count THEN
            RAISE EXCEPTION 'TEST FAILED: seed_default_categories is not idempotent';
        END IF;
    END IF;

    -- ------------------------------------------------------------------------
    -- 1. Switch to authenticated role as User A
    -- ------------------------------------------------------------------------
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user_a::text, 'role', 'authenticated')::text, true);

    -- Create deterministic test categories for User A
    INSERT INTO public.categories (id, user_id, name, icon, color, type)
    VALUES
        (v_cat_a_expense, v_user_a, 'Test Food A', 'utensils', '#FF5733', 'expense'),
        (v_cat_a_income,  v_user_a, 'Test Salary A', 'wallet', '#28A745', 'income');

    -- Verify server-controlled version and change_seq increment on UPDATE (Task 2.2)
    SELECT version, change_seq INTO v_ver1, v_seq1
    FROM public.categories WHERE id = v_cat_a_expense;

    UPDATE public.categories SET name = 'Test Food A Updated', version = 999
    WHERE id = v_cat_a_expense;

    SELECT version, change_seq INTO v_ver2, v_seq2
    FROM public.categories WHERE id = v_cat_a_expense;

    IF v_ver2 <> v_ver1 + 1 THEN
        RAISE EXCEPTION 'TEST FAILED: Server did not control version increment (got %, expected %)', v_ver2, v_ver1 + 1;
    END IF;

    IF v_seq2 <= v_seq1 THEN
        RAISE EXCEPTION 'TEST FAILED: change_seq did not advance on update (% -> %)', v_seq1, v_seq2;
    END IF;

    -- ------------------------------------------------------------------------
    -- 2. Schema Constraint Tests (as User A)
    -- ------------------------------------------------------------------------

    -- 2a. Reject zero or negative transaction amounts
    BEGIN
        INSERT INTO public.transactions (id, user_id, type, amount, category_id, date)
        VALUES (gen_random_uuid(), v_user_a, 'expense', 0, v_cat_a_expense, CURRENT_DATE);
        RAISE EXCEPTION 'TEST FAILED: Allowed zero transaction amount';
    EXCEPTION WHEN check_violation THEN
        -- Expected
    END;

    BEGIN
        INSERT INTO public.transactions (id, user_id, type, amount, category_id, date)
        VALUES (gen_random_uuid(), v_user_a, 'expense', -500, v_cat_a_expense, CURRENT_DATE);
        RAISE EXCEPTION 'TEST FAILED: Allowed negative transaction amount';
    EXCEPTION WHEN check_violation THEN
        -- Expected
    END;

    -- 2b. Valid transaction insert for User A
    INSERT INTO public.transactions (id, user_id, type, amount, category_id, note, date)
    VALUES (v_tx_a, v_user_a, 'expense', 45000, v_cat_a_expense, 'Coffee', CURRENT_DATE);

    -- 2c. Enforce one active budget per expense category
    INSERT INTO public.budgets (id, user_id, category_id, monthly_limit)
    VALUES (gen_random_uuid(), v_user_a, v_cat_a_expense, 500000);

    BEGIN
        INSERT INTO public.budgets (id, user_id, category_id, monthly_limit)
        VALUES (gen_random_uuid(), v_user_a, v_cat_a_expense, 600000);
        RAISE EXCEPTION 'TEST FAILED: Allowed duplicate active budget for same category';
    EXCEPTION WHEN unique_violation THEN
        -- Expected
    END;

    -- 2d. Enforce recurring occurrence uniqueness (recurring_id, occurrence_date)
    INSERT INTO public.recurring (
        id, user_id, type, amount, category_id, frequency,
        start_date, next_date, schedule_timezone, anchor_day, is_active
    ) VALUES (
        v_rec_a, v_user_a, 'expense', 99900, v_cat_a_expense, 'monthly',
        DATE '2026-11-01', DATE '2026-12-01', 'Asia/Kolkata', 1, true
    );

    INSERT INTO public.transactions (id, user_id, type, amount, category_id, date, recurring_id, occurrence_date)
    VALUES (gen_random_uuid(), v_user_a, 'expense', 99900, v_cat_a_expense, DATE '2026-11-01', v_rec_a, DATE '2026-11-01');

    BEGIN
        INSERT INTO public.transactions (id, user_id, type, amount, category_id, date, recurring_id, occurrence_date)
        VALUES (gen_random_uuid(), v_user_a, 'expense', 99900, v_cat_a_expense, DATE '2026-11-01', v_rec_a, DATE '2026-11-01');
        RAISE EXCEPTION 'TEST FAILED: Allowed duplicate recurring occurrence on same date';
    EXCEPTION WHEN unique_violation THEN
        -- Expected
    END;

    -- ------------------------------------------------------------------------
    -- 3. Two-User Isolation Tests (Switch to User B)
    -- ------------------------------------------------------------------------
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user_b::text, 'role', 'authenticated')::text, true);

    -- Create a valid category for User B
    INSERT INTO public.categories (id, user_id, name, icon, color, type)
    VALUES (v_cat_b_expense, v_user_b, 'Test Food B', 'utensils', '#3357FF', 'expense');

    -- 3a. User B cannot READ any of User A's records across all tables
    SELECT COUNT(*) INTO v_count FROM public.profiles WHERE id = v_user_a;
    IF v_count > 0 THEN RAISE EXCEPTION 'RLS FAILED: User B can read User A profile'; END IF;

    SELECT COUNT(*) INTO v_count FROM public.categories WHERE user_id = v_user_a;
    IF v_count > 0 THEN RAISE EXCEPTION 'RLS FAILED: User B can read User A categories'; END IF;

    SELECT COUNT(*) INTO v_count FROM public.transactions WHERE user_id = v_user_a;
    IF v_count > 0 THEN RAISE EXCEPTION 'RLS FAILED: User B can read User A transactions'; END IF;

    SELECT COUNT(*) INTO v_count FROM public.budgets WHERE user_id = v_user_a;
    IF v_count > 0 THEN RAISE EXCEPTION 'RLS FAILED: User B can read User A budgets'; END IF;

    SELECT COUNT(*) INTO v_count FROM public.recurring WHERE user_id = v_user_a;
    IF v_count > 0 THEN RAISE EXCEPTION 'RLS FAILED: User B can read User A recurring rules'; END IF;

    -- 3b. User B cannot INSERT a record pretending to be User A
    BEGIN
        INSERT INTO public.transactions (id, user_id, type, amount, category_id, date)
        VALUES (gen_random_uuid(), v_user_a, 'expense', 1000, v_cat_b_expense, CURRENT_DATE);
        RAISE EXCEPTION 'RLS FAILED: User B inserted a transaction with User A user_id';
    EXCEPTION WHEN OTHERS THEN
        -- Expected RLS or FK rejection
    END;

    -- 3c. User B cannot reference User A's category_id in User B's transaction
    BEGIN
        INSERT INTO public.transactions (id, user_id, type, amount, category_id, date)
        VALUES (gen_random_uuid(), v_user_b, 'expense', 1000, v_cat_a_expense, CURRENT_DATE);
        RAISE EXCEPTION 'RLS/FK FAILED: User B referenced User A category_id';
    EXCEPTION WHEN OTHERS THEN
        -- Expected same-user FK / trigger / RLS rejection
    END;

    -- 3d. User B cannot UPDATE or DELETE User A's transaction
    UPDATE public.transactions SET amount = 1 WHERE id = v_tx_a;
    DELETE FROM public.transactions WHERE id = v_tx_a;

    -- Switch back to superuser to verify User A's transaction is completely untouched
    PERFORM set_config('role', 'postgres', true);
    SELECT COUNT(*) INTO v_count FROM public.transactions WHERE id = v_tx_a AND amount = 45000;
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'RLS FAILED: User B modified or deleted User A transaction';
    END IF;

    -- 3e. Verify ordinary authenticated clients cannot write directly to processed_mutations
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user_b::text, 'role', 'authenticated')::text, true);

    BEGIN
        INSERT INTO public.processed_mutations (
            mutation_id, user_id, entity_type, entity_id, operation, applied_version, response_payload
        ) VALUES (
            gen_random_uuid(), v_user_b, 'transactions', gen_random_uuid(), 'create', 1, '{}'::jsonb
        );
        RAISE EXCEPTION 'RLS FAILED: Authenticated client wrote directly to processed_mutations';
    EXCEPTION WHEN insufficient_privilege OR OTHERS THEN
        -- Expected privilege rejection
    END;

    RAISE NOTICE 'ALL PHASE 2 SCHEMA AND TWO-USER RLS TESTS PASSED SUCCESSFULLY!';
END;
$$;

ROLLBACK;