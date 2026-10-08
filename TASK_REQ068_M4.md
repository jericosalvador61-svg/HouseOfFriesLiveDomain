# TASK_REQ068_M4 — Customer/cashier 99999999 + order-ref increment + mojibake + staff dashboard KPI (master-5)

## Context
Repo: HouseOfFriesLiveDomain. Commit on the existing child branch jericosalvador61-svg/master-5-opencode. REQ-068 unit M4. OpenCode implementer — smallest safe changes, php -l / node --check every changed file, commit on the child branch.

## Fix M4-1: Order reference number not incrementing / can repeat
ROOT CAUSE (verified): customer/place_order.php:245-251 derives `HOF<year><COUNT(orders this year)+1, pad5>` — a VOLATILE count (cron hard-DELETEs cancelled rows older than 60 days, so COUNT drops and a previously issued ref is REUSED), with NO UNIQUE index on orders.reference_number and no lock, so two concurrent requests can get the same ref. Same pattern in backend/cashier/create_otc_order.php:32-35.
FIX:
1. customer/place_order.php: derive the numeric suffix from `MAX(CAST(SUBSTRING(reference_number, 8) AS UNSIGNED)) + 1` for the current year (fall back to COUNT+1 when MAX is NULL):
```php
$stmtCount = $pdo->prepare("SELECT COALESCE(MAX(CAST(SUBSTRING(reference_number, 8) AS UNSIGNED)), 0) FROM orders WHERE YEAR(created_at) = ?");
...
$count = (int)$stmtCount->fetchColumn() + 1;
```
Keep the existing 23000 retry loop as collision backstop.
2. backend/cashier/create_otc_order.php: same MAX+1 change (it already uses `LIKE :prefix` — switch to the MAX expression, keep the retry).
3. Add a guarded migration file sql/MIGRATIONS_REQ-068_ref_unique.sql: `ALTER TABLE orders ADD UNIQUE KEY uniq_ref (reference_number)` (idempotent via information_schema check — do NOT use IF NOT EXISTS, use the SET @c / PREPARE pattern already used in sql/MIGRATIONS_REQ-065_definitive_live_safe.sql). Force-add it with git (sql/ is gitignored — `git add -f`).
VERIFY: php -l both; read the migration.

## Fix M4-2: Cashier subtotal shows 99999999 (and receipt reflects it) but can still transact
ROOT CAUSE (verified): javascript/cashier/cashier_dashboard.js:336 + 925 read `order_info.subtotal_amount` straight off backend/cashier/get_order_details.php:16 which SELECTs the raw orders.subtotal_amount column. On the live DB some order has subtotal_amount = 99999999 (poisoned data — the code never writes it; the writers recompute from SUM(order_items.subtotal), so the bad value is a stale/live-data row). The cashier can still transact because process_payment.php only validates total_amount (line 90), never subtotal.
FIX:
1. backend/cashier/get_order_details.php: after fetching order_info, guard the subtotal — if `(float)$orderInfo['subtotal_amount'] > 1000000` (or NULL), recompute it from `SELECT COALESCE(SUM(quantity*price),0) FROM order_items WHERE order_id=? AND is_deleted=0` and use that for subtotal_amount (and total_amount stays as-is — never mutate the DB, just the response). This fixes the summary panel AND the receipt (both read order_info).
2. javascript/cashier/cashier_dashboard.js: in the two places that read subtotal (lines 336 and 925-926), add the same guard client-side: `const st = parseFloat(...subtotal_amount); const subtotal = (st > 0 && st < 1000000) ? st : parseFloat(...total_amount);` — belt and suspenders.
3. backend/cashier/process_payment.php: no change needed for the transact path (total_amount is authoritative), but ADD a sanity reject: if `(float)$orderRow['total_amount'] > 1000000` refuse with a clear message 'This order total looks incorrect. Please void and rebuild the order.' — prevents transacting a poisoned total.
VERIFY: php -l get_order_details.php + process_payment.php; node --check cashier_dashboard.js.

## Fix M4-3: Live-data poison rows (99999999) — find-and-fix migration
Add sql/MIGRATIONS_REQ-068_fix_99999999.sql (force-add): find rows where price/qty/subtotal/total >= 100000 and clamp them to a sane value (e.g. menu_items.price, order_items.price, order_items.quantity, orders.total_amount, orders.subtotal_amount). Provide the SELECT first for review and the UPDATE guarded to only touch values >= 100000:
```sql
-- Preview (run first): 
SELECT * FROM menu_items WHERE price >= 100000;
SELECT * FROM order_items WHERE price >= 100000 OR quantity >= 100000;
SELECT * FROM orders WHERE total_amount >= 100000 OR subtotal_amount >= 100000;
-- Fix (after Jerico reviews the preview):
UPDATE menu_items SET price = 0 WHERE price >= 100000; -- (or a sane price)
...
```
Keep it clearly staged (preview SELECTs commented above the UPDATEs) so it is safe to run on live. Do NOT auto-run anything.

## Fix M4-4: Mojibake in customer/checkout.html (Back arrow, peso, Edit Order, Order Again, Print Receipt)
ROOT CAUSE (verified): a bad merge (e01f2e79) double-encoded the file. User-visible garbage at:
- line 320: `>â†<` should be `>←<`
- line 331: `â‚± 0.00` should be `₱ 0.00`
- line 351: `â³` should be `⏳`
- line 403: `âœï¸` should be `✏️`
- line 408: `âž•` should be `+`
- comments lines 334/342/363/376/411: `â€”` should be `—`
Also javascript/loading.js: lines 176, 192-196, 273, 276: `â€¦` should be `…`, `â€”` should be `—` (user-visible on buttons/pills across 67 pages). javascript/admin/manage_customers.js:119 `'â€”'` should be `'—'`. javascript/navbar-unified.js comment-only mojibake (lines 195, 523, 525, 554, 565) — fix to `—`/`→` for cleanliness.
FIX: replace the double-encoded byte sequences with the intended single Unicode chars (use patch per line; re-save UTF-8 WITHOUT BOM).
VERIFY: grep for 'â' in each fixed file → 0 matches; node --check the JS files.

## Fix M4-5: Inventory-staff dashboard KPI — Total=ACTIVE only + Damaged=PENDING count
ROOT CAUSE (verified): backend/inventoryStaff/InventoryStaffDashboard/get_materials.php stats: total = count(ALL materials incl inactive) (:18), damaged = SUM(quantity_lost) of approved (:34). Owner spec: Total=ACTIVE count, Low=0<qty<=reorder, Out=qty<=0, Damaged=COUNT of PENDING spoilage/waste/damage.
FIX:
1. total: `SELECT COUNT(*) FROM raw_materials WHERE status='ACTIVE'` (or filter the fetched $materials).
2. low: add `AND status='ACTIVE'`.
3. out: add `AND status='ACTIVE'`.
4. damaged: `SELECT COUNT(*) FROM spoilage WHERE status='PENDING' AND spoilage_type IN ('SPOILAGE','WASTE','DAMAGE')` (count, not sum).
VERIFY: php -l.

## Report format
git status --short, git diff --stat vs base, php -l / node --check per file, commit on the child branch. End: `... COMPLETE — master-5`.
