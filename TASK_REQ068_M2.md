# TASK_REQ068_M2 — Inventory KPI cards + stock-out dropdown + raw-materials filter + admin returns flow (master-3)

## Context
Repo: HouseOfFriesLiveDomain. Commit on the existing child branch jericosalvador61-svg/master-3-opencode. REQ-068 unit M2. OpenCode implementer — smallest safe changes, php -l / node --check every changed file, commit on the child branch. Admin and Supervisor share the same JS files under javascript/admin/ AND javascript/supervisor/ (twins) — when you edit an admin file, apply the SAME edit to its supervisor twin (javascript/supervisor/<same-name>.js) unless stated otherwise. The two twins must stay identical except comments/paths.

## Fix M2-1: Inventory KPI cards (Total/Low/Out/Damaged) all frozen at 0
ROOT CAUSE (verified): REQ-057 removed the `stats` key from backend/admin/manageInventory/get_materials.php, but the KPI-card JS on stock_in/stock_out/spoilage/adjustments/returns pages still reads `result.stats?.total/.low/.out/.damaged` → undefined → 0. The backend already has an ORPHANED correct endpoint: backend/admin/inventoryReports/get_stats.php (InventoryReport::getStats — counts Active-only total, low = qty<=reorder AND >0, out = qty<=0, pending_returns count) — but its response keys are total_materials/low_stock/out_stock/pending_returns and it has NO damaged count.
FIX:
1. backend/admin/inventoryReports/InventoryReport.php getStats(): add `damaged` => COUNT(*) FROM spoilage WHERE status='PENDING' AND spoilage_type IN ('SPOILAGE','WASTE','DAMAGE') and ALSO keep pending_returns. Change response keys to the shape the cards consume: total / low / out / damaged (keep the old keys too for backward-compat if referenced anywhere).
2. Point the 5 admin JS files (stock_in.js, stock_out.js, spoilage.js, adjustments.js, returns.js) + their 5 supervisor twins at `/backend/admin/inventoryReports/get_stats.php` for the KPI cards ONLY (keep the existing get_materials.php calls for the dropdown/material lists). Map: total_materials→total, low_stock→low, out_stock→out, damaged→damaged.
   Concretely: in each file, replace the `result.stats?.total` / `stats.low` etc reads with the new endpoint's response (data.total, data.low, data.out, data.damaged). Null-guard every element write (element may not exist).
3. javascript/admin/manage_inventory.js + supervisor twin: remove the dead `setIf('totalItems'...)` block (manage_inventory.html has NO KPI cards — the IDs don't exist there).
VERIFY: php -l backend/admin/inventoryReports/*.php; node --check the 12 JS files.

## Fix M2-2: Admin stock-out dropdown shows zero-stock + inactive materials
ROOT CAUSE (verified): backend/admin/manageInventory/get_materials.php returns ALL raw_materials (no status filter, no batch-sum). javascript/admin/stock_out.js populateMaterialDropdown() renders every row incl `(Out of Stock)` entries; addItemToList() then errors "Out of Stock". Owner wants: STOCK OUT form shows ONLY ACTIVE materials that HAVE stock.
FIX:
1. backend/admin/manageInventory/get_materials.php: default to `WHERE status='ACTIVE'` (add a `?include_inactive=1` escape hatch if any other page needs inactive rows — check callers first; admin manage_inventory raw-materials page should still be able to show inactive when the filter says All/Inactive, so ALSO add `?all=1` OR keep the page calling with the flag). Use `ORDER BY (status='ACTIVE') DESC, raw_material_name ASC` so Active rows sort first. Count total for pagination the same filtered way.
2. javascript/admin/stock_out.js populateMaterialDropdown(): filter `m.status === 'ACTIVE'` AND `parseFloat(m.current_quantity) > 0` client-side as well (belt-and-suspenders); drop the '(Out of Stock)' option rendering entirely.
3. Apply the same ACTIVE filter to the OTHER admin+supervisor dropdowns that feed stock-out/spoilage/adjustments/returns flows (they all call get_materials.php): javascript/admin/spoilage.js, adjustments.js, returns.js, stock_in.js + supervisor twins — keep only ACTIVE rows in the dropdowns.
VERIFY: php -l get_materials.php; node --check the 10 JS files.

## Fix M2-3: Raw-materials list default filter = Active (admin + inventory staff)
ROOT CAUSE (verified): admin manage_inventory.html filter defaults to ACTIVE but loadRawMaterials() renders the full payload bypassing handleFilter (javascript/admin/manage_inventory.js:472), and get_materials.php returns both statuses. Staff page public/inventoryStaff/inventoryStaff_RawMaterials.html defaults to 'All Status' (line 120) and its JS also bypasses the filter on load.
FIX:
1. javascript/admin/manage_inventory.js loadRawMaterials(): after fetching, run the status filter (call handleFilter() or apply the same predicate) so the DEFAULT ACTIVE filter actually hides inactive rows on first paint. Same for javascript/supervisor/manage_inventory.js.
2. public/inventoryStaff/inventoryStaff_RawMaterials.html: make the first option `<option value="ACTIVE" selected>Active</option>` (remove 'All Status' as the default — keep it as a later option).
3. javascript/inventoryStaff/inventoryStaff_RawMaterials.js loadRawMaterials(): apply the status filter on initial load too.
VERIFY: node --check the 3 JS files.

## Fix M2-4: Admin/supervisor-recorded RETURNS must be APPROVED direct + stock added NOW
ROOT CAUSE (verified): backend/admin/manageInventory/record_return.php writes `status 'PENDING'` (line 30) and never touches raw_materials — admin returns need self-approval, and stock only appears later via batch_approve_returns.php. This violates the owner rule "if admin/supervisor records it, it reflects directly".
FIX (backend/admin/manageInventory/record_return.php):
1. `authenticate(['Admin','Supervisor'])` (add Supervisor — currently Admin only; the supervisor returns.js posts to this same endpoint).
2. INSERT with status 'APPROVED', approved_by = auth user_id, approved_at = NOW().
3. In the same transaction, for each item: `UPDATE raw_materials SET current_quantity = current_quantity + ?, updated_at = NOW() WHERE raw_material_id = ?`.
4. Keep return_items rows with unit_cost. Log activity as RETURN (status APPROVED). Response message: "Return recorded and stock restored."
Staff-created returns (backend/inventoryStaff/InventoryStaffDashboard/add_return.php) STAY PENDING — do NOT touch.
VERIFY: php -l record_return.php.

## Fix M2-5: Returns tab missing on stock_in/stock_out/spoilage/adjustments admin pages
ROOT CAUSE (verified): Returns tab exists ONLY on public/admin/manage_inventory.html (:159-161) and returns.html. The other 4 admin inventory pages' tab bars stop at Spoilage.
FIX: Insert the Returns nav link right after the Spoilage tab in public/admin/stock_in.html, public/admin/stock_out.html, public/admin/spoilage.html, public/admin/adjustments.html (mirror manage_inventory.html exactly):
```html
<a href="returns.html" class="nav-link" data-category="returns">
    Returns
</a>
```
Do the same on the 4 supervisor twins (public/supervisor/stock_in.html, stock_out.html, spoilage.html, adjustments.html).
VERIFY: grep 'returns.html' on all 8 pages.

## Report format
git status --short, git diff --stat vs base, php -l / node --check per file, commit on the child branch. End: `... COMPLETE — master-3`.
