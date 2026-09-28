let inventoryMaterials = [];
let allAdjustmentRecords = []; // Global cache placeholder for filtering datasets

// Live DOM Filter Elements
let searchInput, statusFilter, dateFilter, historyBody;

document.addEventListener('DOMContentLoaded', function () {
    // Set default date to today safely adjusting for local timezone offsets
    const dateInput = document.getElementById('adjDateDefault');
    if (dateInput) {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        dateInput.value = `${year}-${month}-${day}`;
    }

    // Initialize DOM references
    searchInput = document.getElementById("searchInventory");
    statusFilter = document.getElementById("filterStatus");
    dateFilter = document.getElementById("filterDate");
    historyBody = document.getElementById('adjustmentsTableBody');

    loadInitialData();
    setupFilterListeners();

    document.getElementById('addAdjRow').addEventListener('click', transferToTable);
    document.getElementById('adjustmentForm').addEventListener('submit', handleAdjustmentSubmit);
});

// Helper function to dynamically grab token for header requests
function getAuthHeaders(contentType = "application/json") {
    const token = localStorage.getItem("hof_token");
    const headers = { "Authorization": `Bearer ${token}` };
    if (contentType) {
        headers["Content-Type"] = contentType;
    }
    return headers;
}

// ==========================================
// FILTER ATTRIBUTION EVENT LISTENERS
// ==========================================
function setupFilterListeners() {
    if (searchInput) searchInput.addEventListener("input", applyAdjustmentFilters);
    if (statusFilter) statusFilter.addEventListener("change", applyAdjustmentFilters);
    if (dateFilter) dateFilter.addEventListener("change", applyAdjustmentFilters);
}

function applyAdjustmentFilters() {
    if (!allAdjustmentRecords || allAdjustmentRecords.length === 0) return;

    const searchValue = searchInput ? searchInput.value.toLowerCase().trim() : "";
    const statusValue = statusFilter ? statusFilter.value : "";
    const dateValue = dateFilter ? dateFilter.value : "";

    const filtered = allAdjustmentRecords.filter(row => {
        const matchesSearch = row.raw_material_name.toLowerCase().includes(searchValue);

        const currentStatus = (row.status || "Approved").toLowerCase();
        let matchesStatus = false;

        if (statusValue === "") {
            matchesStatus = true;
        } else if (statusValue === "in" && currentStatus === "approved") {
            matchesStatus = true;
        } else if (statusValue === "low" && currentStatus === "pending") {
            matchesStatus = true;
        } else if (statusValue === "out" && (currentStatus === "rejected" || currentStatus === "cancelled")) {
            matchesStatus = true;
        }

        const pureRecordDate = row.adjustment_date ? row.adjustment_date.split(" ")[0] : "";
        const matchesDate = dateValue === "" || pureRecordDate === dateValue;

        return matchesSearch && matchesStatus && matchesDate;
    });

    renderAdjustmentRowsHTML(filtered);
}

// ==========================================
// CORE DATA FETCH: INITIAL LOAD
// ==========================================
async function loadInitialData() {
    try {
        // 🔑 FIX: Securely pass token context to materials query
        const response = await fetch("/backend/inventoryStaff/adjustment/get_materials.php", {
            method: "GET",
            headers: getAuthHeaders(null)
        });
        const result = await response.json();

        if (result.status === 'success' || result.success) {
            inventoryMaterials = result.data;
            populateDropdown(document.getElementById('mainMaterialSelect'));

            checkStockAlerts(inventoryMaterials);

            if (result.stats) {
                updateQuickStatsFromBackend(result.stats);
            } else {
                updateQuickStats(inventoryMaterials);
            }
        }

        loadAdjustmentHistory();

    } catch (err) {
        console.error("Failed to load initial data:", err);
    }
}

async function loadAdjustmentHistory() {
    if (!historyBody) return;

    try {
        // 🔑 FIX: Securely pass token context to history query
        const response = await fetch("/backend/inventoryStaff/adjustment/get_adjustment_history.php", {
            method: "GET",
            headers: getAuthHeaders(null)
        });
        const result = await response.json();

        if (result.status === 'success' || result.success) {
            allAdjustmentRecords = result.data || [];
            renderAdjustmentRowsHTML(allAdjustmentRecords);
        }
    } catch (err) {
        console.error("Failed to load history:", err);
    }
}

// ==========================================
// RENDER ADJUSTMENT LOG RUNTIME DATA
// ==========================================
function renderAdjustmentRowsHTML(dataArray) {
    if (!historyBody) return;

    if (!dataArray || dataArray.length === 0) {
        historyBody.innerHTML = `<tr><td colspan="7" class="text-center py-5 text-muted">No matching adjustment records found.</td></tr>`;
        return;
    }

    historyBody.innerHTML = '';

    dataArray.forEach(row => {
        const typeBadge = row.adjustment_type === 'ADD'
            ? `<span class="text-success fw-bold">+${row.quantity}</span>`
            : `<span class="text-danger fw-bold">-${row.quantity}</span>`;

        const statusText = row.status || 'Pending';
        let badgeClass = 'bg-warning text-dark';

        if (statusText.toLowerCase() === 'approved') {
            badgeClass = 'bg-success text-white';
        } else if (statusText.toLowerCase() === 'cancelled' || statusText.toLowerCase() === 'rejected') {
            badgeClass = 'bg-danger text-white';
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="ps-4">
                <div class="fw-bold">${row.raw_material_name}</div>
                <small class="text-muted">${row.unit}</small>
            </td>
            <td>${typeBadge}</td>
            <td><span class="text-truncate d-inline-block" style="max-width: 150px;" title="${row.reason}">${row.reason}</span></td>
            <td>${formatDate(row.adjustment_date)}</td>
            <td>
                <div class="d-flex align-items-center">
                    <div class="avatar-xs me-2 bg-light rounded-circle text-center" style="width:24px; height:24px; line-height:24px;">
                        <i class="bi bi-person small"></i>
                    </div>
                    <span>${row.adjusted_by || 'System'}</span>
                </div>
            </td>
            <td>
                <span class="badge ${badgeClass}">${statusText}</span>
            </td>
            <td>
                <button type="button" class="btn btn-sm btn-primary view-adjustment-btn" data-id="${row.adjustment_id || ''}">
                    <i class="bi bi-eye"></i>
                </button>
            </td>
        `;
        historyBody.appendChild(tr);

        document.querySelectorAll('.view-adjustment-btn').forEach(btn => {
            btn.addEventListener('click', function () {
                const id = this.getAttribute('data-id');
                showAdjustmentDetailsSwal(id);
            });
        });
    });
}

function formatDate(dateString) {
    if (!dateString) return "N/A";
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function populateDropdown(selectElement) {
    if (!selectElement) return;
    selectElement.innerHTML = '<option value="" disabled selected>Choose a material to adjust...</option>';

    inventoryMaterials.forEach(item => {
        const stock = parseFloat(item.current_quantity);
        const batchSum = parseFloat(item.available_batch_sum) || stock;
        const truth = Math.min(stock, batchSum);
        const diff = Math.abs(stock - batchSum) > 0.001;
        const suffix = diff ? ' (inconsistent)' : '';
        const opt = document.createElement('option');
        opt.value = item.raw_material_id;
        opt.dataset.name = item.raw_material_name;
        opt.dataset.unit = item.unit;
        opt.textContent = `${item.raw_material_name} (Stock: ${truth} ${item.unit}${suffix})`;
        selectElement.appendChild(opt);
    });
}

function transferToTable() {
    const mainSelect = document.getElementById('mainMaterialSelect');
    const mainQtyInput = document.getElementById('mainQty');

    if (!mainSelect.value) {
        Swal.fire({ title: 'Note', text: 'Please select a material first.', icon: 'info', confirmButtonColor: '#FFB800' });
        return;
    }

    const materialId = mainSelect.value;
    const existingRows = document.querySelectorAll('#adjItemBody tr');
    let isDuplicate = false;
    existingRows.forEach(row => {
        if (row.dataset.id === materialId) isDuplicate = true;
    });

    if (isDuplicate) {
        Swal.fire({ title: 'Already Added', text: 'This item is already in your list.', icon: 'warning', confirmButtonColor: '#FFB800' });
        return;
    }

    const selectedOption = mainSelect.options[mainSelect.selectedIndex];
    const materialName = selectedOption.dataset.name;
    const materialUnit = selectedOption.dataset.unit;
    const quantity = mainQtyInput.value;

    const container = document.getElementById('adjTableContainer');
    const tbody = document.getElementById('adjItemBody');
    container.classList.remove('d-none');

    const row = document.createElement('tr');
    row.dataset.id = materialId;
    row.innerHTML = `
        <td class="fw-bold text-dark">
            ${materialName} <br>
            <small class="text-muted">Unit: ${materialUnit}</small>
        </td>
        <td>
            <div class="input-group input-group-sm" style="width: 130px;">
                <button class="btn btn-outline-secondary btn-minus" type="button">-</button>
                <input type="number" class="form-control text-center item-qty fw-bold" value="${quantity}" min="1">
                <button class="btn btn-outline-secondary btn-plus" type="button">+</button>
            </div>
        </td>
        <td class="text-end">
            <button type="button" class="btn btn-outline-danger btn-sm remove-row-btn">
                <i class="bi bi-trash"></i>
            </button>
        </td>
    `;

    tbody.appendChild(row);

    const rowQtyInput = row.querySelector('.item-qty');
    row.querySelector('.btn-plus').addEventListener('click', () => rowQtyInput.value = parseInt(rowQtyInput.value) + 1);
    row.querySelector('.btn-minus').addEventListener('click', () => {
        if (parseInt(rowQtyInput.value) > 1) rowQtyInput.value = parseInt(rowQtyInput.value) - 1;
    });

    row.querySelector('.remove-row-btn').addEventListener('click', () => {
        row.remove();
        if (tbody.children.length === 0) container.classList.add('d-none');
    });

    mainSelect.value = "";
    mainQtyInput.value = 1;
}

function updateQuickStats(materials) {
    let low = 0, out = 0;
    materials.forEach(item => {
        const qty = parseFloat(item.current_quantity);
        if (qty <= 0) out++;
        else if (qty <= (parseFloat(item.reorder_level) || 10)) low++;
    });

    setStatValue('totalItems', materials.length);
    setStatValue('lowStock', low);
    setStatValue('outStock', out);
}

function updateQuickStatsFromBackend(stats) {
    setStatValue('totalItems', stats.total);
    setStatValue('lowStock', stats.low);
    setStatValue('outStock', stats.out);
    setStatValue('damagedStock', stats.damaged);
}

function setStatValue(elementId, value) {
    const el = document.getElementById(elementId);
    if (el) {
        el.textContent = value;
        el.classList.add('fw-bold');
    }
}

async function handleAdjustmentSubmit(e) {
    e.preventDefault();

    const submitBtn = document.getElementById('adjustmentForm').querySelector('button[type="submit"]');
    LoadingManager.show(submitBtn || document.getElementById('adjustmentForm'), { text: 'Processing...' });

    const adjustmentData = {
        type: document.getElementById('adjType').value,
        date: document.getElementById('adjDateDefault').value,
        reason: document.getElementById('adjReason').value,
        items: []
    };

    const rows = document.querySelectorAll('#adjItemBody tr');
    rows.forEach(row => {
        adjustmentData.items.push({
            raw_material_id: row.dataset.id,
            quantity: row.querySelector('.item-qty').value
        });
    });

    const mainMatId = document.getElementById('mainMaterialSelect').value;
    if (mainMatId) {
        const alreadyInItems = adjustmentData.items.some(item => item.raw_material_id === mainMatId);
        if (!alreadyInItems) {
            adjustmentData.items.push({
                raw_material_id: mainMatId,
                quantity: document.getElementById('mainQty').value
            });
        }
    }

    if (adjustmentData.items.length === 0) {
        Swal.fire({ title: 'Error', text: 'Please add at least one material to adjust.', icon: 'error', confirmButtonColor: '#FFB800' });
        return;
    }

    try {
        // 🔑 FIX: Attached Bearer token configurations to headers mapping
        const response = await fetch('/backend/inventoryStaff/adjustment/process_adjustments.php', {
            method: 'POST',
            headers: getAuthHeaders('application/json'),
            body: JSON.stringify(adjustmentData)
        });

        const result = await response.json();

        if (result.status === 'success' || result.success) {
            await Swal.fire({
                icon: 'success',
                title: 'Adjustment Requested!',
                text: 'Adjustment logged and waiting for admin approval.',
                confirmButtonColor: '#FFB800',
                timer: 2000,
                showConfirmButton: false
            });
            location.reload();
        } else {
            Swal.fire({ title: 'Process Failed', text: result.message, icon: 'error', confirmButtonColor: '#FFB800' });
        }
    } catch (err) {
        console.error("Submission error:", err);
        Swal.fire({ title: 'Server Error', text: 'Check database connections.', icon: 'error', confirmButtonColor: '#FFB800' });
    } finally {
        LoadingManager.hide(submitBtn || document.getElementById('adjustmentForm'));
    }
}

// ==========================================
// NOTIFICATION LIVE ALERTS COMPILER
// ==========================================
function checkStockAlerts(materialsList) {
    const badge = document.getElementById('notificationBadge');
    const menu = document.getElementById('notificationMenu');
    if (!menu || !badge || !Array.isArray(materialsList)) return;

    let activeAlerts = [];

    materialsList.forEach(material => {
        const qty = parseFloat(material.current_quantity);
        const reorderLevel = parseFloat(material.reorder_level);

        let alertText = "";
        let isCritical = false;

        if (!isNaN(qty) && !isNaN(reorderLevel)) {
            if (qty <= 0) {
                alertText = `⚠️ <strong>${material.raw_material_name}</strong> is completely out of stock! Restock immediately.`;
                isCritical = true;
            } else if (qty <= reorderLevel) {
                alertText = `⚠️ <strong>${material.raw_material_name}</strong> is low on stock (${qty} ${material.unit || 'pcs'} left). Restock soon!`;
                isCritical = false;
            }
        }

        if (alertText) {
            activeAlerts.push({
                text: alertText,
                isCritical: isCritical,
                updatedAt: material.updated_at ? new Date(material.updated_at).getTime() : 0
            });
        }
    });

    menu.innerHTML = '<li class="dropdown-header border-bottom fw-bold text-dark py-2">Stock Alerts</li>';

    if (activeAlerts.length > 0) {
        activeAlerts.sort((a, b) => b.updatedAt - a.updatedAt);

        activeAlerts.forEach(alert => {
            menu.innerHTML += `
                <li>
                    <a class="dropdown-item py-2 border-bottom text-wrap" href="manage_inventory.html" style="font-size: 0.9rem;">
                        <div style="color: ${alert.isCritical ? '#dc3545' : '#b57d00'};">
                            ${alert.text}
                        </div>
                    </a>
                </li>`;
        });

        badge.textContent = activeAlerts.length;
        badge.classList.remove('d-none');
    } else {
        badge.classList.add('d-none');
        menu.innerHTML += `<li><span class="dropdown-item text-muted text-center py-3">✅ All inventory levels are normal.</span></li>`;
    }
}

function showAdjustmentDetailsSwal(id) {
    const item = allAdjustmentRecords.find(record => String(record.adjustment_id) === String(id));

    if (!item) {
        Swal.fire('Error', 'Could not locate adjustment record details locally.', 'error');
        return;
    }

    const adjustmentDate = item.adjustment_date ? formatDate(item.adjustment_date) : 'N/A';
    const approvedAt = item.approved_at && item.approved_at !== '0000-00-00 00:00:00' ? formatDate(item.approved_at) : 'N/A';

    const currentStatus = (item.status || 'Pending').toUpperCase();

    let approverDisplay = '<em>Awaiting Review</em>';
    if (currentStatus === 'APPROVED') {
        approverDisplay = item.approver_name || `Admin (ID: ${item.approved_by})`;
    } else if (currentStatus === 'REJECTED' || currentStatus === 'CANCELLED') {
        approverDisplay = item.approver_name || `Declined by Admin`;
    }

    const typeText = item.adjustment_type || 'N/A';
    const typeBadge = typeText.toUpperCase() === 'ADD'
        ? `<span class="badge bg-success-subtle text-success border border-success px-2 py-1">ADD</span>`
        : `<span class="badge bg-danger-subtle text-danger border border-danger px-2 py-1">REMOVE</span>`;

    const htmlContent = `
        <div class="table-responsive text-start px-2" style="font-size: 0.95rem;">
            <table class="table table-sm table-borderless align-middle my-2">
                <tbody>
                    <tr class="border-bottom py-2">
                        <td class="fw-bold text-muted w-50">Raw Material:</td>
                        <td class="text-dark fw-bold">${item.raw_material_name || 'N/A'}</td>
                    </tr>
                    <tr class="border-bottom py-2">
                        <td class="fw-bold text-muted">Quantity:</td>
                        <td class="text-dark fw-bold">${item.quantity || 0} ${item.unit || ''}</td>
                    </tr>
                    <tr class="border-bottom py-2">
                        <td class="fw-bold text-muted">Adjustment Type:</td>
                        <td class="text-dark">${typeBadge}</td>
                    </tr>
                    <tr class="border-bottom py-2">
                        <td class="fw-bold text-muted">Reason:</td>
                        <td class="text-dark text-wrap" style="max-width: 220px;">${item.reason || '<em>None</em>'}</td>
                    </tr>
                    <tr class="border-bottom py-2">
                        <td class="fw-bold text-muted">Adjusted By:</td>
                        <td class="text-dark">${item.adjusted_by || `User ID: ${item.user_id || 'N/A'}`}</td>
                    </tr>
                    <tr class="border-bottom py-2">
                        <td class="fw-bold text-muted">Adjustment Date:</td>
                        <td class="text-dark">${adjustmentDate}</td>
                    </tr>
                    <tr class="border-bottom py-2">
                        <td class="fw-bold text-muted">Approved By:</td>
                        <td class="text-dark fw-bold">${approverDisplay}</td>
                    </tr>
                    <tr class="border-bottom py-2">
                        <td class="fw-bold text-muted">Approved At:</td>
                        <td class="text-dark">${approvedAt}</td>
                    </tr>
                    <tr class="border-bottom py-2">
                        <td class="fw-bold text-muted">Approval Remarks:</td>
                        <td class="text-secondary text-wrap" style="max-width: 220px;">${item.approval_remarks || '<em>No remarks provided</em>'}</td>
                    </tr>
                    <tr>
                        <td class="fw-bold text-muted">Status:</td>
                        <td>
                            <span class="badge ${currentStatus === 'APPROVED' ? 'bg-success text-white' :
            (currentStatus === 'PENDING' ? 'bg-warning text-dark' : 'bg-danger text-white')
        }">${item.status || 'Pending'}</span>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    `;

    let titleIcon = 'info';
    if (currentStatus === 'APPROVED') titleIcon = 'success';
    if (currentStatus === 'REJECTED' || currentStatus === 'CANCELLED') titleIcon = 'error';

    Swal.fire({
        title: `Adjustment Reference Detail`,
        html: htmlContent,
        icon: titleIcon,
        confirmButtonText: 'Close Window',
        confirmButtonColor: '#FFB800',
        width: '520px',
        customClass: {
            popup: 'rounded-4 shadow-lg'
        }
    });
}