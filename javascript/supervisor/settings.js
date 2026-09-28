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
});

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