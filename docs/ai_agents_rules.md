# AGENTS.md - Rules for AI Tools

**Project:** Where Did It Go? (React Native + Expo + TypeScript + Supabase)  
**Source of truth:** `docs/PRD_v4.0.pdf` (keep a copy in the repo).

Every AI tool working on this repo (Antigravity, Gemini CLI, Jules, Cursor, Copilot, chat assistants) must follow these rules. If a rule conflicts with a user request, say so and ask before continuing.

## 1. Honesty rules (anti-hallucination)
*   **Never invent.** Do not make up packages, functions, props, CLI flags, config keys, table names, or file paths. If you are not sure it exists, say "I'm not sure" and check.
*   **Check before using.** Before using a library API, read the installed version in `package.json` and the library's docs or its type definitions in `node_modules`. Do not rely on memory for APIs that change often (Expo, Expo Router, Supabase, Reanimated, FlashList).
*   **Do not guess versions.** Use only package versions that are installed or that `npx expo install` selects. Never write version numbers from memory.
*   **Look at the real code first.** Read the files you are about to change, and search the repo for existing helpers before writing new ones. Do not assume a file or function exists.
*   **Say what you did not verify.** End every task with: what you ran, what passed, and what you could NOT test.
*   **Never claim success without proof.** Do not say "done", "fixed", or "tests pass" unless you actually ran the command and saw the result. Paste the real output.
*   **Ask instead of assuming.** If the PRD, the code, or the request is unclear or contradictory, stop and ask one clear question. Do not fill gaps with guesses.
*   **No fake data in real code.** Mock data is allowed only in files named `*.mock.ts` or in tests, and must be clearly labeled.
*   **Do not invent requirements.** Do not add features, screens, tables, or dependencies that the PRD does not list.

## 2. Scope rules
*   **Work on one PRD phase at a time**, and only the task you were given. Do not start the next phase.
*   **Keep changes small:** one task, one focused change. No large rewrites, no unrelated refactors, no renaming or moving files unless asked.
*   **Do not delete files, drop tables, or run destructive commands** (`rm -rf`, `git reset --hard`, `DROP TABLE`, `git push --force`) without explicit permission.
*   **Do not add a new dependency** without saying why, and check it is maintained and compatible with Expo.
*   **If the task is bigger than expected**, stop and propose a split into smaller steps.

## 3. Project rules (from PRD v4.0)
*   **Money:** Store money as integers in the smallest currency unit (cents/paise). Never use floats for money. Parse user input with string-based conversion, not `parseFloat` math. Amounts are always positive; type (income or expense) decides the sign. Reject zero, negative, malformed, and out-of-range amounts. Validate on the server too.
*   **Calculations:** `Saved = Income - Spent` for the selected calendar month, using the transaction date. Exclude soft-deleted rows. Include pending local changes. A negative result says "Spent X more than earned." Never call it "debt".
*   **Dates:** Transaction dates are `YYYY-MM-DD`. Goal months are the first day of the month. Server audit timestamps are UTC. A time-zone change must never move a transaction to another day.
*   **Offline-first:** Screens read from local SQLite only, never directly from remote queries. Every user change must, in one SQLite transaction: validate, update the local row, increment the local revision, and write an outbox entry. Use client-generated UUIDs (`expo-crypto`) for new records. The server controls version, `created_at`, and `updated_at`. Never use the phone's clock for conflict resolution or as a pull cursor. Use version-checked updates. Never silently overwrite newer server data. Keep both versions for the conflict screen. Deletes are soft (`deleted_at`).
*   **Security:** Row-level security on every user-facing table. Keep each account's local data separate. Never replay one user's outbox under another session. No secrets in the app. Only the Supabase anon key is allowed on the client. Never hardcode keys, tokens, or passwords. Use environment variables, and never commit `.env`. CSV export must neutralize formula prefixes (`=`, `+`, `-`, `@`) in user text.
*   **Recurring transactions:** Generated on the server only, with a unique key per occurrence so repeats cannot duplicate.

## 4. Code rules
*   **TypeScript strict mode.** No `any` unless commented with the reason.
*   **Keep database access, sync, calculations, and parsing in separate modules**, not inside screen components.
*   **Reuse theme tokens and shared components** (Button, Card, Input, Chip, Toast). No hardcoded colors or sizes in screens.
*   **UI style:** neobrutalist, cream background, 2-3px black borders, hard offset shadows (no blur), one accent color, Space Grotesk, light mode only.
*   **Every screen needs loading, empty, and error states.**
*   **Support larger text and screen readers.** Charts need a text equivalent.
*   **Write clear names and short comments** for non-obvious logic only.

## 5. Testing rules
*   Add or update tests for any change to money conversion, calculations, parsing, budgets, goals, sync, or scheduling.
*   Run lint, type-check, and tests before saying a task is complete:
    *   `npx tsc --noEmit`
    *   `npm run lint`
    *   `npm test`
*   If a test fails, fix the cause. Do not delete, skip, or weaken tests to make them pass.
*   Never hide errors with empty `try/catch` blocks.

## 6. Response format for every task
Reply in this order:
1.  **Plan:** what you will change, in 3-5 lines.
2.  **Files touched:** list of paths.
3.  **Changes made:** short summary.
4.  **Verified:** commands run and real results.
5.  **Not verified / risks:** anything untested, assumed, or uncertain.
6.  **Next step:** one suggestion only.

## 7. When to stop and ask
Stop and ask the user if:
*   The PRD and the code disagree.
*   A needed library, API, or table is not found.
*   The task needs a secret, account, or paid service.
*   You are about to touch auth, sync, RLS policies, or money logic in a way the task did not describe.
*   You have failed the same fix twice. Do not loop; explain what you tried.

*Reminder: a confident wrong answer is worse than "I don't know." When unsure, say so.*