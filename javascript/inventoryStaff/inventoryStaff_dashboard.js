// Global target declaration to prevent crashing if sharing JS files across routes
const inputMaterial = document.getElementById('inputMaterial');

document.addEventListener("DOMContentLoaded", () => {
    // Initial data fetch on load
    fetchMaterialsAndStats();

    // Optional: Auto-refresh data every 60 seconds for live monitoring
    // setInterval(fetchMaterialsAndStats, 60000);
});

// ==========================================
// CORE DATA ACQUISITION GATEWAY
// ==========================================
function fetchMaterialsAndStats() {
    fetch("/backend/inventoryStaff/InventoryStaffDashboard/get_materials.php")
        .then(response => response.json())
        .then(result => {
            if (result.status === 'success') {
                const stats = result.stats;

                // Update the 4 Quick Stats cards smoothly
                updateCount('totalItems', stats.total || 0);
                updateCount('lowStock', stats.low || 0);
                updateCount('outStock', stats.out || 0);
                updateCount('damagedStock', stats.damaged || 0);

                // Trigger notifications bell
                checkStockAlerts(result.data);

                // Populate Critical Alerts dashboard table element
                populateCriticalAlertsTable(result.data);

                // STITCHED IN: Execute and render your summary panels cleanly
                populateRecentSpoilageTable(result.recent_spoilage);
                populateExpirationWatchlist(result.expiration_watchlist);

                // 🌟 DROPDOWN CONFLICT FIX: Only re-render if the user isn't actively interacting with it
                if (inputMaterial && document.activeElement !== inputMaterial && Array.isArray(result.data)) {
                    inputMaterial.innerHTML = '<option value="" selected disabled>Select Material...</option>';
                    result.data.forEach(material => {
                        const option = document.createElement('option');
                        option.value = material.raw_material_id;
                        option.textContent = `${material.raw_material_name} (${parseFloat(material.current_quantity)} ${material.unit || ''} available)`;
                        inputMaterial.appendChild(option);
                    });
                }
            }
        }
    ).catch(error => console.error('Error fetching stats/materials:', error));
}

// ==========================================
// NOTIFICATION LIVE ALERTS COMPILER
// ==========================================
function checkStockAlerts(materialsList) {
    const badge = document.getElementById('notificationBadge');
    const menu = document.getElementById('notificationMenu');
    if (!menu || !badge) return;

    // 🌟 THE FIX: Immediately clear out old notification alerts
    menu.innerHTML = '<li class="dropdown-header border-bottom fw-bold text-dark py-2">Stock Alerts</li>';

    if (!Array.isArray(materialsList) || materialsList.length === 0) {
        badge.classList.add('d-none');
        menu.innerHTML += `<li><span class="dropdown-item text-muted text-center py-3">✅ All inventory levels are normal.</span></li>`;
        return;
    }

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

    if (activeAlerts.length > 0) {
        activeAlerts.sort((a, b) => b.updatedAt - a.updatedAt);

        activeAlerts.forEach(alert => {
            menu.innerHTML += `
                <li>
                    <a class="dropdown-item py-2 border-bottom text-wrap" href="inventoryStaff_RawMaterials.html" style="font-size: 0.85rem;">
                        <div style="color: ${alert.isCritical ? '#dc3545' : '#b57d00'}; line-height: 1.3;">
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
// DASHBOARD DYNAMIC TABLES POPULATER
// ==========================================
function populateCriticalAlertsTable(materialsList) {
    const alertsTableBody = document.getElementById('criticalAlertsTableBody');
    if (!alertsTableBody) return;

    // 🌟 THE FIX: Reset the table layout container before executing conditions
    alertsTableBody.innerHTML = '';

    if (!Array.isArray(materialsList) || materialsList.length === 0) {
        alertsTableBody.innerHTML = `
            <tr>
                <td colspan="4" class="text-center py-4 text-muted">
                    <i class="bi bi-check-circle text-success fs-3 d-block mb-1"></i>
                    All materials are above reorder limits!
                </td>
            </tr>`;
        return;
    }

    const alertItems = materialsList.filter(m => {
        const qty = parseFloat(m.current_quantity);
        const reorder = parseFloat(m.reorder_level);
        return !isNaN(qty) && !isNaN(reorder) && (qty <= reorder || qty <= 0);
    });

    if (alertItems.length > 0) {
        let tableHtml = '';
        alertItems.forEach(material => {
            const qty = parseFloat(material.current_quantity);
            const isOut = qty <= 0;

            tableHtml += `
                <tr>
                    <td class="fw-semibold text-dark">${material.raw_material_name}</td>
                    <td>
                        <span class="badge ${isOut ? 'bg-danger' : 'bg-warning text-dark'}">
                            ${isOut ? 'Out of Stock' : 'Low Stock'}
                        </span>
                    </td>
                    <td class="${isOut ? 'text-danger' : 'text-warning-emphasis'} fw-bold">
                        ${qty} ${material.unit || 'units'}
                        <small class="text-muted d-block" style="font-size: 0.7rem;">(Min Level: ${material.reorder_level})</small>
                    </td>
                    <td>
                        <a href="inventoryStaff_StockIn.html" class="btn btn-sm btn-success py-1 px-2.5" style="font-size: 0.75rem;">
                            <i class="bi bi-plus-lg"></i> Restock
                        </a>
                    </td>
                </tr>`;
        });
        alertsTableBody.innerHTML = tableHtml;
    } else {
        alertsTableBody.innerHTML = `
            <tr>
                <td colspan="4" class="text-center py-4 text-muted">
                    <i class="bi bi-check-circle text-success fs-3 d-block mb-1"></i>
                    All materials are above reorder limits!
                </td>
            </tr>`;
    }
}

// ==========================================
// VISUAL ANIMATION ANIMATOR UTILITY
// ==========================================
function updateCount(elementId, targetValue) {
    const element = document.getElementById(elementId);
    if (!element) return;

    const target = parseInt(targetValue, 10) || 0;
    const current = parseInt(element.textContent, 10) || 0;

    if (current === target) {
        element.textContent = target;
        return;
    }

    let start = current;
    const duration = 400;
    const startTime = performance.now();

    function animate(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);

        const currentValue = Math.floor(start + progress * (target - start));
        element.textContent = currentValue;

        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            element.textContent = target;
        }
    }

    requestAnimationFrame(animate);
}

// ==========================================
// PANELS RENDER LOGIC ENGINE
// ==========================================
function populateRecentSpoilageTable(spoilageList) {
    const tableBody = document.getElementById('recentSpoilageTableBody');
    if (!tableBody) return;

    // 🌟 THE FIX: Clear container directly
    tableBody.innerHTML = '';

    if (!Array.isArray(spoilageList) || spoilageList.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="4" class="text-center py-3 text-muted">No recent spoilage logs found.</td></tr>`;
        return;
    }

    let html = '';
    spoilageList.forEach(item => {
        const options = { year: 'numeric', month: 'short', day: 'numeric' };
        const dateFormatted = new Date(item.spoilage_date).toLocaleDateString('en-US', options);

        html += `
            <tr>
                <td class="text-muted">${dateFormatted}</td>
                <td class="fw-semibold text-dark">${item.raw_material_name}</td>
                <td class="text-danger fw-bold">${parseFloat(item.quantity_lost)} ${item.unit || 'units'}</td>
                <td><span class="badge bg-secondary-subtle text-dark border-0">${item.spoilage_type}</span></td>
            </tr>`;
    });
    tableBody.innerHTML = html;
}

function populateExpirationWatchlist(watchlist) {
    const container = document.getElementById('expirationWatchlist');
    if (!container) return;

    // 🌟 THE FIX: Flush the container clean before running the length check loop
    container.innerHTML = '';

    if (!Array.isArray(watchlist) || watchlist.length === 0) {
        container.innerHTML = `<div class="text-center py-4 text-muted"><i class="bi bi-shield-check text-success fs-2 d-block"></i>No expiring batches detected.</div>`;
        return;
    }

    let html = '';
    watchlist.forEach(item => {
        const daysLeft = parseInt(item.days_left, 10);
        let textClass = 'text-warning-emphasis';
        let statusMessage = `Expires in ${daysLeft} days`;

        if (daysLeft < 0) {
            textClass = 'text-danger fw-bold';
            statusMessage = `Expired ${Math.abs(daysLeft)} days ago`;
        } else if (daysLeft === 0) {
            textClass = 'text-danger fw-bold';
            statusMessage = 'Expiring Today';
        } else if (daysLeft === 1) {
            textClass = 'text-warning-emphasis';
            statusMessage = 'Expiring Tomorrow';
        } else if (daysLeft > 7) {
            textClass = 'text-info-emphasis';
        }

        html += `
            <div class="list-group-item d-flex justify-content-between align-items-center px-0 py-2.5 border-bottom">
                <div>
                    <h6 class="mb-0 fw-semibold text-dark" style="font-size: 0.9rem;">${item.raw_material_name}</h6>
                    <small class="${textClass} fw-medium">
                        <i class="bi bi-clock-history me-1"></i>${statusMessage}
                    </small>
                    <small class="text-muted d-block" style="font-size: 0.75rem;">Batch Qty: ${parseFloat(item.total_batch_quantity)} ${item.unit}</small>
                </div>
                <button type="button" class="btn btn-sm btn-outline-primary px-2.5 py-1 fw-semibold" 
                        onclick="viewMaterialBatches(${item.raw_material_id}, '${escapeHtml(item.raw_material_name)}')">
                    <i class="bi bi-eye"></i> View
                </button>
            </div>`;
    });
    container.innerHTML = html;
}

// ==========================================
// SWEETALERT2 DYNAMIC BATCH VIEWER MODAL
// ==========================================
function viewMaterialBatches(materialId, materialName) {
    Swal.fire({
        title: 'Loading Batch Summary...',
        allowOutsideClick: false,
        didOpen: () => { Swal.showLoading(); }
    });

    fetch(`/backend/inventoryStaff/spoilage/get_material_batches.php?raw_material_id=${materialId}`)
        .then(response => response.json())
        .then(res => {
            if (res.status !== 'success') {
                throw new Error(res.message || 'Failed processing batch contents.');
            }

            if (!res.batches || res.batches.length === 0) {
                Swal.fire({
                    icon: 'info',
                    title: materialName,
                    text: 'No recorded stock-in active batches match this material currently.',
                    confirmButtonColor: '#198754'
                });
                return;
            }

            let rowsHtml = '';
            res.batches.forEach(batch => {
                const daysLeft = parseInt(batch.days_left, 10);
                let badgeHtml = '';

                if (daysLeft < 0) {
                    badgeHtml = `<span class="badge bg-danger">Expired (${Math.abs(daysLeft)}d ago)</span>`;
                } else if (daysLeft === 0) {
                    badgeHtml = `<span class="badge bg-danger">Expires Today</span>`;
                } else if (daysLeft <= 3) {
                    badgeHtml = `<span class="badge bg-warning text-dark">Critical (${daysLeft}d left)</span>`;
                } else {
                    badgeHtml = `<span class="badge bg-success">${daysLeft} days left</span>`;
                }

                const batchDate = new Date(batch.stock_in_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                const expDate = batch.expiration_date ? new Date(batch.expiration_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A';

                rowsHtml += `
                    <tr style="font-size: 0.85rem;">
                        <td class="text-start fw-medium text-dark">${batch.reference_number || 'N/A'}<br><small class="text-muted">In: ${batchDate}</small></td>
                        <td class="fw-bold text-center">${parseFloat(batch.quantity)}</td>
                        <td class="text-center">${expDate}</td>
                        <td class="text-center">${badgeHtml}</td>
                    </tr>`;
            });

            Swal.fire({
                title: `<div class="fs-5 fw-bold text-start text-dark"><i class="bi bi-layers text-primary me-2"></i>Batch Distribution</div><div class="text-muted text-start" style="font-size:0.8rem; font-weight:normal;">${materialName}</div>`,
                html: `
                    <div class="table-responsive mt-2 border rounded" style="max-height: 300px;">
                        <table class="table table-sm table-striped table-hover align-middle mb-0">
                            <thead class="table-dark text-nowrap sticky-top">
                                <tr>
                                    <th class="text-start py-2">Ref / Date</th>
                                    <th class="text-center py-2">Qty</th>
                                    <th class="text-center py-2">Expiration</th>
                                    <th class="text-center py-2">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rowsHtml}
                            </tbody>
                        </table>
                    </div>`,
                width: '600px',
                confirmButtonText: 'Close Panel',
                confirmButtonColor: '#6c757d',
                customClass: { popup: 'p-3' }
            });
        })
        .catch(err => {
            console.error(err);
            Swal.fire({ icon: 'error', title: 'Lookup Fault', text: 'Error trying to trace historical batches.' });
        });
}

function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}