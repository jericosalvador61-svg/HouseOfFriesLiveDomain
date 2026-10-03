# SPEC — Wave 1: REQ-057 Inventory Staff Overhaul (OpenCode implementer)

You are OpenCode, the implementer, working in this git worktree (branch `jericosalvador61-svg/master-5-opencode`, base ee6cebe). You implement the approved request REQ-057 exactly as specified below. You are NOT the reviewer — Cline reviews after you. Do NOT change scope.

Vault context: House of Fries LiveDomain, PHP 8.x OOP + MySQL PDO prepared statements + Bootstrap 5 + SweetAlert2. Role names Capitalized. Status enums use HYPHENS (`IN-PROGRESS`, `COOKING`). `table_id` is canonical, `table_number` is display. Auth middleware: `authenticate(['Admin','Supervisor'])` etc. Activity logging via `log_activity_helper.php` (categories e.g. `INVENTORY_SPOILAGE`, `INVENTORY_RAW_MATERIAL`). The shared FIFO helper `backend/inventory_helpers.php` (hof_deduct_fifo) is used on all stock deduct/add paths — never bypass it.

## Objective (REQ-057, decisions locked by Jerico 2026-10-03)
1. **Fix spoilage submit CRASH (CRITICAL).** `backend/inventoryStaff/spoilage/record_spoilage.php` reads `$item['material_id']` but the JS payload sends `raw_material_id: i.material_id`. Result: undefined key → NULL bound to `spoilage.raw_material_id NOT NULL` → SQLSTATE 23000. Fix: PHP reads `raw_material_id` with `?? $item['material_id']` fallback (accept both). Verify the whole submit path (modal → JS payload → PHP insert) aligns.
2. **Add DAMAGE type** to the spoilage Type dropdown/modal on ALL spoilage pages (inventory staff, admin, supervisor) + DB enum gains 'DAMAGE' (DDL below; code must handle the value).
3. **Required photo on SPOILAGE/WASTE/DAMAGE submissions** — client-side canvas pre-compression (max 800px, JPEG ~0.65) BEFORE upload → stored as BLOB in the DB (`spoilage.photo`). Proof-only: NO extra approval gate. Admin/supervisor see the photo (render blob as data URI `<img src="data:image/jpeg;base64,...">`). The photo is REQUIRED for all 3 types (form validation; reject submit without it).
4. **Blob images** (`image_blob` LONGBLOB) on: `menu_items`, `raw_materials`, `menu_item_choices`, `menu_item_addons` (new columns, DDL below). All consumers switch to the blob: customer menu popups (choices/add-ons clickable images), staff pages (manage_menu cards, manage_choices/addons, raw materials tables), landing (Wave 5). Remove/stop using the paste-URL field as primary (keep column, but UI becomes upload-or-blob). Reuse the existing client-side canvas compression pattern already used for menu images (`manage_menu.js`) — do NOT duplicate logic; factor a shared helper (`javascript/image-helper.js`) used by all pages that compress images.
5. **Pagination 10 rows/page on ALL inventory modules** (staff: dashboard, stock-out, stock-in, adjustment, returns, spoilage, raw materials, purchase plan; admin+supervisor equivalents where they list). Server-side LIMIT/OFFSET + shared pager controls. Only the module pages — dashboard KPIs stay full.
6. **KPI cards (Total/Low/Out/Damaged) ONLY on the inventory dashboard** — remove the 4-stat cards + their JS writers + unused `stats` from per-module `get_materials.php` endpoints (keep the dashboard endpoint's stats).
7. **Raw materials RBAC:** inventory staff READ-ONLY — hide Add/Edit/Delete buttons for staff and enforce on endpoints (`authenticate(['Admin','Supervisor'])` for write: add/update/delete raw materials). Admin + supervisor full manage, changes take effect IMMEDIATELY (no PENDING approval step — this module has none by design).
8. **Unit-cost snapshot (for REQ-056 gross profit):** on every stock-out write path (staff `stockOut/add_stock_out` + admin + supervisor stock-out record paths), when inserting `stock_out_items`, set `unit_cost` = the raw material's CURRENT `cost_per_unit` at that moment (snapshot). Use the shared helper paths consistently.
9. **Activity logging complete:** every inventory write logs to `activity_logs` (raw-material add/edit/delete, DAMAGE + spoilage-photo actions & approvals). Most already log; fill gaps (verify each endpoint you touch logs; add where missing with proper category).
10. **DDL file update:** update `sql/house_of_fries_db_clean.sql` with the additive DDL (below) so the repo schema matches. (Live InfinityFree DDL is applied by Jerico after deploy — your code assumes the columns exist on live.)

## DDL (additive, in sql/house_of_fries_db_clean.sql)
```sql
ALTER TABLE spoilage
  MODIFY spoilage_type ENUM('SPOILAGE','WASTE','DAMAGE') NOT NULL,
  ADD photo LONGBLOB NULL;
ALTER TABLE menu_items ADD image_blob LONGBLOB NULL;
ALTER TABLE raw_materials ADD image_blob LONGBLOB NULL;
ALTER TABLE menu_item_choices ADD image_blob LONGBLOB NULL;
ALTER TABLE menu_item_addons ADD image_blob LONGBLOB NULL;
ALTER TABLE stock_out_items ADD unit_cost DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT 'Snapshot of raw_materials.cost_per_unit at stock-out time (gross-profit basis)';
```
The `stock_out_items.unit_cost` line already exists as an uncommitted edit in the PRIMARY tree — add it to the committed schema file here too.

## Files (verified to exist — touch ONLY these and their direct consumers)
Backend:
- `backend/inventoryStaff/spoilage/record_spoilage.php` (CRITICAL field fix + photo BLOB insert + log)
- `backend/inventoryStaff/spoilage/get_materials.php`, `get_spoilage_history.php` (photo render, pagination)
- `backend/inventoryStaff/rawMaterials/{add_raw_material.php, update_raw_materials.php, delete_raw_material.php, get_materials.php}` (RBAC + blob + log)
- `backend/inventoryStaff/stockOut/*` (unit_cost snapshot + pagination)
- `backend/inventoryStaff/stockIn/*`, `adjustment/*`, `InventoryStaffDashboard/*`, `purchasePlan/*` (pagination; stats removal where KPI-only; log gaps)
- `backend/admin/salesReports/*` — NOT this wave (Wave 2).
- `backend/admin/manageInventory/*`, `backend/supervisor/*` stock/spoilage approvals — ONLY where this REQ touches (spoilage photo/DAMAGE + stock-out unit_cost + pagination on their lists). Verify each endpoint URL exists before wiring.
- `backend/inventory_helpers.php` — only if a stock-out path needs unit_cost capture via the shared helper (do not refactor it otherwise).

Frontend:
- `javascript/inventoryStaff/inventoryStaff_Spoilage.js` (+ .html) — DAMAGE, required photo canvas-compress, blob render, pagination
- `javascript/inventoryStaff/inventoryStaff_RawMaterials.js` (+ .html) — staff read-only UI, blob, pagination
- `javascript/inventoryStaff/inventoryStaff_StockOut.js`/`StockIn`/`Adjustment`/`Returns`/`PurchasePlan`/`Dashboard` (+ .html) — pagination, KPI removal
- `javascript/admin/manage_menu.js` + `public/admin/manage_menu.html` — factor shared image helper + blob images + choices/addons blobs
- `public/admin/manage_choices.html` + js, `public/supervisor/manage_menu.html` + js, `public/supervisor/spoilage.html` + js, `public/admin/spoilage.html` + js — blob images + DAMAGE + photo
- `javascript/menu-choice-popup.js` — show blob images (clickable) for choices/add-ons in customer popup
- NEW `javascript/image-helper.js` — shared canvas compression (800px / JPEG 0.65) + blob→data-URI render helper
- `sql/house_of_fries_db_clean.sql` — DDL additions

## Constraints
- NO schema changes beyond the DDL above. NO new tables. NO auth changes beyond raw-materials write allowlist. NO deployment. Do NOT touch gitignored files (backend/db.php, secret.php, config/paymongo_config.php — they don't exist in this worktree).
- Keep the existing outer path columns (`image_url`, `img_url`) intact — blob is additive.
- All PHP uses PDO prepared statements. All user content escaped on render (blob is base64 data URI — safe, but never interpolate raw). No inline `<style>`/`<script>` in pages being touched (external files only).
- Smallest safe changes; no unrelated refactors; preserve existing working functionality (auth, navigation, inventory FIFO flows, approvals).
- Role strings Capitalized exactly: `'Inventory Staff'`, `'Admin'`, `'Supervisor'`.

## Acceptance criteria (verify yourself before committing)
- AC1: Spoilage submit no longer 23000-crashes; records with correct raw_material_id.
- AC2: DAMAGE selectable on all 3 spoilage pages; enum accepts it.
- AC3: Photo required + compressed client-side + stored in spoilage.photo; admin/supervisor see it (data URI) with no extra approval step.
- AC4: image_blob rendered on menu_items/raw_materials/choices/addons consumers (customer popup shows clickable choice/addon images); paste-URL no longer primary.
- AC5: Every inventory list paginates 10/page (server-side LIMIT/OFFSET).
- AC6: KPI cards only on inventory dashboard; per-module pages no longer fetch/render them.
- AC7: Inventory Staff cannot Add/Edit/Delete raw materials (UI hidden + endpoints 403); Admin/Supervisor can, immediate effect.
- AC8: stock_out_items.unit_cost populated = current cost_per_unit at stock-out time on all stock-out paths.
- AC9: Every touched write endpoint logs to activity_logs (grep before/after).
- AC10: `php -l` passes on every changed PHP; `node --check` on every changed JS.

## Workflow (numbered, prove each step on disk)
1. Read the listed files first. Confirm the actual field names/paths before editing.
2. Implement in small commits — one commit per logical fix (e.g. `fix(spoilage): align raw_material_id + photo blob`). Commit AFTER each numbered fix with `git add` + `git commit -m "REQ-057: <summary>"`.
3. After each commit, run the lint for the changed files and paste the result line into your report.
4. After ALL fixes: run `php -l` on every changed PHP file and `node --check` on every changed JS file; fix any failures; re-run. Report each result.
5. `git status` must show ONLY intended files. `git diff --stat` at the end.
6. Commit everything (leave nothing uncommitted).
7. FINAL VAULT-WRITE STEP (mandatory): append a NEW entry at the TOP of `C:/Users/Jerico/HOUSE_OF_FRIES_CAPSTONE/13_LOGS/AI_AGENT_LOG.md` with heading `## 2026-10-03 — REQ-057 Wave1 (OpenCode) implementation report` containing: files changed (with line-level summary), AC1-AC10 verdicts, lint results, commit list, and the honest label (implemented ≠ reviewed). If you cannot write to the vault, STOP and say so — never print the report in chat as a substitute.

## Report format (final message)
- Per fix: file(s) + line numbers + one-line what changed.
- AC table AC1..AC10 PASS/FAIL.
- Lint table (file → PASS/FAIL).
- Commit list (short hashes + messages).
- Any deviations from this spec, with reason.
