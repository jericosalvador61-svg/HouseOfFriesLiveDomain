// ==========================================
// STOCK OUT - Admin Module
// Consistent flow: staging table → review modal → pending
// ==========================================
let selectedItems = [];
let allStockOutRecords = [];
let stockOutPage = 1;
let stockOutTotal = 0;

function renderAdminStockOutPager() {
    const pagerEl = document.getElementById('stockOutPager');
    if (!pagerEl) return;
    const pages = Math.max(1, Math.ceil(stockOutTotal / 10));
    let html = '';
    for (let i = 1; i <= pages; i++) {
        html += `<li class="page-item ${i === stockOutPage ? 'active' : ''}"><a class="page-link" href="#" data-page="${i}">${i}</a></li>`;
    }
    pagerEl.innerHTML = html;
    pagerEl.querySelectorAll('a[data-page]').forEach(a => {
        a.addEventListener('click', e => {
            e.preventDefault();
            stockOutPage = parseInt(a.dataset.page, 10);
            fetchStockOutHistory();
        });
    });
}

document.addEventListener('DOMContentLoaded', function () {
    fetchInventoryStats();
    fetchStockOutHistory();
    populateMaterialDropdown();

    document.getElementById('addOutItemBtn').addEventListener('click', addItemToList);
    document.getElementById('stockOutForm').addEventListener('submit', handleStockOutSubmit);

    const dateInput = document.getElementById('stockOutDateDefault');
    if (dateInput) dateInput.valueAsDate = new Date();
});

function authenticatedFetch(url, options = {}) {
    const token = localStorage.getItem('hof_token');
    if (!options.headers) options.headers = {};
    options.headers['Authorization'] = `Bearer ${token}`;
    return fetch(url, options).then(response => {
        if (response.status === 401) {
            Swal.fire("Unauthorized", "Your session expired. Please log back in.", "error");
            throw new Error("Unauthorized (401)");
        }
        return response;
    });
}

function fetchInventoryStats() {
    authenticatedFetch("/backend/admin/manageInventory/get_materials.php")
        .then(r => r.json())
        .then(result => {
            if (result.status === 'success') {
                updateCount('totalItems', result.stats?.total);
                updateCount('lowStock', result.stats?.low);
                updateCount('outStock', result.stats?.out);
                updateCount('damagedStock', result.stats?.damaged);
                checkStockAlerts(result.data);
            }
        })
        .catch(err => console.error('Stats fetch error:', err));
}

function updateCount(id, value) {
    const el = document.getElementById(id);
    if (el) { el.textContent = value ?? 0; el.classList.add('fw-bold'); }
}

function populateMaterialDropdown() {
    authenticatedFetch("/backend/admin/manageInventory/get_materials.php")
        .then(r => r.json())
        .then(result => {
            if (result.status === 'success') {
                const dd = document.getElementById('outTempMaterial');
                if (!dd) return;
                dd.innerHTML = '<option value="" selected disabled>Choose Material...</option>';
                result.data.forEach(m => {
                    const stock = parseFloat(m.current_quantity);
                    const sd = stock <= 0 ? '(Out of Stock)' : `(${stock} ${m.unit} available)`;
                    dd.innerHTML += `<option value="${m.raw_material_id}" data-name="${m.raw_material_name}" data-unit="${m.unit}" data-stock="${stock}">${m.raw_material_name} ${sd}</option>`;
                });
            }
        })
        .catch(err => console.error('Dropdown error:', err));
}

function addItemToList() {
    const dd = document.getElementById('outTempMaterial');
    const qtyInput = document.getElementById('outTempQty');
    const materialId = dd.value;
    const qty = parseFloat(qtyInput.value);

    if (!materialId || isNaN(qty) || qty <= 0) {
        Swal.fire('Error', 'Select a material and enter a valid quantity.', 'error');
        return;
    }

    const opt = dd.options[dd.selectedIndex];
    const maxStock = parseFloat(opt.getAttribute('data-stock'));
    const name = opt.getAttribute('data-name');
    const unit = opt.getAttribute('data-unit');

    if (maxStock <= 0) {
        Swal.fire('Out of Stock', `${name} is unavailable.`, 'error');
        return;
    }

    // Duplicate detection (like Stock In)
    const exists = selectedItems.find(i => i.id === materialId);
    if (exists) {
        Swal.fire({
            title: 'Already Added',
            text: `"${name}" is already in your list. Combine quantities?`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Yes, merge!',
            cancelButtonText: 'No, keep separate'
        }).then(result => {
            if (result.isConfirmed) {
                const totalQty = parseFloat(exists.quantity) + qty;
                if (totalQty > maxStock) {
                    Swal.fire('Limit Reached', `Only ${maxStock} ${unit} available.`, 'warning');
                    return;
                }
                exists.quantity = totalQty;
                renderSelectedItemsTable();
                clearInputs();
            }
        });
        return;
    }

    if (qty > maxStock) {
        Swal.fire('Invalid Quantity', `Only ${maxStock} ${unit} available.`, 'error');
        return;
    }

    selectedItems.push({ id: materialId, name, quantity: qty, unit, maxStock });
    clearInputs();
    renderSelectedItemsTable();
}

function clearInputs() {
    document.getElementById('outTempMaterial').value = '';
    document.getElementById('outTempQty').value = '';
}

function renderSelectedItemsTable() {
    const container = document.getElementById('stockOutTableContainer');
    const tbody = document.getElementById('stockOutItemBody');
    if (!tbody || !container) return;
    container.classList.toggle('d-none', selectedItems.length === 0);
    tbody.innerHTML = '';
    selectedItems.forEach((item, i) => {
        tbody.innerHTML += `
            <tr>
                <td><div class="fw-bold">${item.name}</div><small class="text-muted">Available: ${item.maxStock} ${item.unit}</small></td>
                <td>
                    <div class="input-group input-group-sm" style="width: 120px;">
                        <button class="btn btn-outline-secondary" type="button" onclick="updateQty(${i}, -1)">-</button>
                        <input type="text" class="form-control text-center bg-light" value="${item.quantity}" readonly>
                        <button class="btn btn-outline-secondary" type="button" onclick="updateQty(${i}, 1)">+</button>
                    </div>
                </td>
                <td class="text-center"><button type="button" class="btn btn-sm btn-outline-danger" onclick="removeItem(${i})"><i class="bi bi-trash"></i></button></td>
            </tr>`;
    });
}

window.updateQty = function (index, change) {
    const item = selectedItems[index];
    const newQty = item.quantity + change;
    if (newQty <= 0) { removeItem(index); return; }
    if (newQty > item.maxStock) {
        Swal.fire('Limit Reached', `Only ${item.maxStock} ${item.unit} available.`, 'warning');
        return;
    }
    item.quantity = newQty;
    renderSelectedItemsTable();
};

window.removeItem = function (index) {
    selectedItems.splice(index, 1);
    renderSelectedItemsTable();
};

// ==========================================
// REVIEW MODAL (like Stock In)
// ==========================================
function handleStockOutSubmit(e) {
    e.preventDefault();
    if (selectedItems.length === 0) {
        Swal.fire('Empty List', 'Add at least one item first.', 'warning');
        return;
    }

    // Build review HTML
    let itemsHtml = selectedItems.map(item => `
        <tr>
            <td class="fw-bold">${item.name}</td>
            <td>${item.quantity} ${item.unit}</td>
            <td>${item.maxStock} ${item.unit}</td>
        </tr>
    `).join('');

    const date = document.getElementById('stockOutDateDefault')?.value || 'N/A';
    const remarks = document.querySelector('textarea[name="remarks"]')?.value || '';

    Swal.fire({
        title: 'Review Stock Out',
        html: `
            <div class="text-start">
                <table class="table table-sm table-borderless mb-2">
                    <tr><td class="text-muted">Date:</td><td class="fw-bold">${date}</td></tr>
                    <tr><td class="text-muted">Remarks:</td><td class="fw-bold">${remarks || '—'}</td></tr>
                </table>
                <hr>
                <h6 class="fw-bold">Items to be deducted:</h6>
                <div class="table-responsive" style="max-height:200px;overflow-y:auto;">
                    <table class="table table-sm table-bordered">
                        <thead class="table-light"><tr><th>Material</th><th>Qty Out</th><th>Available</th></tr></thead>
                        <tbody>${itemsHtml}</tbody>
                    </table>
                </div>
            </div>`,
        icon: 'info',
        showCancelButton: true,
        confirmButtonColor: '#dc3545',
        confirmButtonText: '<i class="bi bi-check-lg"></i> Confirm Stock Out',
        cancelButtonText: 'Cancel',
        width: '550px'
    }).then(result => {
        if (!result.isConfirmed) return;

        const submitBtn = document.getElementById('stockOutForm').querySelector('button[type="submit"]');
        LoadingManager.show(submitBtn || document.getElementById('stockOutForm'), { text: 'Submitting stock out...' });

        const payload = {
            date: date,
            remarks: remarks,
            items: selectedItems
        };

        authenticatedFetch('/backend/admin/manageInventory/add_stock_out.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
            .then(r => r.json())
            .then(result => {
                if (result.status === 'success' || result.success) {
                    Swal.fire('Success', 'Stock out recorded as pending!', 'success').then(() => location.reload());
                } else {
                    Swal.fire('Error', result.message || 'Failed to process.', 'error');
                }
            })
            .catch(err => {
                console.error('Submit error:', err);
                Swal.fire('Error', 'Server connection failed.', 'error');
            })
            .finally(() => LoadingManager.hide(submitBtn || document.getElementById('stockOutForm')));
    });
}

// ==========================================
// HISTORY LOAD
// ==========================================
function fetchStockOutHistory() {
    const mainTbody = document.getElementById('stockoutTableBody');
    const pendingTbody = document.querySelector('.pending-table-card tbody');
    const pendingBadge = document.querySelector('.pending-table-card .badge');
    const pendingCard = document.querySelector('.pending-table-card');
    if (!mainTbody) return;

    authenticatedFetch("/backend/admin/manageInventory/get_stock_out_history.php?page=" + stockOutPage)
        .then(r => r.json())
        .then(result => {
            if (result.status === 'success' || result.success) {
                const raw = Array.isArray(result.data) ? result.data : [];
                allStockOutRecords = raw;
                stockOutTotal = (result.pagination && result.pagination.total) || raw.length;
                renderAdminStockOutPager();
                const approved = raw.filter(r => (r.status || '').toLowerCase() !== 'pending');
                const pending = raw.filter(r => (r.status || '').toLowerCase() === 'pending');

                mainTbody.innerHTML = approved.length === 0
                    ? `<tr><td colspan="5" class="text-center py-4 text-muted">No completed stock out history found.</td></tr>`
                    : approved.map(row => `
                        <tr>
                            <td class="ps-4 fw-semibold">${row.raw_material_name}</td>
                            <td>${row.quantity} ${row.unit}</td>
                            <td>${formatDate(row.stock_out_date)}</td>
                            <td><span class="badge bg-light text-dark border">${row.processor_name || 'Admin'}</span></td>
                            <td><button type="button" class="btn btn-sm btn-primary view-stockout-btn" data-id="${row.stock_out_id || ''}"><i class="bi bi-eye"></i></button></td>
                        </tr>`).join('');

                if (pendingBadge) pendingBadge.textContent = pending.length;
                setupPendingOutCardHeaders(pendingCard, pending.length);

                if (pending.length > 0 && pendingTbody) {
                    pendingTbody.innerHTML = pending.map(item => `
                        <tr>
                            <td class="ps-3 py-2" style="width:40px;"><input type="checkbox" class="form-check-input pending-out-chk" data-id="${item.stock_out_id}"></td>
                            <td class="py-2"><div class="fw-bold text-dark">${item.raw_material_name}</div><small class="text-muted">Qty: ${item.quantity} ${item.unit || ''} | By: ${item.processor_name || 'Staff'}</small></td>
                            <td class="text-end pe-3"><button type="button" class="btn btn-sm btn-primary view-stockout-btn" data-id="${item.stock_out_id}"><i class="bi bi-eye"></i></button></td>
                        </tr>`).join('');
                    document.getElementById("pendingOutActionFooter")?.classList.remove("d-none");
                } else if (pendingTbody) {
                    pendingTbody.innerHTML = `<tr><td colspan="3" class="text-center py-4 text-muted small"><i class="bi bi-check-circle text-success d-block mb-1 fs-4"></i>No pending stock outs.</td></tr>`;
                    document.getElementById("pendingOutActionFooter")?.classList.add("d-none");
                }

                document.querySelectorAll('.view-stockout-btn').forEach(btn => {
                    btn.addEventListener('click', function () {
                        const id = this.getAttribute('data-id');
                        showStockOutDetailsSwal(id);
                    });
                });
                initBatchStockOutListeners();
            }
        })
        .catch(err => console.error('History fetch error:', err));
}

function setupPendingOutCardHeaders(cardEl, pendingCount) {
    if (!cardEl) return;
    let header = document.getElementById("selectAllPendingOutHeader");
    if (!header && pendingCount > 0) {
        const ch = cardEl.querySelector(".card-header") || cardEl;
        const div = document.createElement("div");
        div.id = "selectAllPendingOutHeader";
        div.className = "d-flex align-items-center mt-2 pt-2 border-top";
        div.innerHTML = `<input type="checkbox" id="selectAllPendingOutChk" class="form-check-input me-2 ms-1"><label for="selectAllPendingOutChk" class="small fw-bold text-secondary" style="cursor:pointer;">Select All</label>`;
        ch.appendChild(div);
    } else if (header && pendingCount === 0) header.remove();
    let footer = document.getElementById("pendingOutActionFooter");
    if (!footer && cardEl) {
        const f = document.createElement("div");
        f.id = "pendingOutActionFooter";
        f.className = "card-footer bg-white d-none py-2 text-end border-top-0";
        f.innerHTML = `<button type="button" id="approveSelectedOutBtn" class="btn btn-sm btn-success w-100 fw-bold py-2"><i class="bi bi-check2-all me-1"></i> Approve Selected</button>`;
        cardEl.appendChild(f);
    }
}

function initBatchStockOutListeners() {
    const selectAll = document.getElementById("selectAllPendingOutChk");
    const items = document.querySelectorAll(".pending-out-chk");
    const approveBtn = document.getElementById("approveSelectedOutBtn");
    if (selectAll) {
        selectAll.checked = false;
        selectAll.onchange = function () { items.forEach(c => c.checked = this.checked); };
    }
    if (approveBtn) {
        approveBtn.onclick = async function () {
            const ids = [];
            document.querySelectorAll(".pending-out-chk:checked").forEach(c => ids.push(c.getAttribute("data-id")));
            if (ids.length === 0) { Swal.fire('No Selection', 'Check at least one item.', 'warning'); return; }
            const c = await Swal.fire({ title: 'Batch Approval', text: `Approve ${ids.length} stock out(s)?`, icon: 'question', showCancelButton: true, confirmButtonColor: '#198754', confirmButtonText: 'Yes, Approve!' });
            if (!c.isConfirmed) return;
            LoadingManager.show(approveBtn, { text: 'Approving...' });
            try {
                const r = await authenticatedFetch("/backend/admin/manageInventory/batch_approve_stock_out.php", {
                    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stock_out_ids: ids })
                });
                const data = await r.json();
                if (data.status === 'success' || data.success) {
                    Swal.fire('Approved!', data.message || 'Batch approved.', 'success').then(() => location.reload());
                } else { Swal.fire('Error', data.message, 'error'); }
            } catch (err) { console.error(err); Swal.fire('Error', 'Server error.', 'error'); }
            finally { LoadingManager.hide(approveBtn); }
        };
    }
}

function showStockOutDetailsSwal(id) {
    const item = allStockOutRecords.find(r => String(r.stock_out_id) === String(id));
    if (!item) { Swal.fire('Error', 'Record not found.', 'error'); return; }
    const status = (item.status || 'Pending').toUpperCase();
    Swal.fire({
        title: 'Stock Out Details',
        html: `<div class="text-start px-2" style="font-size:0.9rem;">
            <table class="table table-sm table-borderless">
                <tr><td class="text-muted">Material:</td><td class="fw-bold">${item.raw_material_name}</td></tr>
                <tr><td class="text-muted">Quantity:</td><td class="fw-bold">${item.quantity} ${item.unit || ''}</td></tr>
                <tr><td class="text-muted">Date:</td><td>${formatDate(item.stock_out_date)}</td></tr>
                <tr><td class="text-muted">Processed By:</td><td>${item.processor_name || 'Admin'}</td></tr>
                <tr><td class="text-muted">Remarks:</td><td>${item.remarks || '—'}</td></tr>
                <tr><td class="text-muted">Status:</td><td><span class="badge ${status === 'APPROVED' ? 'bg-success' : status === 'PENDING' ? 'bg-warning text-dark' : 'bg-danger'}">${item.status || 'Pending'}</span></td></tr>
            </table></div>`,
        icon: status === 'APPROVED' ? 'success' : status === 'PENDING' ? 'info' : 'error',
        confirmButtonText: 'Close'
    });
}

function formatDate(d) {
    if (!d) return 'N/A';
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
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
        badge.textContent = alerts.length;
        badge.classList.remove('d-none');
    } else {
        badge.classList.add('d-none');
        menu.innerHTML += `<li><span class="dropdown-item text-muted text-center py-3">✅ All normal.</span></li>`;
    }
}