/**
 * Activity Logs - Admin Module
 * Handles loading, filtering, pagination, export, and print of system activity logs
 * Works with the activity_logs table (single source of truth — REQ-050)
 */
document.addEventListener('DOMContentLoaded', function() {
    // REQ-054 B3-B: detect the app root so /backend/ API calls work on
    // subfolder installs (localhost) and from the domain root (InfinityFree).
    const APP_ROOT = (() => {
        try {
            const m = window.location.pathname.match(/^(.*?)(?:\/public|\/customer|\/backend|\/admin|\/cashier|\/inventoryStaff|\/kitchenStaff|\/waiter|\/supervisor)(?:\/|$)/i);
            return (m && m[1]) ? m[1].replace(/\/$/, '') : '';
        } catch (_) { return ''; }
    })();

    // State
    let currentPage = 1;
    let currentFilters = {
        date_from: '',
        date_to: '',
        action_type: '',
        role: '',
        module: '',
        status: '',
        user_search: ''
    };
    let pageSize = 50;
    let actionTypes = [];
    let roles = [];
    let modules = [];
    let statuses = [];

    // DOM Elements
    const tableBody = document.getElementById('activityTableBody');
    const filterForm = document.getElementById('filterForm');
    const dateFrom = document.getElementById('dateFrom');
    const dateTo = document.getElementById('dateTo');
    const actionTypeSelect = document.getElementById('actionType');
    const roleFilterSelect = document.getElementById('roleFilter');
    const moduleFilterSelect = document.getElementById('moduleFilter');
    const statusFilterSelect = document.getElementById('statusFilter');
    const userSearch = document.getElementById('userSearch');
    const resetFiltersBtn = document.getElementById('resetFilters');
    const exportBtn = document.getElementById('exportBtn');
    const printBtn = document.getElementById('printBtn');
    const pagination = document.getElementById('pagination');
    const paginationInfo = document.getElementById('paginationInfo');
    const totalRecords = document.getElementById('totalRecords');
    const loadingOverlay = document.getElementById('loadingOverlay');
    const pageSizeSelect = document.getElementById('pageSize');

    // Initialize date defaults (last 7 days — REQ-058)
    const today = new Date();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(today.getDate() - 6);
    dateFrom.value = sevenDaysAgo.toISOString().split('T')[0];
    dateTo.value = today.toISOString().split('T')[0];

    // REQ-050: escapeHtml — XSS-safe escaping for EVERY rendered data field
    function escapeHtml(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Category badge mapping (safe map — never interpolate raw category into the badge)
    const categoryBadgeClasses = {
        'ORDER': 'badge-order',
        'INVENTORY': 'badge-inventory',
        'SALES': 'badge-sales',
        'USER_MGMT': 'badge-user_mgmt',
        'AUTH': 'badge-auth',
        'TABLE': 'badge-table',
        'KITCHEN': 'badge-kitchen',
        'MENU': 'badge-menu',
        'SETTINGS': 'badge-settings',
        'SYSTEM': 'badge-system',
        'CUSTOMER': 'badge-customer'
    };
    const categoryBadgeLabels = {
        'ORDER': 'Order',
        'INVENTORY': 'Inventory',
        'SALES': 'Sales',
        'USER_MGMT': 'User Mgmt',
        'AUTH': 'Auth',
        'TABLE': 'Table',
        'KITCHEN': 'Kitchen',
        'MENU': 'Menu',
        'SETTINGS': 'Settings',
        'SYSTEM': 'System',
        'CUSTOMER': 'Customer'
    };

    // Status badge mapping (safe map — badge built from known classes, label escaped)
    const statusBadgeClasses = {
        'PENDING': 'bg-warning text-dark',
        'APPROVED': 'bg-success',
        'REJECTED': 'bg-danger',
        'COMPLETED': 'bg-success',
        'FAILED': 'bg-danger',
        'CANCELLED': 'bg-secondary',
        'SERVED': 'bg-info text-dark',
        'IN-PROGRESS': 'bg-primary',
        'COOKING': 'bg-primary',
        'Active': 'bg-success',
        'Inactive': 'bg-secondary',
        'DAMAGED': 'bg-danger',
        'EXCESS': 'bg-warning text-dark',
        'OTHER': 'bg-secondary',
        'SPOILAGE': 'bg-danger',
        'WASTE': 'bg-warning text-dark',
        'ADD': 'bg-success',
        'REMOVE': 'bg-danger',
        'LOCKED': 'bg-danger',
        'READ': 'bg-success',
        'Pending': 'bg-warning text-dark',
        'Approved': 'bg-success',
        'Rejected': 'bg-danger',
        'VOIDED': 'bg-danger',
        'CLAIMED': 'bg-info text-dark',
        'Available': 'bg-success'
    };

    // Show/hide loading
    function showLoading(show) {
        loadingOverlay.classList.toggle('active', show);
    }

    // Format date for display
    function formatDateTime(isoString) {
        if (!isoString) return '-';
        const date = new Date(isoString);
        return date.toLocaleString('en-PH', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        });
    }

    // Get status badge (label escaped; safe fallback for unknown statuses)
    function getStatusBadge(status) {
        if (!status) return '-';
        const cls = statusBadgeClasses[status] || 'bg-secondary';
        return `<span class="badge ${cls} status-badge">${escapeHtml(status)}</span>`;
    }

    // Get category badge (from safe maps; raw category never interpolated unescaped)
    function getCategoryBadge(category) {
        const key = category || '';
        const cls = categoryBadgeClasses[key] || 'bg-secondary';
        const label = categoryBadgeLabels[key] || escapeHtml(category || '-');
        return `<span class="badge badge-category ${cls}">${label}</span>`;
    }

    // Style the before→after arrow in descriptions (optional, cheap)
    // REQ-052 B2-4: splitDescription splits the structured log description.
    // Format authored by log_activity_helper.php:
    //   "base description | before → after"
    // It first splits on ' | ', then splits the before→after part on ' → '
    // (or the ASCII ' -> '). Missing pieces render as '-'.
    // Returns { description, before, after }.
    function splitDescription(description) {
        const raw = String(description || '');
        if (!raw) return { description: '-', before: '-', after: '-' };

        const parts = raw.split(' | ');
        let base = parts.length >= 2 ? parts[0].trim() : '';
        const change = parts.length >= 2 ? parts.slice(1).join(' | ').trim() : raw.trim();

        let before = '-';
        let after = '-';
        const arrowIdx = change.search(/ → | -> /);
        if (arrowIdx !== -1) {
            const sep = change[arrowIdx] === '→' ? ' → ' : ' -> ';
            before = change.slice(0, arrowIdx).trim() || '-';
            after = change.slice(arrowIdx + sep.length).trim() || '-';
        } else if (change) {
            // No change separator: treat the whole thing as the description.
            base = change;
            return { description: change, before: '-', after: '-' };
        }

        return { description: base || '-', before, after };
    }

    // Render a description fragment with the diff arrow styling.
    function renderDescriptionFragment(text) {
        const safe = escapeHtml(text || '-');
        return safe.replace(/ → /g, ' <span class="diff-arrow">→</span> ');
    }

    // Load activity logs
    async function loadActivityLogs(page = 1) {
        showLoading(true);
        currentPage = page;

        const params = new URLSearchParams({
            page: page,
            limit: pageSize,
            date_from: currentFilters.date_from,
            date_to: currentFilters.date_to,
            action_type: currentFilters.action_type,
            role: currentFilters.role,
            module: currentFilters.module,
            status: currentFilters.status,
            user_search: currentFilters.user_search
        });

        try {
            const response = await fetch(`${APP_ROOT}/backend/admin/activity_logs.php?${params}`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('hof_token') || ''}`
                }
            });

            if (!response.ok) {
                if (response.status === 401) {
                    localStorage.removeItem('hof_token');
                    redirectToLogin();
                    return;
                }
                const errData = await response.json().catch(() => ({}));
                showError(errData.message || ('Request failed (' + response.status + ')'));
                return;
            }
            const data = await response.json();

            if (data.success) {
                renderTable(data.data, data.pagination && data.pagination.total === 0 ? (data.message || '') : '');
                updatePagination(data.pagination);
                totalRecords.textContent = `${data.pagination.total} records`;
                
                // Update filter options if provided
                if (data.filters) {
                    if (data.filters.action_types && data.filters.action_types.length > 0) {
                        actionTypes = data.filters.action_types;
                        populateSelect(actionTypeSelect, actionTypes);
                    }
                    if (data.filters.roles && data.filters.roles.length > 0) {
                        roles = data.filters.roles;
                        populateSelect(roleFilterSelect, roles);
                    }
                    if (data.filters.modules && data.filters.modules.length > 0) {
                        modules = data.filters.modules;
                        populateSelect(moduleFilterSelect, modules);
                    }
                    if (data.filters.statuses && data.filters.statuses.length > 0) {
                        statuses = data.filters.statuses;
                        populateSelect(statusFilterSelect, statuses);
                    }
                }
            } else {
                showError(data.message || 'Failed to load activity logs');
            }
        } catch (error) {
            console.error('Error loading activity logs:', error);
            showError('Network error. Please try again.');
        } finally {
            showLoading(false);
        }
    }

    // Populate select dropdown
    function populateSelect(select, options) {
        const currentValue = select.value;
        select.innerHTML = '<option value="">All</option>';
        options.forEach(opt => {
            if (opt) {
                const option = document.createElement('option');
                option.value = opt;
                option.textContent = opt.replace(/_/g, ' ');
                select.appendChild(option);
            }
        });
        select.value = currentValue;
    }

    // Render table rows — EVERY interpolated field goes through escapeHtml (REQ-050 XSS fix)
    function renderTable(activities, emptyMessage) {
        if (!activities || activities.length === 0) {
            const msg = (emptyMessage && emptyMessage.trim())
                ? emptyMessage
                : 'No activity logs found for the selected filters';
            tableBody.innerHTML = `
                <tr>
                    <td colspan="10" class="text-center py-5 text-muted">
                        <i class="bi bi-journal-x fs-1"></i>
                        <p class="mt-2 mb-0">${escapeHtml(msg)}</p>
                    </td>
                </tr>
            `;
            return;
        }

        tableBody.innerHTML = activities.map(activity => {
            const actor = activity.username || activity.actor_name || activity.actor_username || '-';
            const role = activity.user_role || activity.actor_role || '-';
            const refNum = activity.reference_number || '-';
            const category = activity.action_category || '-';
            const status = activity.status || null;
            const action = activity.action_type || '-';
            const parts = splitDescription(activity.description);
            
            return `
            <tr>
                <td class="text-nowrap">${escapeHtml(formatDateTime(activity.activity_date))}</td>
                <td>${getCategoryBadge(category)}</td>
                <td class="text-nowrap"><small>${escapeHtml(action)}</small></td>
                <td class="text-nowrap"><code class="small">${escapeHtml(refNum)}</code></td>
                <td><small>${renderDescriptionFragment(parts.before)}</small></td>
                <td><small>${renderDescriptionFragment(parts.after)}</small></td>
                <td><small>${renderDescriptionFragment(parts.description)}</small></td>
                <td class="text-nowrap"><small>${escapeHtml(actor)}</small></td>
                <td class="text-nowrap"><small class="text-muted">${escapeHtml(role)}</small></td>
                <td>${getStatusBadge(status)}</td>
            </tr>
        `}).join('');
    }

    // Update pagination
    function updatePagination(paginationData) {
        const { page, total_pages, total } = paginationData;
        const start = (page - 1) * pageSize + 1;
        const end = Math.min(page * pageSize, total);
        
        paginationInfo.textContent = `Showing ${start}–${end} of ${total} records`;

        let html = '';
        
        // Previous button
        html += `
            <li class="page-item ${page <= 1 ? 'disabled' : ''}">
                <a class="page-link" href="#" data-page="${page - 1}" aria-label="Previous">
                    <i class="bi bi-chevron-left"></i>
                </a>
            </li>
        `;

        // Page numbers
        let startPage = Math.max(1, page - 2);
        let endPage = Math.min(total_pages, page + 2);
        
        if (startPage > 1) {
            html += `<li class="page-item"><a class="page-link" href="#" data-page="1">1</a></li>`;
            if (startPage > 2) {
                html += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
            }
        }

        for (let i = startPage; i <= endPage; i++) {
            html += `
                <li class="page-item ${i === page ? 'active' : ''}">
                    <a class="page-link" href="#" data-page="${i}">${i}</a>
                </li>
            `;
        }

        if (endPage < total_pages) {
            if (endPage < total_pages - 1) {
                html += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
            }
            html += `<li class="page-item"><a class="page-link" href="#" data-page="${total_pages}">${total_pages}</a></li>`;
        }

        // Next button
        html += `
            <li class="page-item ${page >= total_pages ? 'disabled' : ''}">
                <a class="page-link" href="#" data-page="${page + 1}" aria-label="Next">
                    <i class="bi bi-chevron-right"></i>
                </a>
            </li>
        `;

        pagination.innerHTML = html;

        // Add click handlers
        pagination.querySelectorAll('.page-link').forEach(link => {
            link.addEventListener('click', function(e) {
                e.preventDefault();
                const page = parseInt(this.dataset.page);
                if (page && page !== currentPage) {
                    loadActivityLogs(page);
                }
            });
        });
    }

    // Show error message
    function showError(message) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="10" class="text-center py-5 text-danger">
                    <i class="bi bi-exclamation-triangle fs-1"></i>
                    <p class="mt-2 mb-0">${message}</p>
                </td>
            </tr>
        `;
    }

    // Redirect to login based on current page depth (REQ-058)
    function redirectToLogin() {
        const path = window.location.pathname;
        const depth = path.split('/').filter(Boolean).length;
        const prefix = '../'.repeat(Math.max(0, depth - 1));
        window.location.href = prefix + 'index.html';
    }

    // Export to CSV — REQ-050: pass export=1 so the server returns the FULL filtered set (no 100-row clamp)
    function exportCSV() {
        const params = new URLSearchParams({
            page: 1,
            export: 1,
            date_from: currentFilters.date_from,
            date_to: currentFilters.date_to,
            action_type: currentFilters.action_type,
            role: currentFilters.role,
            module: currentFilters.module,
            status: currentFilters.status,
            user_search: currentFilters.user_search
        });

        fetch(`${APP_ROOT}/backend/admin/activity_logs.php?${params}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('hof_token') || ''}`
            }
        })
        .then(response => {
            if (!response.ok) {
                if (response.status === 401) {
                    localStorage.removeItem('hof_token');
                    redirectToLogin();
                    throw new Error('__redirect__');
                }
                return response.json().catch(() => ({})).then(errData => {
                    showToast(errData.message || ('Request failed (' + response.status + ')'), 'danger');
                    throw new Error('__stopped__');
                });
            }
            return response.json();
        })
        .then(data => {
            if (data.success && data.data.length > 0) {
                const headers = ['Date & Time', 'Category', 'Action Type', 'Reference', 'Description', 'Actor', 'Role', 'Status'];
                const rows = data.data.map(activity => [
                    formatDateTime(activity.activity_date),
                    activity.action_category,
                    activity.action_type,
                    activity.reference_number,
                    activity.description,
                    activity.username || activity.actor_name || activity.actor_username,
                    activity.user_role || activity.actor_role,
                    activity.status
                ]);

                const csv = [headers.join(','), ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))].join('\n');
                
                const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = `activity_logs_${new Date().toISOString().split('T')[0]}.csv`;
                link.click();
                URL.revokeObjectURL(link.href);
                
                showToast('Export successful!', 'success');
            } else {
                showToast('No data to export', 'warning');
            }
        })
        .catch(error => {
            console.error('Export error:', error);
            showToast('Export failed', 'danger');
        });
    }

    // Print / PDF — REQ-050: print-friendly view via window.print()
    function printLogs() {
        window.print();
    }

    // Show toast notification
    function showToast(message, type = 'info') {
        // loading.js exposes toasts as `Toast` (success/error/warning/info).
        // `LoadingManager.showToast` does not exist — 'danger' maps to 'error'.
        var icon = (type === 'danger') ? 'error' : type;
        if (window.Toast && typeof window.Toast[icon] === 'function') {
            window.Toast[icon](message);
        } else if (typeof Swal !== 'undefined') {
            var valid = ['error', 'warning', 'success', 'info'];
            Swal.fire({ text: message, icon: valid.indexOf(icon) > -1 ? icon : 'info' });
        } else {
            alert(message);
        }
    }

    // Event Listeners
    // REQ-052 B2-4: filters apply automatically — change listeners on the
    // selects + dates, and a debounced input on the search box. The old funnel
    // submit button was removed from the markup; this handler just guards
    // against a stray Enter key submitting the form.
    filterForm.addEventListener('submit', function(e) {
        e.preventDefault();
        applyFilters();
    });

    // Read the current controls into currentFilters and reload from page 1.
    function applyFilters() {
        currentFilters = {
            date_from: dateFrom.value,
            date_to: dateTo.value,
            action_type: actionTypeSelect.value,
            role: roleFilterSelect.value,
            module: moduleFilterSelect.value,
            status: statusFilterSelect.value,
            user_search: userSearch.value.trim()
        };
        loadActivityLogs(1);
    }

    // Change listeners: every select + date range reloads immediately.
    [moduleFilterSelect, actionTypeSelect, roleFilterSelect, statusFilterSelect, dateFrom, dateTo].forEach(el => {
        if (el) el.addEventListener('change', applyFilters);
    });

    // Debounced live search (~350ms).
    let searchTimer;
    if (userSearch) {
        userSearch.addEventListener('input', function() {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(applyFilters, 350);
        });
    }

    // Page size: reload from page 1 using the new limit.
    if (pageSizeSelect) {
        pageSizeSelect.addEventListener('change', function() {
            pageSize = parseInt(pageSizeSelect.value, 10) || 50;
            currentPage = 1;
            loadActivityLogs(1);
        });
    }

    resetFiltersBtn.addEventListener('click', function() {
        dateFrom.value = sevenDaysAgo.toISOString().split('T')[0];
        dateTo.value = today.toISOString().split('T')[0];
        actionTypeSelect.value = '';
        roleFilterSelect.value = '';
        moduleFilterSelect.value = '';
        statusFilterSelect.value = '';
        userSearch.value = '';
        currentFilters = {
            date_from: dateFrom.value,
            date_to: dateTo.value,
            action_type: '',
            role: '',
            module: '',
            status: '',
            user_search: ''
        };
        loadActivityLogs(1);
    });

    exportBtn.addEventListener('click', exportCSV);
    if (printBtn) printBtn.addEventListener('click', printLogs);

    // Initial load
    loadActivityLogs(1);
});