// ==========================================
// ADJUSTMENTS - Admin Module
// Consistent flow: staging table → duplicate detection → review modal → pending
// ==========================================
let inventoryMaterials = [];
let allAdjustmentRecords = [];
let adjustmentPage = 1;
let adjustmentTotal = 0;

function renderAdminAdjustmentPager() {
    const pagerEl = document.getElementById('adjustmentPager');
    if (!pagerEl) return;
    const pages = Math.max(1, Math.ceil(adjustmentTotal / 10));
    let html = '';
    for (let i = 1; i <= pages; i++) {
        html += `<li class="page-item ${i === adjustmentPage ? 'active' : ''}"><a class="page-link" href="#" data-page="${i}">${i}</a></li>`;
    }
    pagerEl.innerHTML = html;
    pagerEl.querySelectorAll('a[data-page]').forEach(a => {
        a.addEventListener('click', e => {
            e.preventDefault();
            adjustmentPage = parseInt(a.dataset.page, 10);
            loadAdjustmentHistory();
        });
    });
}
let adjItems = [];

document.addEventListener('DOMContentLoaded', function () {
    const dateInput = document.getElementById('adjDateDefault');
    if (dateInput) dateInput.valueAsDate = new Date();
    loadInitialData();
    document.getElementById('addAdjRow').addEventListener('click', transferToTable);
    document.getElementById('adjustmentForm').addEventListener('submit', handleAdjustmentSubmit);
});

function authenticatedFetch(url, options = {}) {
    const token = localStorage.getItem('hof_token');
    if (!options.headers) options.headers = {};
    options.headers['Authorization'] = `Bearer ${token}`;
    return fetch(url, options).then(response => {
        if (response.status === 401) {
            Swal.fire("Unauthorized", "Your session expired.", "error");
            throw new Error("Unauthorized (401)");
        }
        return response;
    });
}

async function loadInitialData() {
    try {
        const res = await authenticatedFetch("/backend/admin/manageInventory/get_materials.php");
        const result = await res.json();
        if (result.status === 'success') {
            inventoryMaterials = result.data;
            populateDropdown(document.getElementById('mainMaterialSelect'));
            checkStockAlerts(inventoryMaterials);
            // REQ-068: KPI cards from inventoryReports stats endpoint
            fetch("/backend/admin/inventoryReports/get_stats.php", { method: "GET", headers: getAuthHeaders(null) })
                .then(r => r.json())
                .then(s => {
                    const d = (s && s.data) || {};
                    setStatValue('totalItems', d.total ?? 0);
                    setStatValue('lowStock', d.low ?? 0);
                    setStatValue('outStock', d.out ?? 0);
                    setStatValue('damagedStock', d.damaged ?? 0);
                })
                .catch(() => {});
        }
        loadAdjustmentHistory();
    } catch (err) { console.error("Load error:", err); }
}

async function loadAdjustmentHistory() {
    const mainTbody = document.getElementById('adjustmentsTableBody');
    const pendingTbody = document.querySelector('.pending-table-card tbody');
    const pendingBadge = document.querySelector('.pending-table-card .badge');
    const pendingCard = document.querySelector('.pending-table-card');
    if (!mainTbody) return;

    try {
        const res = await authenticatedFetch("/backend/admin/manageInventory/get_adjustment_history.php?page=" + adjustmentPage);
        const result = await res.json();
        if (result.status === 'success') {
            const raw = Array.isArray(result.data) ? result.data : [];
            allAdjustmentRecords = raw;
            adjustmentTotal = (result.pagination && result.pagination.total) || raw.length;
            renderAdminAdjustmentPager();
            const approved = raw.filter(r => (r.status || '').toLowerCase() !== 'pending');
            const pending = raw.filter(r => (r.status || '').toLowerCase() === 'pending');

            mainTbody.innerHTML = approved.length === 0
                ? `<tr><td colspan="6" class="text-center py-4 text-muted">No completed adjustment history.</td></tr>`
                : approved.map(row => {
                    const typeBadge = row.adjustment_type === 'ADD'
                        ? `<span class="text-success fw-bold">+${row.quantity}</span>`
                        : `<span class="text-danger fw-bold">-${row.quantity}</span>`;
                    return `<tr>
                        <td class="ps-4"><div class="fw-bold">${row.raw_material_name}</div><small class="text-muted">${row.unit || ''}</small></td>
                        <td>${typeBadge}</td>
                        <td><span class="text-truncate d-inline-block" style="max-width:150px;">${row.reason || ''}</span></td>
                        <td>${new Date(row.adjustment_date).toLocaleDateString()}</td>
                        <td><div class="d-flex align-items-center"><div class="avatar-xs me-2 bg-light rounded-circle text-center" style="width:24px;height:24px;line-height:24px;"><i class="bi bi-person small"></i></div><span>${row.adjusted_by || 'System'}</span></div></td>
                        <td><button type="button" class="btn btn-sm btn-primary view-adjustment-btn" data-id="${row.adjustment_id || ''}"><i class="bi bi-eye"></i></button></td>
                    </tr>`;
                }).join('');

            if (pendingBadge) pendingBadge.textContent = pending.length;
            setupPendingAdjCardHeaders(pendingCard, pending.length);

            if (pending.length > 0 && pendingTbody) {
                pendingTbody.innerHTML = pending.map(item => {
                    const typeIndicator = item.adjustment_type === 'ADD'
                        ? '<span class="badge bg-success-subtle text-success me-1">+</span>'
                        : '<span class="badge bg-danger-subtle text-danger me-1">-</span>';
                    return `<tr>
                        <td class="ps-3 py-2" style="width:40px;"><input type="checkbox" class="form-check-input pending-adj-chk" data-id="${item.adjustment_id}"></td>
                        <td class="py-2"><div class="fw-bold text-dark">${typeIndicator}${item.raw_material_name}</div><small class="text-muted">Amt: ${item.quantity} ${item.unit || ''} | Reason: ${item.reason || 'None'}</small></td>
                        <td class="text-end pe-3"><button type="button" class="btn btn-sm btn-primary view-adjustment-btn" data-id="${item.adjustment_id}"><i class="bi bi-eye"></i></button></td>
                    </tr>`;
                }).join('');
                document.getElementById("pendingAdjActionFooter")?.classList.remove("d-none");
            } else if (pendingTbody) {
                pendingTbody.innerHTML = `<tr><td colspan="3" class="text-center py-4 text-muted small"><i class="bi bi-check-circle text-success d-block mb-1 fs-4"></i>No pending adjustments.</td></tr>`;
                document.getElementById("pendingAdjActionFooter")?.classList.add("d-none");
            }

            document.querySelectorAll('.view-adjustment-btn').forEach(btn => {
                btn.onclick = function () { showAdjustmentDetailsSwal(this.getAttribute('data-id')); };
            });
            initBatchAdjustmentListeners();
        }
    } catch (err) { console.error("History error:", err); }
}

function populateDropdown(selectElement) {
    if (!selectElement) return;
    selectElement.innerHTML = '<option value="" disabled selected>Choose a material to adjust...</option>';
    // REQ-071: adjustments must show ALL raw materials (active AND inactive)
    // so any material can be corrected — except zero-quantity is still
    // selectable (a REMOVE on 0 is rejected server-side). Inactive rows get
    // an "(Inactive)" tag for transparency.
    inventoryMaterials.forEach(item => {
        const inactiveTag = String(item.status || '').toUpperCase() === 'INACTIVE' ? ' (Inactive)' : '';
        const opt = document.createElement('option');
        opt.value = item.raw_material_id;
        opt.dataset.name = item.raw_material_name;
        opt.dataset.unit = item.unit;
        opt.textContent = `${item.raw_material_name} (Stock: ${item.current_quantity} ${item.unit})${inactiveTag}`;
        selectElement.appendChild(opt);
    });
}

function transferToTable() {
    const mainSelect = document.getElementById('mainMaterialSelect');
    const mainQtyInput = document.getElementById('mainQty');
    const materialId = mainSelect.value;
    const qty = parseInt(mainQtyInput.value) || 1;

    if (!materialId) { Swal.fire('Note', 'Please select a material first.', 'info'); return; }

    // Duplicate detection (like Stock In)
    const existingRow = document.querySelector(`#adjItemBody tr[data-id="${materialId}"]`);
    if (existingRow) {
        const name = mainSelect.options[mainSelect.selectedIndex].dataset.name;
        Swal.fire({
            title: 'Already Added',
            text: `"${name}" is already in your list. Combine quantities?`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Yes, merge!'
        }).then(result => {
            if (result.isConfirmed) {
                const qtyInput = existingRow.querySelector('.item-qty');
                qtyInput.value = parseInt(qtyInput.value) + qty;
            }
        });
        return;
    }

    const opt = mainSelect.options[mainSelect.selectedIndex];
    const name = opt.dataset.name;
    const unit = opt.dataset.unit;

    const container = document.getElementById('adjTableContainer');
    const tbody = document.getElementById('adjItemBody');
    container.classList.remove('d-none');

    const row = document.createElement('tr');
    row.dataset.id = materialId;
    row.innerHTML = `
        <td class="fw-bold text-dark">${name} <br><small class="text-muted">Unit: ${unit}</small></td>
        <td>
            <div class="input-group input-group-sm" style="width:130px;">
                <button class="btn btn-outline-secondary btn-minus" type="button">-</button>
                <input type="number" class="form-control text-center item-qty fw-bold" value="${qty}" min="1">
                <button class="btn btn-outline-secondary btn-plus" type="button">+</button>
            </div>
        </td>
        <td class="text-end"><button type="button" class="btn btn-outline-danger btn-sm remove-row-btn"><i class="bi bi-trash"></i></button></td>
    `;
    tbody.appendChild(row);

    row.querySelector('.btn-plus').onclick = () => { const i = row.querySelector('.item-qty'); i.value = parseInt(i.value) + 1; };
    row.querySelector('.btn-minus').onclick = () => { const i = row.querySelector('.item-qty'); if (parseInt(i.value) > 1) i.value = parseInt(i.value) - 1; };
    row.querySelector('.remove-row-btn').onclick = () => { row.remove(); if (tbody.children.length === 0) container.classList.add('d-none'); };

    mainSelect.value = "";
    mainQtyInput.value = 1;
}

function updateQuickStats(materials) {
    let low = 0, out = 0;
    materials.forEach(m => {
        const qty = parseFloat(m.current_quantity);
        if (qty <= 0) out++;
        else if (qty <= (parseFloat(m.reorder_level) || 10)) low++;
    });
    setStatValue('totalItems', materials.length);
    setStatValue('lowStock', low);
    setStatValue('outStock', out);
}

function updateQuickStatsFromBackend(stats) {
    const s = stats || {};
    setStatValue('totalItems', s.total ?? 0);
    setStatValue('lowStock', s.low ?? 0);
    setStatValue('outStock', s.out ?? 0);
    setStatValue('damagedStock', s.damaged ?? 0);
}

function setStatValue(id, value) { const el = document.getElementById(id); if (el) { el.textContent = value ?? 0; el.classList.add('fw-bold'); } }

// ==========================================
// REVIEW MODAL (like Stock In)
// ==========================================
async function handleAdjustmentSubmit(e) {
    e.preventDefault();

    const tbody = document.getElementById('adjItemBody');
    const rows = tbody.querySelectorAll('tr');
    if (rows.length === 0) {
        Swal.fire('Error', 'Please add at least one material to adjust.', 'error');
        return;
    }

    // Build review content
    const type = document.getElementById('adjType').value;
    const date = document.getElementById('adjDateDefault').value;
    const reason = document.getElementById('adjReason').value;

    let itemsHtml = '';
    rows.forEach((row, i) => {
        const name = row.querySelector('td').childNodes[0].textContent.trim();
        const qty = row.querySelector('.item-qty').value;
        const icon = type === 'ADD' ? '+' : '-';
        itemsHtml += `<tr><td>${i+1}.</td><td class="fw-bold">${name}</td><td>${icon}${qty}</td></tr>`;
    });

    const result = await Swal.fire({
        title: 'Review Adjustment',
        html: `
            <div class="text-start">
                <table class="table table-sm table-borderless mb-2">
                    <tr><td class="text-muted">Type:</td><td class="fw-bold">${type === 'ADD' ? 'ADD (+)' : 'REMOVE (-)'}</td></tr>
                    <tr><td class="text-muted">Date:</td><td class="fw-bold">${date}</td></tr>
                    <tr><td class="text-muted">Reason:</td><td class="fw-bold">${reason || '—'}</td></tr>
                </table>
                <hr>
                <h6 class="fw-bold">Items:</h6>
                <div class="table-responsive" style="max-height:200px;overflow-y:auto;">
                    <table class="table table-sm table-bordered"><thead class="table-light"><tr><th>#</th><th>Material</th><th>Qty</th></tr></thead><tbody>${itemsHtml}</tbody></table>
                </div>
            </div>`,
        icon: 'info',
        showCancelButton: true,
        confirmButtonColor: type === 'ADD' ? '#28a745' : '#dc3545',
        confirmButtonText: 'Confirm Adjustment',
        cancelButtonText: 'Cancel',
        width: '550px'
    });

    if (!result.isConfirmed) return;

    const submitBtn = document.getElementById('adjustmentForm').querySelector('button[type="submit"]');
    LoadingManager.show(submitBtn || document.getElementById('adjustmentForm'), { text: 'Processing...' });

    const adjustmentData = { type, date, reason, items: [] };
    rows.forEach(row => {
        adjustmentData.items.push({
            raw_material_id: row.dataset.id,
            quantity: row.querySelector('.item-qty').value
        });
    });

    try {
        const res = await authenticatedFetch('/backend/admin/manageInventory/process_adjustments.php', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(adjustmentData)
        });
        const result2 = await res.json();
        if (result2.status === 'success') {
            Swal.fire('Success!', result2.message, 'success').then(() => location.reload());
        } else {
            Swal.fire('Failed', result2.message, 'error');
        }
    } catch (err) {
        console.error("Submit error:", err);
        Swal.fire('Error', 'Server error.', 'error');
    } finally {
        LoadingManager.hide(submitBtn || document.getElementById('adjustmentForm'));
    }
}

function setupPendingAdjCardHeaders(cardEl, pendingCount) {
    if (!cardEl) return;
    let header = document.getElementById("selectAllPendingAdjHeader");
    if (!header && pendingCount > 0) {
        const ch = cardEl.querySelector(".card-header") || cardEl;
        const div = document.createElement("div");
        div.id = "selectAllPendingAdjHeader";
        div.className = "d-flex align-items-center mt-2 pt-2 border-top";
        div.innerHTML = `<input type="checkbox" id="selectAllPendingAdjChk" class="form-check-input me-2 ms-1"><label for="selectAllPendingAdjChk" class="small fw-bold text-secondary" style="cursor:pointer;">Select All</label>`;
        ch.appendChild(div);
    } else if (header && pendingCount === 0) header.remove();

    let footer = document.getElementById("pendingAdjActionFooter");
    if (!footer && cardEl) {
        const f = document.createElement("div");
        f.id = "pendingAdjActionFooter";
        f.className = "card-footer bg-white d-none py-2 text-end border-top-0";
        f.innerHTML = `<button type="button" id="approveSelectedAdjBtn" class="btn btn-sm btn-success w-100 fw-bold py-2"><i class="bi bi-check2-all me-1"></i> Approve Selected</button>`;
        cardEl.appendChild(f);
    }
}

function initBatchAdjustmentListeners() {
    const selectAll = document.getElementById("selectAllPendingAdjChk");
    const items = document.querySelectorAll(".pending-adj-chk");
    const approveBtn = document.getElementById("approveSelectedAdjBtn");

    if (selectAll) {
        selectAll.checked = false;
        selectAll.onchange = function () { items.forEach(c => c.checked = this.checked); };
    }
    if (approveBtn) {
        approveBtn.onclick = async function () {
            const ids = [];
            document.querySelectorAll(".pending-adj-chk:checked").forEach(c => ids.push(c.getAttribute("data-id")));
            if (ids.length === 0) { Swal.fire('No Selection', 'Check at least one item.', 'warning'); return; }
            const c = await Swal.fire({ title: 'Batch Approve', text: `Approve ${ids.length} adjustment(s)?`, icon: 'question', showCancelButton: true, confirmButtonColor: '#198754', confirmButtonText: 'Approve' });
            if (!c.isConfirmed) return;
            LoadingManager.show(approveBtn, { text: 'Approving...' });
            try {
                const r = await authenticatedFetch("/backend/admin/manageInventory/batch_approve_adjustments.php", {
                    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ adjustment_ids: ids })
                });
                const data = await r.json();
                if (data.status === 'success') {
                    Swal.fire('Approved!', data.message, 'success').then(() => location.reload());
                } else { Swal.fire('Error', data.message, 'error'); }
            } catch (err) { console.error(err); Swal.fire('Error', 'Server error.', 'error'); }
            finally { LoadingManager.hide(approveBtn); }
        };
    }
}

function showAdjustmentDetailsSwal(id) {
    const item = allAdjustmentRecords.find(r => String(r.adjustment_id) === String(id));
    if (!item) { Swal.fire('Error', 'Record not found.', 'error'); return; }
    const status = (item.status || 'Pending').toUpperCase();
    Swal.fire({
        title: 'Adjustment Details',
        html: `<div class="text-start px-2" style="font-size:0.9rem;">
            <table class="table table-sm table-borderless">
                <tr><td class="text-muted">Material:</td><td class="fw-bold">${item.raw_material_name}</td></tr>
                <tr><td class="text-muted">Type:</td><td>${item.adjustment_type === 'ADD' ? 'ADD (+)' : 'REMOVE (-)'}</td></tr>
                <tr><td class="text-muted">Quantity:</td><td>${item.quantity} ${item.unit || ''}</td></tr>
                <tr><td class="text-muted">Reason:</td><td>${item.reason || '—'}</td></tr>
                <tr><td class="text-muted">Date:</td><td>${new Date(item.adjustment_date).toLocaleDateString()}</td></tr>
                <tr><td class="text-muted">By:</td><td>${item.adjusted_by || 'System'}</td></tr>
                <tr><td class="text-muted">Status:</td><td><span class="badge ${status === 'APPROVED' ? 'bg-success' : status === 'PENDING' ? 'bg-warning text-dark' : 'bg-danger'}">${item.status || 'Pending'}</span></td></tr>
            </table></div>`,
        icon: status === 'APPROVED' ? 'success' : status === 'PENDING' ? 'info' : 'error',
        confirmButtonText: 'Close'
    });
}

function checkStockAlerts(materialsList) {
    const badge = document.getElementById('notificationBadge');
    const menu = document.getElementById('notificationMenu');
    if (!menu || !badge || !Array.isArray(materialsList)) return;
    let alerts = [];
    materialsList.forEach(m => {
        const qty = parseFloat(m.current_quantity);
        const rl = parseFloat(m.reorder_level);
        if (!isNaN(qty) && !isNaN(rl)) {
            if (qty <= 0) alerts.push({ text: `⚠️ <strong>${m.raw_material_name}</strong> is out of stock!`, critical: true });
            else if (qty <= rl) alerts.push({ text: `⚠️ <strong>${m.raw_material_name}</strong> is low (${qty} ${m.unit || 'pcs'})`, critical: false });
        }
    });
    menu.innerHTML = '<li class="dropdown-header border-bottom fw-bold text-dark">Stock Alerts</li>';
    if (alerts.length > 0) {
        alerts.forEach(a => { menu.innerHTML += `<li><a class="dropdown-item py-2 border-bottom text-wrap" href="manage_inventory.html"><div style="color:${a.critical ? '#dc3545' : '#b57d00'};">${a.text}</div></a></li>`; });
        badge.textContent = alerts.length; badge.classList.remove('d-none');
    } else { badge.classList.add('d-none'); menu.innerHTML += `<li><span class="dropdown-item text-muted text-center py-3">✅ All normal.</span></li>`; }
}