# REQ-052 Batch 3 — CUSTOMER ACCOUNTS — Cline Review Brief (v1, Hermes 2026-10-01)

## Your job
Review the FULL diff of branch `req-052-b3` vs `master` in worktree `C:/Users/Jerico/orca/workspaces/HouseOfFriesLiveDomain/req-052-b3`. Read the actual files — do NOT trust any changelog/commit message. Produce a verdict: `APPROVED` / `CHANGES REQUIRED`, with findings in the exact format:
`SEVERITY | FILE:LINE | OBSERVED | EXPECTED | FIX`
Severity: BLOCKER (breaks the feature or opens a security hole), HIGH (major bug/security), MEDIUM (minor bug/UX), LOW (cosmetic).

## Acceptance criteria to verify (from REQ-052 AC10 + Jerico's locked decisions)
- AC10a register+login with phone/password; token persists; logout clears.
- AC10b logged-in customer sees OLD paid/completed orders (phone-merge) + new orders (customer_account_id); guests keep EXACT device flow.
- AC10c staff can search customers, toggle is_active, generate reset code; customer self-resets with code; locked customer cannot login until staff reactivates.
- AC10d register/login/reset/lockout logged with role Customer.
- AC10e no enumeration (login failure identical whether phone exists or not; rate limits BEFORE credential checks).
- AC10f NO new DB columns/tables; sql/ untouched; all lint passes.

## Non-negotiables (check every one explicitly)
1. **No ALTER/CREATE/ADD COLUMN/DROP anywhere in the diff.** Grep the whole diff. `sql/` must be untouched (it's gitignored anyway — a change there wouldn't even show; verify `git diff master...req-052-b3 --stat` shows no sql files).
2. **Customer identity NEVER from client input.** `customer_account_id` in `place_order.php` must come only from the validated customer token; `get_my_orders.php` must scope `WHERE customer_account_id = <token payload id>` — no customer_id query param, no fallback.
3. **Separate JWT secret.** The customer token must be signed with `CUSTOMER_JWT_SECRET` (defined in `backend/customer_auth.php` with env-first + dev fallback, since `backend/secret.php` is gitignored and absent from the worktree). It must NOT use `JWT_SECRET` and must NOT grant staff access. `role: 'customer'` payload, no `last_activity`.
4. **Phone normalization + PH regex** `/^(09\d{9}|\+639\d{9})$/` server-side in register AND login; normalize to `09XXXXXXXXX` before UNIQUE lookup.
5. **Password strength mirror** of `backend/auth/change_password_first_login.php` (min 6, uppercase, digit, special).
6. **Rate limits on register/login/reset** via extended `hof_rate_limit()` (new optional `$key` param hashing ip|key) — per-IP AND per-phone; applied BEFORE credential checks on login.
7. **EscapeHtml on EVERY dynamic render** in customer JS — including the previously-unescaped `my_orders.js:43-68` interpolations (o.status, o.ref, o.table_number) that this batch must fix.
8. **Reset flow**: temp code file-based store under sys temp (`hof_customer_resets/<hash(phone)>.json`, 15-min expiry, single-use, deleted after use); staff endpoint returns the code to the authenticated admin/supervisor only; customer reset endpoint validates code + phone and updates password_hash; locked (is_active=0) customers must NOT be able to login.
9. **Manage customers pages** follow the existing shell (staff-sidebar.css + navbar-unified.js); sidebar link added after Staff/manage_users on ALL admin+supervisor pages.
10. **Guest flow regression**: when NOT logged in, orderHistory/device flow byte-identical (device.js untouched); account.js must not throw when HOFCustomer is absent on pages that don't load it.

## Known repo context (verify, don't trust)
- `backend/auth_middleware.php` already exempts role 'customer' from idle timeout (lines ~101-102) — customer JWT works through existing auth plumbing, but customer endpoints should use `backend/customer_auth.php` require_customer() not staff authenticate() unless role 'customer' passes cleanly.
- `backend/rate_limit.php` hof_rate_limit($action, $max, $window, $enforce) — per-IP file-based sliding window; the new $key param must be BACKWARDS COMPATIBLE (all existing call sites unchanged).
- logActivity($pdo, ?int $userId, string $username, string $userRole, ...) — user_id nullable; role 'Customer' + CUSTOMER_ prefixed action types expected.
- `customer/place_order.php` INSERT currently: table_id, user_id, customer_name, status, reference_number, order_type, subtotal_amount, total_amount, created_at, ordered_at — customer_account_id must be ADDED to the column list + binding.
- orders table: payment_status enum('PENDING','COMPLETED','FAILED'), status enum('PENDING','IN-PROGRESS','COOKING','COMPLETED','CANCELLED','SERVED') — phone-merge must filter PAID/COMPLETED only (payment_status='COMPLETED').
- customers table columns: customer_id, phone_number (UNIQUE), name, password_hash, is_active, last_login_at, created_at, updated_at — NO login_attempts/locked_until/session_token_hash (do NOT add).

## What to actually review (attack surface)
- Security: token forgery/signature, IDOR on get_my_orders, enumeration via register/login/reset responses, rate-limit bypass (per-phone vs per-IP), XSS via unescaped renders in account.js/reset_password.js/orderHistory.js/my_orders.js, password hashing, temp-code brute force (rate limit + expiry + single-use).
- Correctness: phone normalization consistency (register vs login vs reset), customer_account_id set on place_order ONLY when token valid, get_my_orders merges old paid orders without duplicating rows that already have customer_account_id, last_login_at update, is_active lockout logic (5 fails → lock, staff reactivate), logout actually clears client state.
- Regression: guest path untouched, no break to existing staff manage_users flow, page_gate unaffected, all admin+supervisor pages still load (sidebar link addition must not break HTML), account.js loaded on the 5 customer pages without duplicating chip containers.
- Lint: run `C:/xampp/php/php.exe -l` on every PHP file in the diff and `node --check` on every JS file in the diff. Report any failures as findings.

## Output
Verdict + findings table + for each CHANGES REQUIRED finding, the minimal fix. End with a one-line summary of the 3 highest-risk items you found (even if APPROVED).
