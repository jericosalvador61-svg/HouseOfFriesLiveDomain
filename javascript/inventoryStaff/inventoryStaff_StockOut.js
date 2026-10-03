// 1. GLOBAL STATE - Only declare once!
let selectedItems = [];
let allStockOutRecords = []; // Global cache placeholder for filtering datasets
let stockOutPage = 1;
let stockOutTotal = 0;

// Live DOM Filter Elements
let searchInput, statusFilter, dateFilter, historyBody;

function renderStockOutPager() {
    const pagerEl = document.getElementById("stockOutPager");
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
    // Initialize DOM references
    searchInput = document.getElementById("searchInventory");
    statusFilter = document.getElementById("filterStatus");
    dateFilter = document.getElementById("filterDate");
    historyBody = document.getElementById('stockoutTableBody');

    // Initial Load of Stats & Table Lists
    fetchInventoryStats();
    fetchStockOutHistory();
    setupFilterListeners();

    // Populate the "Select Material" dropdown
    populateMaterialDropdown();

    // Event listener for the "+ Add" button
    const addBtn = document.getElementById('addOutItemBtn');
    if (addBtn) {
        addBtn.addEventListener('click', addItemToList);
    }

    // Handle Form Submission
    const stockOutForm = document.getElementById('stockOutForm');
    if (stockOutForm) {
        stockOutForm.addEventListener('submit', handleStockOutSubmit);
    }

    // Set default date to today safely adjusting for local timezone offsets
    const dateInput = document.getElementById('stockOutDateDefault');
    if (dateInput) {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');

        dateInput.value = `${year}-${month}-${day}`;
    }
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
    if (searchInput) searchInput.addEventListener("input", applyStockOutFilters);
    if (statusFilter) statusFilter.addEventListener("change", applyStockOutFilters);
    if (dateFilter) dateFilter.addEventListener("change", applyStockOutFilters);
}

function applyStockOutFilters() {
    if (!allStockOutRecords || allStockOutRecords.length === 0) return;

    const searchValue = searchInput ? searchInput.value.toLowerCase().trim() : "";
    const statusValue = statusFilter ? statusFilter.value : "";
    const dateValue = dateFilter ? dateFilter.value : "";

    const filtered = allStockOutRecords.filter(row => {
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

        const pureRecordDate = row.stock_out_date ? row.stock_out_date.split(" ")[0] : "";
        const matchesDate = dateValue === "" || pureRecordDate === dateValue;

        return matchesSearch && matchesStatus && matchesDate;
    });

    renderHistoryRowsHTML(filtered);
}

// ==========================================
// CORE DATA FETCH: INVENTORY STATS
// ==========================================
function fetchInventoryStats() {
    // 🔑 FIX: Securely pass token context
    fetch("/backend/inventoryStaff/stockOut/get_materials.php", {
        method: "GET",
        headers: getAuthHeaders(null)
    })
        .then(response => {
            if (!response.ok) throw new Error('Network response was not ok');
            return response.json();
        })
        .then(result => {
            if (result.status === 'success' || result.success) {
                const stats = result.stats;
                updateCount('totalItems', stats.total);
                updateCount('lowStock', stats.low);
                updateCount('outStock', stats.out);
                updateCount('damagedStock', stats.damaged);

                checkStockAlerts(result.data);
            }
        })
        .catch(error => console.error('Error fetching inventory stats:', error));
}

function updateCount(elementId, value) {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = value;
        element.classList.add('fw-bold');
    }
}

/**
 * Populate the dropdown with materials and their current stock levels
 */
function populateMaterialDropdown() {
    // 🔑 FIX: Securely pass token context
    fetch("/backend/inventoryStaff/stockOut/get_materials.php", {
        method: "GET",
        headers: getAuthHeaders(null)
    })
        .then(response => response.json())
        .then(result => {
            if (result.status === 'success' || result.success) {
                const dropdown = document.getElementById('outTempMaterial');
                if (!dropdown) return;

                dropdown.innerHTML = '<option value="" selected disabled>Choose Material...</option>';
                result.data.forEach(material => {
                    const stock = parseFloat(material.current_quantity);
                    const batchSum = parseFloat(material.available_batch_sum) || stock;
                    const truth = Math.min(stock, batchSum);
                    const diff = Math.abs(stock - batchSum) > 0.001;
                    const suffix = diff ? ' (records inconsistent — verify with admin)' : '';
                    const stockDisplay = truth <= 0 ? '(Out of Stock)' : `(${truth} ${material.unit} available${suffix})`;

                    dropdown.innerHTML += `
                        <option value="${material.raw_material_id}" 
                                data-name="${material.raw_material_name}" 
                                data-unit="${material.unit}"
                                data-stock="${truth}">
                            ${material.raw_material_name} ${stockDisplay}
                        </option>`;
                });
            }
        })
        .catch(error => console.error('Error populating dropdown:', error));
}

/**
 * Adds an item to the list with duplication and stock validation
 */
function addItemToList() {
    const dropdown = document.getElementById('outTempMaterial');
    const qtyInput = document.getElementById('outTempQty');

    if (!dropdown || !qtyInput) return;

    const materialId = dropdown.value;
    const qty = parseFloat(qtyInput.value);

    if (!materialId || isNaN(qty) || qty <= 0) {
        Swal.fire({ title: 'Invalid Input', text: 'Please select a material and enter a valid quantity.', icon: 'warning', confirmButtonColor: '#FFB800' });
        return;
    }

    const selectedOption = dropdown.options[dropdown.selectedIndex];
    const maxStock = parseFloat(selectedOption.getAttribute('data-stock'));
    const materialName = selectedOption.getAttribute('data-name');
    const unit = selectedOption.getAttribute('data-unit');

    if (maxStock <= 0) {
        Swal.fire({ title: 'Out of Stock', text: `${materialName} is currently unavailable.`, icon: 'error', confirmButtonColor: '#FFB800' });
        return;
    }

    const exists = selectedItems.find(item => item.id === materialId);
    if (exists) {
        Swal.fire({ title: 'Duplicate Item', text: `${materialName} is already in the list. Edit the quantity below instead.`, icon: 'warning', confirmButtonColor: '#FFB800' });
        return;
    }

    if (qty > maxStock) {
        Swal.fire({ title: 'Invalid Quantity', text: `Only ${maxStock} ${unit} available.`, icon: 'error', confirmButtonColor: '#FFB800' });
        return;
    }

    selectedItems.push({
        id: materialId,
        name: materialName,
        quantity: qty,
        unit: unit,
        maxStock: maxStock
    });

    dropdown.value = "";
    qtyInput.value = "";
    renderSelectedItemsTable();
}

function renderSelectedItemsTable() {
    const container = document.getElementById('stockOutTableContainer');
    const tbody = document.getElementById('stockOutItemBody');
    if (!tbody || !container) return;

    container.classList.toggle('d-none', selectedItems.length === 0);
    tbody.innerHTML = "";

    selectedItems.forEach((item, index) => {
        tbody.innerHTML += `
            <tr>
                <td>
                    <div class="fw-bold">${item.name}</div>
                    <small class="text-muted">Available: ${item.maxStock} ${item.unit}</small>
                </td>
                <td>
                    <div class="input-group input-group-sm" style="width: 120px;">
                        <button class="btn btn-outline-secondary" type="button" onclick="updateQty(${index}, -1)">-</button>
                        <input type="text" class="form-control text-center bg-light" value="${item.quantity}" readonly>
                        <button class="btn btn-outline-secondary" type="button" onclick="updateQty(${index}, 1)">+</button>
                    </div>
                </td>
                <td class="text-center">
                    <button type="button" class="btn btn-sm btn-outline-danger" onclick="removeItem(${index})">
                        <i class="bi bi-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    });
}

window.updateQty = function (index, change) {
    const item = selectedItems[index];
    const newQty = item.quantity + change;

    if (newQty <= 0) {
        removeItem(index);
        return;
    }

    if (newQty > item.maxStock) {
        Swal.fire({ title: 'Limit Reached', text: `Only ${item.maxStock} ${item.unit} available in stock.`, icon: 'warning', confirmButtonColor: '#FFB800' });
        return;
    }

    item.quantity = newQty;
    renderSelectedItemsTable();
};

window.removeItem = function (index) {
    selectedItems.splice(index, 1);
    renderSelectedItemsTable();
};

function handleStockOutSubmit(e) {
    e.preventDefault();

    if (selectedItems.length === 0) {
        Swal.fire({ title: 'Empty List', text: 'Please add at least one item.', icon: 'warning', confirmButtonColor: '#FFB800' });
        return;
    }

    const submitBtn = document.getElementById('stockOutForm').querySelector('button[type="submit"]');
    LoadingManager.show(submitBtn || document.getElementById('stockOutForm'), { text: 'Submitting...' });

    const formData = {
        date: document.getElementById('stockOutDateDefault').value,
        remarks: document.querySelector('textarea[name="remarks"]').value,
        items: selectedItems
    };

    // 🔑 FIX: Configured Bearer token context into headers
    fetch('/backend/inventoryStaff/stockOut/process_stock_out.php', {
        method: 'POST',
        headers: getAuthHeaders('application/json'),
        body: JSON.stringify(formData)
    })
        .then(response => response.json())
        .then(result => {
            if (result.status === 'success' || result.success) {
                Swal.fire({ icon: 'success', title: 'Stock Out Submitted', text: 'Stock Out request submitted and waiting for admin approval.', confirmButtonColor: '#FFB800' }).then(() => {
                    location.reload();
                });
            } else {
                Swal.fire({ icon: 'error', title: 'Request Failed', text: result.message || 'Failed to process.', confirmButtonColor: '#FFB800' });
            }
        })
        .catch(error => console.error('Error submitting stock out:', error))
        .finally(() => LoadingManager.hide(submitBtn || document.getElementById('stockOutForm')));
}

// ==========================================
// FETCH AND RE-RENDER STOCK OUT RECORD DATA
// ==========================================
function fetchStockOutHistory() {
    if (!historyBody) return;

    // 🔑 FIX: Securely pass token context
    fetch("/backend/inventoryStaff/stockOut/get_stock_out_history.php?page=" + stockOutPage, {
        method: "GET",
        headers: getAuthHeaders(null)
    })
        .then(response => response.json())
        .then(result => {
            if (result.status === 'success' || result.success) {
                allStockOutRecords = result.data || [];
                stockOutTotal = (result.pagination && result.pagination.total) || allStockOutRecords.length;
                renderHistoryRowsHTML(allStockOutRecords);
                renderStockOutPager();
            }
        })
        .catch(error => console.error('Error fetching history:', error));
}

function renderHistoryRowsHTML(dataArray) {
    if (!historyBody) return;

    if (!dataArray || dataArray.length === 0) {
        historyBody.innerHTML = `<tr><td colspan="6" class="text-center py-5 text-muted">No matching stock out records found.</td></tr>`;
        return;
    }

    historyBody.innerHTML = '';
    dataArray.forEach(row => {
        const statusText = row.status || 'Approved';
        let badgeClass = 'bg-success text-white';

        if (statusText.toLowerCase() === 'pending') {
            badgeClass = 'bg-warning text-dark';
        } else if (statusText.toLowerCase() === 'cancelled' || statusText.toLowerCase() === 'rejected') {
            badgeClass = 'bg-danger text-white';
        }

        historyBody.innerHTML += `
            <tr>
                <td class="ps-4 fw-semibold">${row.raw_material_name}</td>
                <td>${row.quantity} ${row.unit || ''}</td>
                <td>${formatDate(row.stock_out_date)}</td>
                <td><span class="badge bg-light text-dark border">${row.processor_name || 'Staff'}</span></td>
                <td>
                    <span class="badge ${badgeClass}">${statusText}</span>
                </td>
                <td>
                    <button type="button" class="btn btn-sm btn-primary view-stockout-btn" data-id="${row.stock_out_id || ''}">
                        <i class="bi bi-eye"></i>
                    </button>
                </td>
            </tr>
        `;

        document.querySelectorAll('.view-stockout-btn').forEach(btn => {
            btn.addEventListener('click', function () {
                const id = this.getAttribute('data-id');
                showStockOutDetailsSwal(id);
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

function showStockOutDetailsSwal(id) {
    const item = allStockOutRecords.find(record => String(record.stock_out_id) === String(id));

    if (!item) {
        Swal.fire('Error', 'Could not locate stock out record details locally.', 'error');
        return;
    }

    const stockOutDate = item.stock_out_date ? formatDate(item.stock_out_date) : 'N/A';
    const approvedAt = item.approved_at && item.approved_at !== '0000-00-00 00:00:00' ? formatDate(item.approved_at) : 'N/A';

    const currentStatus = (item.status || 'Pending').toUpperCase();

    let approverDisplay = '<em>Awaiting Review</em>';
    if (currentStatus === 'APPROVED') {
        approverDisplay = item.approver_name || `Admin (ID: ${item.approved_by})`;
    } else if (currentStatus === 'REJECTED' || currentStatus === 'CANCELLED') {
        approverDisplay = item.approver_name || `Declined by Admin`;
    }

    const htmlContent = `
        <div class="table-responsive text-start px-2" style="font-size: 0.95rem;">
            <table class="table table-sm table-borderless align-middle my-2">
                <tbody>
                    <tr class="border-bottom py-2">
                        <td class="fw-bold text-muted w-50">Raw Material:</td>
                        <td class="text-dark fw-bold">${item.raw_material_name || 'N/A'} <small class="text-muted">(ID: ${item.raw_material_id || 'N/A'})</small></td>
                    </tr>
                    <tr class="border-bottom py-2">
                        <td class="fw-bold text-muted">Quantity:</td>
                        <td class="text-dark fw-bold">${item.quantity || 0} ${item.unit || ''}</td>
                    </tr>
                    <tr class="border-bottom py-2">
                        <td class="fw-bold text-muted">Remarks:</td>
                        <td class="text-secondary text-wrap" style="max-width: 220px;">${item.remarks || '<em>None</em>'}</td>
                    </tr>
                    <tr class="border-bottom py-2">
                        <td class="fw-bold text-muted">Stock Out by:</td>
                        <td class="text-dark">${item.processor_name || `User ID: ${item.user_id || 'N/A'}`}</td>
                    </tr>
                    <tr class="border-bottom py-2">
                        <td class="fw-bold text-muted">Stock Out Date:</td>
                        <td class="text-dark">${stockOutDate}</td>
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
        title: `Stock Out Reference Detail`,
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