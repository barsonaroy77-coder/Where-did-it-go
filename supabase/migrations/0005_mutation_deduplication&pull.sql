-- ============================================================================
-- Task 2.5: Mutation Deduplication & Pull-Protocol Storage
-- ============================================================================

-- 1. Ensure the monotonic change_seq sequence exists (created in Task 2.2)
CREATE SEQUENCE IF NOT EXISTS public.global_change_seq AS BIGINT;

-- 2. Create the Mutation Deduplication Table
-- Stores immutable client mutation IDs and their canonical server responses
-- so retries after a lost network response return the original outcome
-- without re-applying the mutation.
CREATE TABLE IF NOT EXISTS public.processed_mutations (
    mutation_id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL CHECK (
        entity_type IN ('profiles', 'categories', 'transactions', 'goals', 'budgets', 'recurring')
    ),
    entity_id UUID NOT NULL,
    operation TEXT NOT NULL CHECK (
        operation IN ('create', 'update', 'delete', 'restore')
    ),
    base_version INTEGER,
    applied_version INTEGER NOT NULL,
    response_payload JSONB NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Index for user-scoped lookups and future retention/cleanup jobs
CREATE INDEX IF NOT EXISTS idx_processed_mutations_user_processed_at
    ON public.processed_mutations (user_id, processed_at DESC);

CREATE INDEX IF NOT EXISTS idx_processed_mutations_entity
    ON public.processed_mutations (user_id, entity_type, entity_id);

-- 3. Lock Down Access (Server-Internal Only)
-- Ordinary clients cannot insert, update, or delete deduplication records directly.
-- They are written atomically inside SECURITY DEFINER mutation RPCs (Phase 3).
ALTER TABLE public.processed_mutations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own processed mutations" ON public.processed_mutations;
CREATE POLICY "Users can read own processed mutations"
    ON public.processed_mutations
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

-- Explicitly revoke direct client write privileges; only postgres/service_role
-- and SECURITY DEFINER functions can insert into processed_mutations.
REVOKE INSERT, UPDATE, DELETE ON public.processed_mutations FROM anon, authenticated;

-- 4. Pull-Protocol Indexes & Watermark Helper
-- Ensures every synchronized table has a fast, deterministic (user_id, change_seq)
-- access path for cursor-based pull pagination.
CREATE INDEX IF NOT EXISTS idx_profiles_pull_sync
    ON public.profiles (id, change_seq);

CREATE INDEX IF NOT EXISTS idx_categories_pull_sync
    ON public.categories (user_id, change_seq);

CREATE INDEX IF NOT EXISTS idx_transactions_pull_sync
    ON public.transactions (user_id, change_seq);

CREATE INDEX IF NOT EXISTS idx_goals_pull_sync
    ON public.goals (user_id, change_seq);

CREATE INDEX IF NOT EXISTS idx_budgets_pull_sync
    ON public.budgets (user_id, change_seq);

CREATE INDEX IF NOT EXISTS idx_recurring_pull_sync
    ON public.recurring (user_id, change_seq);

-- 5. Safe Pull High-Watermark Helper Function
-- Returns the highest change_seq that is strictly below any currently in-flight
-- transaction's sequence value, preventing the pull protocol from missing rows
-- committed concurrently during a pull.
CREATE OR REPLACE FUNCTION public.get_pull_watermark()
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(last_value, 0) FROM public.global_change_seq;
$$;

GRANT EXECUTE ON FUNCTION public.get_pull_watermark() TO authenticated;