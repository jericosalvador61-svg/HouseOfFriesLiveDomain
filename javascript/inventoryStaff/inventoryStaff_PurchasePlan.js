// Global memory state for tracking current lists
let rawMaterialsCache = [];
let purchasePlansCache = [];

document.addEventListener('DOMContentLoaded', () => {
    fetchInitialData();
    setupEventListeners();
});

// ==========================================
// DATA INITIALIZATION & FETCHING
// ==========================================
async function fetchInitialData() {
    try {
        // Replace these URLs with your exact backend PHP endpoints
        const [materialsRes, plansRes] = await Promise.all([
            fetch('../../backend/inventoryStaff/purchasePlan/get_raw_materials.php'),
            fetch('../../backend/inventoryStaff/purchasePlan/get_purchase_plans.php')
        ]);

        rawMaterialsCache = await materialsRes.json();
        purchasePlansCache = await plansRes.json();

        // 🔔 Fix: Run your notification compiler immediately using live fetched data
        checkStockAlerts(rawMaterialsCache);

        // Render the main table layout history
        renderPurchasePlanTable(purchasePlansCache);
    } catch (error) {
        console.error("Error loading House of Fries data system:", error);
    }
}

function setupEventListeners() {
    // Main layout trigger buttons
    document.getElementById('createPurchasePlanBtn')?.addEventListener('click', openPurchasePlanWizard);
    document.getElementById('searchInventory')?.addEventListener('input', filterTableData);
    document.getElementById('filterStatus')?.addEventListener('change', filterTableData);
}

// ==========================================
// NOTIFICATION LIVE ALERTS COMPILER (FIXED)
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
                    <a class="dropdown-item py-2 border-bottom text-wrap" href="inventoryStaff_RawMaterials.html" style="font-size: 0.9rem;">
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

// ==========================================
// MAIN HISTORY TABLE RENDERER
// ==========================================
function renderPurchasePlanTable(plans) {
    const tbody = document.getElementById('purchasePlanTableBody');
    const emptyState = document.getElementById('noRecordsContainer');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!plans || plans.length === 0) {
        emptyState?.classList.remove('d-none');
        return;
    }
    emptyState?.classList.add('d-none');

    plans.forEach(plan => {
        let statusBadge = '';
        let actionButtons = `
            <button class="btn btn-outline-secondary btn-sm px-2 py-1" onclick="viewPlanDetails(${plan.plan_id})" title="View Details">
                <i class="bi bi-eye"></i>
            </button>
        `;

        // Switch styles based on document states
        if (plan.status === 'Pending') {
            statusBadge = `<span class="badge bg-warning text-dark px-2.5 py-1.5 fw-semibold">Pending</span>`;
        } else if (plan.status === 'Approved') {
            statusBadge = `<span class="badge bg-success px-2.5 py-1.5 fw-semibold">Approved</span>`;
            actionButtons += `
                <button class="btn btn-sm btn-info text-white px-2 py-1 ms-1" onclick="printPurchasePlan(${plan.plan_id})" title="Print Document">
                    <i class="bi bi-printer me-1"></i> Print
                </button>
            `;
        } else if (plan.status === 'Rejected') {
            statusBadge = `<span class="badge bg-danger px-2.5 py-1.5 fw-semibold">Rejected</span>`;
            actionButtons += `
                <button class="btn btn-sm btn-primary px-2 py-1 ms-1" onclick="reEditPurchasePlan(${plan.plan_id})" title="Edit & Resubmit">
                    <i class="bi bi-pencil-square me-1"></i> Edit
                </button>
            `;
        }

        tbody.innerHTML += `
    <tr>
        <td>${new Date(plan.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
        <td class="fw-medium">${plan.staff_name || 'System'}</td> <td class="fw-bold">${plan.total_items} Items</td>
        <td>${statusBadge}</td>
        <td class="text-muted small">${plan.admin_remarks || '<em>No remarks</em>'}</td>
        <td><div class="d-flex justify-content-center gap-1">${actionButtons}</div></td>
    </tr>
`;
    });
}

// ==========================================
// CREATE PURCHASE PLAN WIZARD (WITH LIVE FINANCIAL METRICS)
// ==========================================
function openPurchasePlanWizard() {
    // Filter down to elements needing urgent restocking 
    const lowStockItems = rawMaterialsCache.filter(m => parseFloat(m.current_quantity) <= parseFloat(m.reorder_level));

    if (lowStockItems.length === 0) {
        Swal.fire({
            icon: 'success',
            title: 'Inventory Healthy!',
            text: 'All raw material elements are sitting safely above their reorder points.',
            confirmButtonColor: '#198754'
        });
        return;
    }

    // Build editable interactive checklist rows inside SweetAlert
    let tableRowsHTML = '';
    lowStockItems.forEach(item => {
        // Suggested calculation baseline: Double the reorder line minus current values
        const suggestedQty = Math.max(1, (parseFloat(item.reorder_level) * 2) - parseFloat(item.current_quantity));
        const unitCost = parseFloat(item.cost_per_unit) || 0;
        const subtotal = suggestedQty * unitCost;

        tableRowsHTML += `
            <tr data-material-id="${item.raw_material_id}" data-unit-cost="${unitCost}">
                <td class="text-start text-truncate" style="max-width: 140px;">
                    <strong>${item.raw_material_name}</strong><br>
                    <small class="text-muted">₱${unitCost.toFixed(2)} / ${item.unit}</small>
                </td>
                <td>${parseFloat(item.current_quantity)}</td>
                <td>
                    <input type="number" class="form-control form-control-sm text-center purchase-qty-input" 
                           style="width: 80px; margin: 0 auto;" value="${suggestedQty}" min="1"
                           oninput="updateStaffWizardRowTotal(this)">
                </td>
                <td class="fw-bold text-dark text-end row-subtotal-display">₱${subtotal.toFixed(2)}</td>
            </tr>
        `;
    });

    Swal.fire({
        title: 'New Purchase Plan Draft',
        html: `
            <p class="text-muted small text-start">Below are items below reorder points. This draft will be forwarded to management for approval.</p>
            <div class="table-responsive" style="max-height: 300px;">
                <table class="table table-sm align-middle border small">
                    <thead class="table-light text-center">
                        <tr>
                            <th class="text-start">Item Name</th>
                            <th>Current</th>
                            <th>Order Qty</th>
                            <th class="text-end">Est. Subtotal</th>
                        </tr>
                    </thead>
                    <tbody>${tableRowsHTML}</tbody>
                </table>
            </div>
            <div class="d-flex justify-content-between align-items-center bg-light p-2 rounded border mt-2">
                <span class="fw-bold text-secondary small">Estimated Grand Total:</span>
                <span class="fs-5 fw-bold text-success" id="staffWizardGrandTotalDisplay">₱0.00</span>
            </div>
            <div class="mt-3 text-start">
                <label class="form-label small fw-bold">Staff Remarks / Notes:</label>
                <textarea id="planRemarks" class="form-control form-control-sm" rows="2" placeholder="Optional notes for Admin review..."></textarea>
            </div>
        `,
        width: '650px',
        showCancelButton: true,
        confirmButtonText: 'Submit to Admin',
        confirmButtonColor: '#198754',
        cancelButtonText: 'Cancel',
        // 🛠️ FIX: Using didRender ensures elements exist in DOM before calculations execute
        didRender: () => {
            calculateStaffWizardGrandTotal();
        },
        preConfirm: () => {
            const items = [];
            const rows = Swal.getHtmlContainer().querySelectorAll('tbody tr');
            rows.forEach(row => {
                const raw_material_id = row.getAttribute('data-material-id');
                const suggested_quantity = row.querySelector('.purchase-qty-input').value;
                if (suggested_quantity && parseFloat(suggested_quantity) > 0) {
                    items.push({
                        raw_material_id,
                        suggested_quantity: parseFloat(suggested_quantity)
                    });
                }
            });

            if (items.length === 0) {
                Swal.showValidationMessage('You must request a quantity higher than 0 for at least one item.');
                return false;
            }

            return {
                remarks: document.getElementById('planRemarks').value,
                items: items
            };
        }
    }).then((result) => {
        if (result.isConfirmed) {
            submitPurchasePlanBackend(result.value);
        }
    });
}

// ==========================================
// STAFF LIVE CALCULATION HELPERS
// ==========================================
function updateStaffWizardRowTotal(inputElement) {
    const row = inputElement.closest('tr');
    const unitCost = parseFloat(row.getAttribute('data-unit-cost')) || 0;
    const qty = parseFloat(inputElement.value) || 0;

    const subtotalDisplay = row.querySelector('.row-subtotal-display');
    if (subtotalDisplay) {
        subtotalDisplay.textContent = `₱${(qty * unitCost).toFixed(2)}`;
    }
    calculateStaffWizardGrandTotal();
}

function calculateStaffWizardGrandTotal() {
    const container = Swal.getHtmlContainer();
    if (!container) return;

    const rows = container.querySelectorAll('tbody tr');
    let grandTotal = 0;

    rows.forEach(row => {
        const unitCost = parseFloat(row.getAttribute('data-unit-cost')) || 0;
        const qty = parseFloat(row.querySelector('.purchase-qty-input').value) || 0;
        grandTotal += (qty * unitCost);
    });

    const totalDisplay = document.getElementById('staffWizardGrandTotalDisplay');
    if (totalDisplay) {
        totalDisplay.textContent = `₱${grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
}

// ==========================================
// RE-EDIT REJECTED SYSTEM PLANS (WITH LIVE FINANCIAL METRICS)
// ==========================================
async function reEditPurchasePlan(planId) {
    try {
        // Fetch specific historical metadata elements
        const response = await fetch(`../../backend/inventoryStaff/purchasePlan/get_plan_details.php?plan_id=${planId}`);
        const planDetails = await response.json(); // Expected structure: { remarks: "", admin_remarks: "", items: [...] }

        let tableRowsHTML = '';
        planDetails.items.forEach(item => {
            // Read snapshot unit cost from history record, fall back to 0 if legacy empty
            const unitCost = parseFloat(item.snapshot_unit_cost) || 0;
            const qty = parseFloat(item.suggested_quantity) || 0;
            const subtotal = qty * unitCost;

            tableRowsHTML += `
                <tr data-material-id="${item.raw_material_id}" data-unit-cost="${unitCost}">
                    <td class="text-start">
                        <strong>${item.raw_material_name}</strong><br>
                        <small class="text-muted">₱${unitCost.toFixed(2)} / ${item.unit}</small>
                    </td>
                    <td>${parseFloat(item.current_quantity)} ${item.unit}</td>
                    <td>
                        <input type="number" class="form-control form-control-sm text-center purchase-qty-input" 
                               style="width: 80px; margin: 0 auto;" 
                               value="${qty}" min="1"
                               oninput="updateStaffWizardRowTotal(this)">
                    </td>
                    <td class="fw-bold text-dark text-end row-subtotal-display">₱${subtotal.toFixed(2)}</td>
                </tr>
            `;
        });

        Swal.fire({
            title: `Revise Purchase Plan`,
            html: `
                <div class="alert alert-danger p-2 text-start small mb-3">
                    <strong>Admin Rejection Reason:</strong><br>${planDetails.admin_remarks || 'No remarks left.'}
                </div>
                <div class="table-responsive" style="max-height: 300px;">
                    <table class="table table-sm align-middle border small">
                        <thead class="table-light text-center">
                            <tr>
                                <th class="text-start">Item Name</th>
                                <th>Snapshot Qty</th>
                                <th>Order Qty</th>
                                <th class="text-end">Est. Subtotal</th>
                            </tr>
                        </thead>
                        <tbody>${tableRowsHTML}</tbody>
                    </table>
                </div>
                
                <div class="d-flex justify-content-between align-items-center bg-light p-2 rounded border mt-2">
                    <span class="fw-bold text-secondary small">Estimated Grand Total:</span>
                    <span class="fs-5 fw-bold text-success" id="staffWizardGrandTotalDisplay">₱0.00</span>
                </div>

                <div class="mt-3 text-start">
                    <label class="form-label small fw-bold">Update Notes / Remarks:</label>
                    <textarea id="planRemarks" class="form-control form-control-sm" rows="2">${planDetails.remarks || ''}</textarea>
                </div>
            `,
            width: '650px',
            showCancelButton: true,
            confirmButtonText: 'Resubmit for Approval',
            confirmButtonColor: '#0d6efd', // Blue button indicating modification resubmission
            didRender: () => {
                // Instantly calculate totals when modal finishes rendering
                calculateStaffWizardGrandTotal();
            },
            preConfirm: () => {
                const items = [];
                const rows = Swal.getHtmlContainer().querySelectorAll('tbody tr');
                rows.forEach(row => {
                    items.push({
                        raw_material_id: row.getAttribute('data-material-id'),
                        suggested_quantity: parseFloat(row.querySelector('.purchase-qty-input').value) || 0
                    });
                });
                return {
                    plan_id: planId,
                    remarks: document.getElementById('planRemarks').value,
                    items: items
                };
            }
        }).then((result) => {
            if (result.isConfirmed) {
                resubmitPurchasePlanBackend(result.value);
            }
        });

    } catch (err) {
        Swal.fire('Error', 'Could not recall structural layout for re-edit procedures.', 'error');
    }
}

// ==========================================
// SUBMIT AND RESUBMIT XHR REQUESTS
// ==========================================
async function submitPurchasePlanBackend(payload) {
    try {
        const token = localStorage.getItem("hof_token");

        Swal.showLoading();

        const res = await fetch('/backend/inventoryStaff/purchasePlan/create_purchase_plan.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}` // FIX: Forwarded token safely in headers
            },
            body: JSON.stringify({
                remarks: payload.remarks,
                items: payload.items
            })
        });

        const data = await res.json();
        if (data.success) {
            Swal.fire('Submitted!', 'Purchase plan sent to Admin queue.', 'success');
            fetchInitialData();
        } else {
            Swal.fire('Failed', data.message || 'Error executing transmission.', 'error');
        }
    } catch (e) {
        Swal.fire('Error', 'Network request failures detected.', 'error');
    } finally {
        Swal.close();
    }
}

async function resubmitPurchasePlanBackend(payload) {
    try {
        const token = localStorage.getItem("hof_token");

        Swal.showLoading();

        const res = await fetch('/backend/inventoryStaff/purchasePlan/resubmit_purchase_plan.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}` // FIX: Forwarded token safely in headers here too
            },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
            Swal.fire('Resubmitted!', 'Plan state reset to Pending and routed back to Admin.', 'success');
            fetchInitialData();
        } else { Swal.fire('Failed', data.message, 'error'); }
    } catch (e) { Swal.fire('Error', 'Network error during resubmission.', 'error'); }
    finally { Swal.close(); }
}

// ==========================================
// UTILITY ENGINE: PRINT DOCUMENT ROUTER
// ==========================================
function printPurchasePlan(planId) {
    // Spawns a clean print frame loading just the document target layout
    const printWindow = window.open(`../../backend/inventoryStaff/purchasePlan/print_purchase_plan.php?plan_id=${planId}`, '_blank');
    printWindow?.focus();
}

// ==========================================
// VIEW PLAN DETAILS (MODAL CHECKLIST)
// ==========================================
async function viewPlanDetails(planId) {
    try {
        const response = await fetch(`/backend/inventoryStaff/purchasePlan/get_plan_details.php?plan_id=${planId}`);
        const data = await response.json();

        let itemsListHTML = '<ul class="list-group text-start borderless small">';
        data.items.forEach(item => {
            itemsListHTML += `<li class="list-group-item d-flex justify-content-between align-items-center">
                <span>📦 <strong>${item.raw_material_name}</strong></span>
                <span class="badge bg-secondary rounded-pill">${parseFloat(item.suggested_quantity)} ${item.unit}</span>
            </li>`;
        });
        itemsListHTML += '</ul>';

        Swal.fire({
            title: `Plan Details Summary`,
            html: `
                <div class="mb-3 text-start small">
                    <strong>Staff Notes:</strong> ${data.remarks || '<em>None</em>'}<br>
                    <strong>Admin Notes:</strong> ${data.admin_remarks || '<em>None</em>'}
                </div>
                <h6>Requested Item Breakdown:</h6>
                ${itemsListHTML}
            `,
            confirmButtonColor: '#6c757d'
        });
    } catch (e) { Swal.fire('Error', 'Failed to trace specific report breakdowns.', 'error'); }
}

// ==========================================
// LIVE SEARCH FILTER INTERACTION MECHANICS
// ==========================================
function filterTableData() {
    const searchVal = document.getElementById('searchInventory').value.toLowerCase();
    const statusVal = document.getElementById('filterStatus').value;

    const filtered = purchasePlansCache.filter(plan => {
        const matchesStatus = statusVal === "" || plan.status === statusVal;
        // Search matches on admin comments or generalized item sizes
        const matchesSearch = searchVal === "" ||
            (plan.admin_remarks && plan.admin_remarks.toLowerCase().includes(searchVal)) ||
            (plan.total_items.toString().includes(searchVal));

        return matchesStatus && matchesSearch;
    });

    renderPurchasePlanTable(filtered);
}