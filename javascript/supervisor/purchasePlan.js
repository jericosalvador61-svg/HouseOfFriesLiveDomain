// Global memory state for tracking current lists
let rawMaterialsCache = [];
let purchasePlansCache = [];

document.addEventListener('DOMContentLoaded', () => {
    fetchInitialData();
    setupEventListeners();
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
// DATA INITIALIZATION & FETCHING
// ==========================================
async function fetchInitialData() {
    try {
        // 🔑 FIX: Securely pass Bearer token via standard Authorization Headers
        const [materialsRes, plansRes] = await Promise.all([
            fetch('../../backend/admin/purchasePlan/get_raw_materials.php', {
                method: 'GET',
                headers: getAuthHeaders(null)
            }),
            fetch('../../backend/admin/purchasePlan/get_purchase_plans.php', {
                method: 'GET',
                headers: getAuthHeaders(null)
            })
        ]);

        rawMaterialsCache = await materialsRes.json();
        purchasePlansCache = await plansRes.json();

        // Run stock notification alerts
        checkStockAlerts(rawMaterialsCache);

        // Render both layouts side-by-side using unified cache data
        renderPurchasePlanTable(purchasePlansCache.plans || []);
    } catch (error) {
        console.error("Error loading House of Fries data system:", error);
    }
}

function setupEventListeners() {
    document.getElementById('createPurchasePlanBtn')?.addEventListener('click', openPurchasePlanWizard);
    document.getElementById('searchInventory')?.addEventListener('input', filterTableData);
    document.getElementById('filterStatus')?.addEventListener('change', filterTableData);
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
// MAIN SPLIT LAYOUT RENDERING ENGINE
// ==========================================
function renderPurchasePlanTable(plans) {
    const tbody = document.getElementById('purchasePlanTableBody');
    const emptyState = document.getElementById('noRecordsContainer');
    const queueBody = document.getElementById('adminApprovalQueue');

    if (!tbody) return;
    tbody.innerHTML = '';

    let queueHTML = '';
    let historicalCount = 0;

    plans.forEach(plan => {
        const formattedDate = new Date(plan.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

        if (plan.status === 'Pending') {
            queueHTML += `
                <div class="card border mb-3 shadow-sm rounded-2 border-start-4 border-warning bg-white">
                    <div class="card-body p-3">
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            <h6 class="fw-bold mb-0 text-primary">#PP-${plan.plan_id.toString().padStart(4, '0')}</h6>
                            <span class="badge bg-light text-dark border small">${plan.total_items} Items</span>
                        </div>
                        <div class="small text-secondary mb-3">
                            <div class="mb-1"><i class="bi bi-person me-1"></i> <strong>Req By:</strong> ${plan.staff_name || 'System'}</div>
                            <div><i class="bi bi-calendar3 me-1"></i> <strong>Date:</strong> ${formattedDate}</div>
                        </div>
                        <div class="d-grid">
                            <button class="btn btn-outline-primary btn-sm fw-bold py-1.5" onclick="viewPlanDetails(${plan.plan_id}, true)">
                                <i class="bi bi-shield-exclamation me-1"></i> Evaluate Request
                            </button>
                        </div>
                    </div>
                </div>
            `;
            return;
        }

        historicalCount++;
        let statusBadge = plan.status === 'Approved'
            ? `<span class="badge bg-success px-2.5 py-1.5 fw-semibold">Approved</span>`
            : `<span class="badge bg-danger px-2.5 py-1.5 fw-semibold">Rejected</span>`;

        let actionButtons = `
            <button class="btn btn-outline-secondary btn-sm px-2 py-1" onclick="viewPlanDetails(${plan.plan_id}, false)" title="View Logs">
                <i class="bi bi-eye"></i>
            </button>
        `;

        if (plan.status === 'Approved') {
            actionButtons += `
                <button class="btn btn-sm btn-info text-white px-2 py-1 ms-1" onclick="printPurchasePlan(${plan.plan_id})" title="Print Report">
                    <i class="bi bi-printer me-1"></i> Print
                </button>
            `;
        }

        tbody.innerHTML += `
            <tr>
                <td>${formattedDate}</td>
                <td class="fw-medium">${plan.staff_name || 'System'}</td>
                <td class="fw-bold">${plan.total_items} Items</td>
                <td class="text-success fw-bold">₱${parseFloat(plan.total_cost || 0).toFixed(2)}</td>
                <td>${statusBadge}</td>
                <td class="text-muted small">${plan.admin_remarks || '<em>No remarks</em>'}</td>
                <td><div class="d-flex justify-content-center gap-1">${actionButtons}</div></td>
            </tr>
        `;
    });

    if (historicalCount === 0) emptyState?.classList.remove('d-none');
    else emptyState?.classList.add('d-none');

    if (queueBody) {
        queueBody.innerHTML = queueHTML || `
            <div class="text-center py-4 text-muted small" id="emptyQueueMessage">
                <i class="bi bi-check-circle text-success fs-3 mb-2 d-block"></i>
                All submitted plans processed!
            </div>`;
    }
}

// ==========================================
// ADMINISTRATIVE CREATION WIZARD (WITH LIVE COST CALCULATIONS)
// ==========================================
function openPurchasePlanWizard() {
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

    let tableRowsHTML = '';
    lowStockItems.forEach(item => {
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
                           oninput="updateWizardRowTotal(this)">
                </td>
                <td class="fw-bold text-dark text-end row-subtotal-display">₱${subtotal.toFixed(2)}</td>
            </tr>
        `;
    });

    Swal.fire({
        title: 'New Purchase Plan Draft',
        html: `
            <p class="text-muted small text-start">Creating as Manager: This procurement plan will calculate budgets and instantly <strong>Auto-Approve</strong>.</p>
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
                <span class="fs-5 fw-bold text-success" id="wizardGrandTotalDisplay">₱0.00</span>
            </div>
            <div class="mt-3 text-start">
                <label class="form-label small fw-bold">Admin Remarks / Notes:</label>
                <textarea id="planRemarks" class="form-control form-control-sm" rows="2" placeholder="Write internal manager procurement notes here..."></textarea>
            </div>
        `,
        width: '650px',
        showCancelButton: true,
        confirmButtonText: 'Create & Auto-Approve',
        confirmButtonColor: '#198754',
        cancelButtonText: 'Cancel',
        didRender: () => {
            calculateWizardGrandTotal();
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

function updateWizardRowTotal(inputElement) {
    const row = inputElement.closest('tr');
    const unitCost = parseFloat(row.getAttribute('data-unit-cost')) || 0;
    const qty = parseFloat(inputElement.value) || 0;

    const subtotalDisplay = row.querySelector('.row-subtotal-display');
    if (subtotalDisplay) {
        subtotalDisplay.textContent = `₱${(qty * unitCost).toFixed(2)}`;
    }
    calculateWizardGrandTotal();
}

function calculateWizardGrandTotal() {
    const container = Swal.getHtmlContainer();
    if (!container) return;

    const rows = container.querySelectorAll('tbody tr');
    let grandTotal = 0;

    rows.forEach(row => {
        const unitCost = parseFloat(row.getAttribute('data-unit-cost')) || 0;
        const qty = parseFloat(row.querySelector('.purchase-qty-input').value) || 0;
        grandTotal += (qty * unitCost);
    });

    const totalDisplay = document.getElementById('wizardGrandTotalDisplay');
    if (totalDisplay) {
        totalDisplay.textContent = `₱${grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
}

// ==========================================
// SUBMIT BACKEND REGISTRATION (ADMIN AUTO)
// ==========================================
async function submitPurchasePlanBackend(payload) {
    try {
        const fullPayload = {
            remarks: payload.remarks,
            items: payload.items
        };

        Swal.getConfirmButton().disabled = true;
        Swal.getConfirmButton().innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Processing...';

        const res = await fetch('../../backend/admin/purchasePlan/create_purchase_plan.php', {
            method: 'POST',
            headers: getAuthHeaders('application/json'),
            body: JSON.stringify(fullPayload)
        });

        const data = await res.json();
        if (data.success) {
            Swal.fire('Executed!', 'Manager purchase order generated and auto-approved.', 'success');
            fetchInitialData();
        } else {
            Swal.fire('Failed', data.message || 'Error processing request.', 'error');
        }
    } catch (e) {
        Swal.fire('Error', 'Network engine connection failures detected.', 'error');
    } finally {
        Swal.getConfirmButton().disabled = false;
        Swal.getConfirmButton().innerHTML = 'Create & Auto-Approve';
    }
}

// ==========================================
// VIEW DETAILED MODAL PORTAL (WITH FINANCIAL METRICS & ACTIONS)
// ==========================================
async function viewPlanDetails(planId, isPendingWorkflow = false) {
    try {
        // 🔑 FIX: Added Bearer verification access token to plan breakdown lookups
        const response = await fetch(`../../backend/admin/purchasePlan/get_plan_details.php?plan_id=${planId}`, {
            method: 'GET',
            headers: getAuthHeaders(null)
        });
        const data = await response.json();

        let itemsTableRowsHTML = '';
        let localCalculatedGrandTotal = 0;

        data.items.forEach(item => {
            const qty = parseFloat(item.suggested_quantity) || 0;
            const unitCost = parseFloat(item.snapshot_unit_cost) || 0;
            const subtotal = qty * unitCost;
            localCalculatedGrandTotal += subtotal;

            itemsTableRowsHTML += `
                <tr>
                    <td class="text-start">
                        <strong>${item.raw_material_name}</strong><br>
                        <small class="text-muted">₱${unitCost.toFixed(2)} / ${item.unit}</small>
                    </td>
                    <td class="text-center fw-bold text-dark">${qty} ${item.unit}</td>
                    <td class="text-end fw-bold text-dark">₱${subtotal.toFixed(2)}</td>
                </tr>
            `;
        });

        const grandTotal = parseFloat(data.total_cost) > 0 ? parseFloat(data.total_cost) : localCalculatedGrandTotal;

        let swalConfig = {
            title: `Purchase Plan Details (#PP-${planId.toString().padStart(4, '0')})`,
            showCloseButton: true,
            width: '600px',
            html: `
                <div class="mb-3 text-start small bg-light p-3 rounded border">
                    <div class="mb-1"><strong>Staff Notes:</strong> ${data.remarks || '<em>None</em>'}</div>
                    <div><strong>Admin Notes:</strong> ${data.admin_remarks || '<em>None</em>'}</div>
                </div>
                
                <h6 class="text-start fw-bold mb-2">Requested Item Breakdown:</h6>
                <div class="table-responsive border rounded style-scroll mb-2" style="max-height: 240px; overflow-y: auto;">
                    <table class="table table-sm table-hover align-middle mb-0 small">
                        <thead class="table-light sticky-top">
                            <tr>
                                <th class="text-start">Item & Unit Cost</th>
                                <th class="text-center">Order Qty</th>
                                <th class="text-end">Subtotal</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${itemsTableRowsHTML}
                        </tbody>
                    </table>
                </div>

                <div class="d-flex justify-content-between align-items-center bg-light p-2 rounded border mt-2">
                    <span class="fw-bold text-secondary small text-start">Estimated Grand Total:</span>
                    <span class="fs-5 fw-bold text-success text-end">₱${grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
            `
        };

        if (isPendingWorkflow) {
            swalConfig.showCancelButton = true;
            swalConfig.showDenyButton = true;
            swalConfig.confirmButtonText = '<i class="bi bi-check-lg"></i> Approve';
            swalConfig.denyButtonText = '<i class="bi bi-x-lg"></i> Reject';
            swalConfig.cancelButtonText = 'Cancel';
            swalConfig.confirmButtonColor = '#198754';
            swalConfig.denyButtonColor = '#dc3545';
        } else {
            swalConfig.confirmButtonText = 'Close Window';
            swalConfig.confirmButtonColor = '#6c757d';
        }

        Swal.fire(swalConfig).then((result) => {
            if (isPendingWorkflow) {
                if (result.isConfirmed) {
                    promptEvaluationRemarks(planId, 'Approved');
                } else if (result.isDenied) {
                    promptEvaluationRemarks(planId, 'Rejected');
                }
            }
        });

    } catch (e) {
        Swal.fire('Error', 'Failed to pull specific plan breakdowns.', 'error');
    }
}

function promptEvaluationRemarks(planId, decision) {
    const isApprove = decision === 'Approved';

    Swal.fire({
        title: `Confirm ${decision}`,
        text: `Add notes to finalize document reference #PP-${planId.toString().padStart(4, '0')}:`,
        input: 'textarea',
        inputPlaceholder: isApprove ? 'Optional evaluation comments...' : 'Required reason for rejecting this plan...',
        showCancelButton: true,
        confirmButtonColor: isApprove ? '#198754' : '#dc3545',
        confirmButtonText: 'Submit Decision',
        preConfirm: (value) => {
            if (!isApprove && !value.trim()) {
                Swal.showValidationMessage('You must provide rejection remarks detailing what needs fixing.');
                return false;
            }
            return value;
        }
    }).then((result) => {
        if (result.isConfirmed) {
            executeDecisionBackend(planId, decision, result.value);
        }
    });
}

async function executeDecisionBackend(planId, decision, remarks) {
    try {
        Swal.showLoading();

        const res = await fetch('../../backend/admin/purchasePlan/admin_evaluate_plan.php', {
            method: 'POST',
            headers: getAuthHeaders('application/json'),
            body: JSON.stringify({
                plan_id: planId,
                status: decision,
                admin_remarks: remarks
            })
        });

        const data = await res.json();
        if (data.success) {
            Swal.fire('Updated!', `Plan state saved successfully.`, 'success');
            fetchInitialData();
        } else {
            Swal.fire('Error', data.message || 'Failed to update workflow.', 'error');
        }
    } catch (e) {
        Swal.fire('Error', 'Network engine failure processed.', 'error');
    } finally {
        Swal.close();
    }
}

function printPurchasePlan(planId) {
    // Note: If printing handles strict down-routing, ensure your print page reads localstorage or session tokens correctly
    const printWindow = window.open(`../../backend/admin/purchasePlan/print_purchase_plan.php?plan_id=${planId}`, '_blank');
    printWindow?.focus();
}

function filterTableData() {
    const searchVal = document.getElementById('searchInventory').value.toLowerCase();
    const statusVal = document.getElementById('filterStatus').value;

    const filtered = (purchasePlansCache.plans || purchasePlansCache).filter(plan => {
        const matchesStatus = statusVal === "" || plan.status === statusVal;
        const matchesSearch = searchVal === "" ||
            (plan.admin_remarks && plan.admin_remarks.toLowerCase().includes(searchVal)) ||
            (plan.total_items.toString().includes(searchVal)) ||
            (plan.staff_name && plan.staff_name.toLowerCase().includes(searchVal));

        return matchesStatus && matchesSearch;
    });

    renderPurchasePlanTable(filtered);
}