/**
 * Settings and Maintenance Panel Logic Controller
 * House of Fries Business Ecosystem
 */

// ====================================================================
// RUN MANUAL DATABASE EXPORT PIPELINE
// ====================================================================
function triggerManualBackup() {
    Swal.fire({
        title: 'Compiling Database System...',
        text: 'Generating secure SQL schema footprints and dependencies.',
        allowOutsideClick: false,
        didOpen: () => { Swal.showLoading(); }
    });

    const endpointUrl = '/backend/admin/settings/backup_engine.php?action=manual_download';

    fetch(endpointUrl)
        .then(response => {
            if (!response.ok) {
                throw new Error("Network transport exception during data parsing compilation loops.");
            }
            return response.blob();
        })
        .then(blob => {
            const downloadUrl = window.URL.createObjectURL(blob);
            const hiddenAnchor = document.createElement('a');
            const timestamp = new Date().toISOString().split('T')[0];
            hiddenAnchor.download = `HOF_BACKUP_${timestamp}.sql`;
            hiddenAnchor.href = downloadUrl;
            document.body.appendChild(hiddenAnchor);
            hiddenAnchor.click();
            document.body.removeChild(hiddenAnchor);
            window.URL.revokeObjectURL(downloadUrl);

            Swal.fire({
                icon: 'success',
                title: 'Data Export Complete!',
                text: 'Your current system blueprint has compiled and downloaded safely.',
                confirmButtonColor: '#ffc107'
            });
        })
        .catch(error => {
            console.error('System backup failure trace logs:', error);
            Swal.fire({
                icon: 'error',
                title: 'Export Aborted',
                text: 'An error occurred while compiling tables. Verify your file stream writing limits.'
            });
        });
}

// ====================================================================
// LOAD BACKUP LOGS/HISTORY
// ====================================================================
async function loadBackupHistory() {
    try {
        const res = await fetch('/backend/admin/settings/backup_engine.php?action=list_backups');
        const data = await res.json();
        
        if (data.status === 'success') {
            renderBackupTable(data.backups);
        } else {
            console.error('Failed to load backups:', data.message);
        }
    } catch (err) {
        console.error('Failed to load backup history:', err);
    }
}

function renderBackupTable(backups) {
    const container = document.getElementById('backupHistoryContainer');
    if (!container) return;
    
    if (!backups || backups.length === 0) {
        container.innerHTML = `
            <div class="text-center text-muted py-4">
                <i class="bi bi-database fs-1 mb-2"></i>
                <p>No backups found</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = `
        <div class="table-responsive">
            <table class="table table-hover align-middle">
                <thead class="table-light">
                    <tr>
                        <th>Filename</th>
                        <th>Type</th>
                        <th>Size</th>
                        <th>Created</th>
                        <th class="text-end">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${backups.map(b => `
                        <tr>
                            <td class="fw-medium">${b.filename}</td>
                            <td>
                                <span class="badge ${b.type === 'auto' ? 'bg-info' : 'bg-warning'}">
                                    ${b.type === 'auto' ? 'Auto (Daily 12pm)' : 'Manual'}
                                </span>
                            </td>
                            <td>${b.size_formatted}</td>
                            <td>${b.created}</td>
                            <td class="text-end">
                                <button class="btn btn-sm btn-outline-warning me-1" onclick="downloadBackup('${b.filename}')">
                                    <i class="bi bi-download"></i>
                                </button>
                                <button class="btn btn-sm btn-outline-danger" onclick="deleteBackup('${b.filename}')">
                                    <i class="bi bi-trash"></i>
                                </button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

async function downloadBackup(filename) {
    try {
        // Use direct download link
        window.location.href = `/backend/admin/settings/backup_engine.php?action=download_backup&file=${encodeURIComponent(filename)}`;
        
        Swal.fire({
            icon: 'success',
            title: 'Download Started',
            text: 'Backup file is downloading...',
            timer: 2000,
            showConfirmButton: false
        });
    } catch (err) {
        console.error('Download failed:', err);
        Swal.fire('Error', 'Download failed', 'error');
    }
}

async function deleteBackup(filename) {
    const result = await Swal.fire({
        title: 'Delete Backup?',
        text: `Are you sure you want to delete ${filename}? This cannot be undone.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc3545',
        cancelButtonColor: '#6c757d',
        confirmButtonText: 'Yes, delete it!'
    });
    
    if (!result.isConfirmed) return;
    
    try {
        const deleteBtn = document.querySelector(`button[onclick="deleteBackup('${filename}')"]`);
        if (deleteBtn) LoadingManager.show(deleteBtn, { text: 'Deleting...' });

        const res = await fetch('/backend/admin/settings/backup_engine.php?action=delete_backup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file: filename })
        });
        const data = await res.json();
        
        if (data.status === 'success') {
            Swal.fire('Deleted!', 'Backup has been deleted.', 'success');
            loadBackupHistory();
        } else {
            Swal.fire('Error', data.message || 'Delete failed', 'error');
        }
    } catch (err) {
        console.error('Delete failed:', err);
        Swal.fire('Error', 'Delete failed', 'error');
    } finally {
        const deleteBtn = document.querySelector(`button[onclick="deleteBackup('${filename}')"]`);
        if (deleteBtn) LoadingManager.hide(deleteBtn);
    }
}

// ====================================================================
// DYNAMIC AUTOMATED BACKUP SCHEDULER (checks if daily backup ran at 12pm)
// ====================================================================
// Note: Actual daily backup at 12pm should be run via server cron job
// This client-side check just verifies the last backup was recent
function checkDailyBackupStatus() {
    fetch('/backend/admin/settings/backup_engine.php?action=list_backups')
        .then(res => res.json())
        .then(data => {
            if (data.status === 'success' && data.backups.length > 0) {
                const latest = data.backups[0];
                const lastBackup = new Date(latest.created);
                const hoursSince = (Date.now() - lastBackup.getTime()) / (1000 * 60 * 60);
                
                const statusEl = document.getElementById('dailyBackupStatus');
                const badgeEl = document.getElementById('dailyBackupBadge');
                
                if (statusEl && badgeEl) {
                    if (hoursSince < 26) { // Within ~26 hours (daily + buffer)
                        statusEl.textContent = 'Last run: ' + latest.created;
                        badgeEl.textContent = 'Active';
                        badgeEl.className = 'badge bg-success-subtle text-success px-2 py-1';
                    } else {
                        statusEl.textContent = 'Last run: ' + latest.created + ' (Overdue)';
                        badgeEl.textContent = 'Overdue';
                        badgeEl.className = 'badge bg-danger-subtle text-danger px-2 py-1';
                    }
                }
            }
        })
        .catch(err => console.warn('Backup status check failed:', err));
}

// Run status check on load
document.addEventListener('DOMContentLoaded', () => {
    checkDailyBackupStatus();
    loadBackupHistory();
    loadDiscountTypes();
});

// ====================================================================
// REQ-049 — DISCOUNT TYPES CRUD
// ====================================================================
const DISCOUNT_TYPES_ENDPOINT = '/backend/admin/settings/discount_types.php';

function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function loadDiscountTypes() {
    const container = document.getElementById('discountTypesContainer');
    if (!container) return;

    try {
        const res = await fetch(DISCOUNT_TYPES_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'list' })
        });
        const data = await res.json();

        if (!data.success) {
            container.innerHTML = '<p class="text-muted small text-center py-3">Failed to load discount types.</p>';
            return;
        }

        renderDiscountTypes(data.types || []);
    } catch (err) {
        console.error('Failed to load discount types:', err);
        container.innerHTML = '<p class="text-muted small text-center py-3">Failed to load discount types.</p>';
    }
}

function renderDiscountTypes(types) {
    const container = document.getElementById('discountTypesContainer');
    if (!container) return;

    if (!types || types.length === 0) {
        container.innerHTML = `
            <div class="text-center text-muted py-4">
                <i class="bi bi-percent fs-1 mb-2"></i>
                <p class="mb-0 small">No discount types yet. Click "Add Type" to create one.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <div class="table-responsive">
            <table class="table table-hover align-middle">
                <thead class="table-light">
                    <tr>
                        <th>Name</th>
                        <th>Percent</th>
                        <th>Active</th>
                        <th class="text-end">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${types.map(t => `
                        <tr>
                            <td class="fw-medium">${escapeHtml(t.name)}</td>
                            <td>${parseFloat(t.percent).toFixed(2)}%</td>
                            <td>
                                <span class="badge ${parseInt(t.is_active, 10) === 1 ? 'bg-success' : 'bg-secondary'}">
                                    ${parseInt(t.is_active, 10) === 1 ? 'Active' : 'Inactive'}
                                </span>
                            </td>
                            <td class="text-end">
                                <button class="btn btn-sm btn-outline-warning me-1" onclick="editDiscountType(${t.discount_type_id})">
                                    <i class="bi bi-pencil"></i>
                                </button>
                                <button class="btn btn-sm btn-outline-danger" onclick="deactivateDiscountType(${t.discount_type_id})">
                                    <i class="bi bi-trash"></i>
                                </button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function openDiscountTypeModal(mode, type) {
    const isEdit = mode === 'edit';
    const currentName = isEdit ? (type.name || '') : '';
    const currentPercent = isEdit ? parseFloat(type.percent).toFixed(2) : '';

    Swal.fire({
        title: isEdit ? 'Edit Discount Type' : 'Add Discount Type',
        html: `
            <div class="text-start">
                <div class="mb-3">
                    <label class="form-label fw-bold">Name:</label>
                    <input type="text" id="swal-dtype-name" class="form-control" maxlength="50" value="${escapeHtml(currentName)}" placeholder="e.g., Senior Citizen">
                </div>
                <div class="mb-3">
                    <label class="form-label fw-bold">Percent (%):</label>
                    <input type="number" id="swal-dtype-percent" class="form-control" min="0" max="100" step="0.01" value="${currentPercent}" placeholder="e.g., 10.00">
                </div>
                ${isEdit ? `<div class="mb-3">
                    <div class="form-check form-switch">
                        <input class="form-check-input" type="checkbox" id="swal-dtype-active" ${parseInt(type.is_active, 10) === 1 ? 'checked' : ''}>
                        <label class="form-check-label fw-bold" for="swal-dtype-active">Active</label>
                    </div>
                </div>` : ''}
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: isEdit ? 'Save Changes' : 'Add Type',
        confirmButtonColor: '#ffc107',
        cancelButtonColor: '#6c757d',
        preConfirm: () => {
            const name = document.getElementById('swal-dtype-name').value.trim();
            const percent = parseFloat(document.getElementById('swal-dtype-percent').value);

            if (!name) {
                Swal.showValidationMessage('Discount type name is required.');
                return false;
            }
            if (isNaN(percent) || percent < 0 || percent > 100) {
                Swal.showValidationMessage('Percent must be between 0.00 and 100.00.');
                return false;
            }
            return { name, percent };
        }
    }).then(async (result) => {
        if (!result.isConfirmed) return;

        const { name, percent } = result.value;
        const payload = isEdit
            ? {
                  action: 'update',
                  discount_type_id: type.discount_type_id,
                  name: name,
                  percent: percent,
                  is_active: document.getElementById('swal-dtype-active').checked ? 1 : 0
              }
            : { action: 'create', name: name, percent: percent };

        try {
            const res = await fetch(DISCOUNT_TYPES_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();

            if (data.success) {
                Swal.fire('Saved!', isEdit ? 'Discount type updated.' : 'Discount type added.', 'success');
                loadDiscountTypes();
            } else {
                Swal.fire('Error', data.message || 'Could not save discount type.', 'error');
            }
        } catch (err) {
            console.error('Save discount type error:', err);
            Swal.fire('Error', 'Could not save discount type.', 'error');
        }
    });
}

function editDiscountType(typeId) {
    // We re-fetch the list to get the freshest row, then open the edit modal.
    fetch(DISCOUNT_TYPES_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list' })
    })
        .then(res => res.json())
        .then(data => {
            if (!data.success) {
                Swal.fire('Error', 'Could not load discount types.', 'error');
                return;
            }
            const type = (data.types || []).find(t => parseInt(t.discount_type_id, 10) === parseInt(typeId, 10));
            if (!type) {
                Swal.fire('Error', 'Discount type not found.', 'error');
                return;
            }
            openDiscountTypeModal('edit', type);
        })
        .catch(err => {
            console.error('Edit discount type error:', err);
            Swal.fire('Error', 'Could not load discount type.', 'error');
        });
}

async function deactivateDiscountType(typeId) {
    const result = await Swal.fire({
        title: 'Deactivate Discount Type?',
        text: 'This will hide it from the cashier counter. Existing discounts already applied are not affected.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc3545',
        cancelButtonColor: '#6c757d',
        confirmButtonText: 'Yes, deactivate it!'
    });

    if (!result.isConfirmed) return;

    try {
        const res = await fetch(DISCOUNT_TYPES_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'delete', discount_type_id: typeId })
        });
        const data = await res.json();

        if (data.success) {
            Swal.fire('Deactivated!', 'Discount type deactivated.', 'success');
            loadDiscountTypes();
        } else {
            Swal.fire('Error', data.message || 'Could not deactivate discount type.', 'error');
        }
    } catch (err) {
        console.error('Deactivate discount type error:', err);
        Swal.fire('Error', 'Could not deactivate discount type.', 'error');
    }
}

// ==========================================
// 🌟 FIXED COMMENT LINE AND NOTIFICATION LIVE ALERTS COMPILER
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

// ==========================================
// AUTO-LOAD INVENTORY DATA FOR THE NOTIFICATION PANEL
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    // Check daily backup status
    checkDailyBackupStatus();
    
    // Load backup history
    loadBackupHistory();
    
    // Reuses your existing backend route to keep the layout badge up to date on settings screen
    fetch('/backend/admin/settings/get_materials.php')
        .then(res => res.json())
        .then(result => {
            if (result.status === 'success' && result.data) {
                checkStockAlerts(result.data);
            }
        })
        .catch(err => console.error("Failed to load background alerts context loop:", err));
});