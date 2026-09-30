/**
 * Activity Logs - Admin Module
 * Handles loading, filtering, pagination, and export of system activity logs
 * Works with the new activity_logs table (with UNION fallback for historical data)
 */
document.addEventListener('DOMContentLoaded', function() {
    // State
    let currentPage = 1;
    let currentFilters = {
        date_from: '',
        date_to: '',
        action_type: '',
        role: '',
        user_search: ''
    };
    let actionTypes = [];
    let roles = [];

    // DOM Elements
    const tableBody = document.getElementById('activityTableBody');
    const filterForm = document.getElementById('filterForm');
    const dateFrom = document.getElementById('dateFrom');
    const dateTo = document.getElementById('dateTo');
    const actionTypeSelect = document.getElementById('actionType');
    const roleFilterSelect = document.getElementById('roleFilter');
    const userSearch = document.getElementById('userSearch');
    const resetFiltersBtn = document.getElementById('resetFilters');
    const exportBtn = document.getElementById('exportBtn');
    const pagination = document.getElementById('pagination');
    const paginationInfo = document.getElementById('paginationInfo');
    const totalRecords = document.getElementById('totalRecords');
    const loadingOverlay = document.getElementById('loadingOverlay');

    // Initialize date defaults
    const today = new Date();
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    // REQ-049: Supervisor 31-day rolling window bounds (UI prevention)
    function getWindowBounds() {
        const max = new Date();
        const min = new Date();
        min.setDate(min.getDate() - 31);
        return {
            min: `${min.getFullYear()}-${String(min.getMonth() + 1).padStart(2, '0')}-${String(min.getDate()).padStart(2, '0')}`,
            max: `${max.getFullYear()}-${String(max.getMonth() + 1).padStart(2, '0')}-${String(max.getDate()).padStart(2, '0')}`
        };
    }
    function isWithinWindow(start, end) {
        if (!start || !end) return true;
        const bounds = getWindowBounds();
        if (start < bounds.min || start > bounds.max) return false;
        if (end < bounds.min || end > bounds.max) return false;
        const spanDays = Math.round((new Date(end + 'T00:00:00') - new Date(start + 'T00:00:00')) / 86400000);
        if (spanDays > 31) return false;
        return true;
    }
    const windowBounds = getWindowBounds();
    dateFrom.min = windowBounds.min;
    dateFrom.max = windowBounds.max;
    dateTo.min = windowBounds.min;
    dateTo.max = windowBounds.max;

    dateFrom.value = firstDayOfMonth.toISOString().split('T')[0];
    dateTo.value = today.toISOString().split('T')[0];

    // Category badge mapping
    const categoryBadges = {
        'ORDER': '<span class="badge badge-category badge-order">Order</span>',
        'INVENTORY': '<span class="badge badge-category badge-inventory">Inventory</span>',
        'SALES': '<span class="badge badge-category badge-sales">Sales</span>',
        'USER_MGMT': '<span class="badge badge-category badge-user_mgmt">User Mgmt</span>',
        'AUTH': '<span class="badge badge-category badge-auth">Auth</span>',
        'MENU': '<span class="badge badge-category badge-menu">Menu</span>',
        'SETTINGS': '<span class="badge badge-category badge-settings">Settings</span>',
        'SYSTEM': '<span class="badge badge-category badge-system">System</span>'
    };

    // Status badge mapping
    const statusBadges = {
        'PENDING': '<span class="badge bg-warning text-dark status-badge">Pending</span>',
        'APPROVED': '<span class="badge bg-success status-badge">Approved</span>',
        'REJECTED': '<span class="badge bg-danger status-badge">Rejected</span>',
        'COMPLETED': '<span class="badge bg-success status-badge">Completed</span>',
        'FAILED': '<span class="badge bg-danger status-badge">Failed</span>',
        'CANCELLED': '<span class="badge bg-secondary status-badge">Cancelled</span>',
        'SERVED': '<span class="badge bg-info text-dark status-badge">Served</span>',
        'IN-PROGRESS': '<span class="badge bg-primary status-badge">In Progress</span>',
        'COOKING': '<span class="badge bg-primary status-badge">Cooking</span>',
        'Active': '<span class="badge bg-success status-badge">Active</span>',
        'Inactive': '<span class="badge bg-secondary status-badge">Inactive</span>',
        'DAMAGED': '<span class="badge bg-danger status-badge">Damaged</span>',
        'EXCESS': '<span class="badge bg-warning text-dark status-badge">Excess</span>',
        'OTHER': '<span class="badge bg-secondary status-badge">Other</span>',
        'SPOILAGE': '<span class="badge bg-danger status-badge">Spoilage</span>',
        'WASTE': '<span class="badge bg-warning text-dark status-badge">Waste</span>',
        'ADD': '<span class="badge bg-success status-badge">Add</span>',
        'REMOVE': '<span class="badge bg-danger status-badge">Remove</span>'
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

    // Get status badge
    function getStatusBadge(status) {
        return statusBadges[status] || `<span class="badge bg-secondary status-badge">${status || '-'}</span>`;
    }

    // Get category badge
    function getCategoryBadge(category) {
        return categoryBadges[category] || `<span class="badge badge-category bg-secondary">${category || '-'}</span>`;
    }

    // Load activity logs
    async function loadActivityLogs(page = 1) {
        showLoading(true);
        currentPage = page;

        const params = new URLSearchParams({
            page: page,
            limit: 50,
            date_from: currentFilters.date_from,
            date_to: currentFilters.date_to,
            action_type: currentFilters.action_type,
            role: currentFilters.role,
            user_search: currentFilters.user_search
        });

        try {
            const response = await fetch(`/backend/admin/activity_logs.php?${params}`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('hof_token') || ''}`
                }
            });

            const data = await response.json();

            if (data.success) {
                renderTable(data.data);
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

    // Render table rows
    function renderTable(activities) {
        if (!activities || activities.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="8" class="text-center py-5 text-muted">
                        <i class="bi bi-journal-x fs-1"></i>
                        <p class="mt-2 mb-0">No activity logs found for the selected filters</p>
                    </td>
                </tr>
            `;
            return;
        }

        tableBody.innerHTML = activities.map(activity => {
            // Support both the new activity_logs table format and the old UNION format
            const actor = activity.username || activity.actor_name || activity.actor_username || '-';
            const role = activity.user_role || activity.actor_role || '-';
            const refNum = activity.reference_number || '-';
            const category = activity.action_category || '-';
            const status = activity.status || null;
            
            return `
            <tr>
                <td class="text-nowrap">${formatDateTime(activity.activity_date)}</td>
                <td>${getCategoryBadge(category)}</td>
                <td class="text-nowrap"><small>${activity.action_type || '-'}</small></td>
                <td class="text-nowrap"><code class="small">${refNum}</code></td>
                <td><small>${activity.description || '-'}</small></td>
                <td class="text-nowrap"><small>${actor}</small></td>
                <td class="text-nowrap"><small class="text-muted">${role}</small></td>
                <td>${status ? getStatusBadge(status) : '-'}</td>
            </tr>
        `}).join('');
    }

    // Update pagination
    function updatePagination(paginationData) {
        const { page, total_pages, total } = paginationData;
        const start = (page - 1) * 50 + 1;
        const end = Math.min(page * 50, total);
        
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
                <td colspan="8" class="text-center py-5 text-danger">
                    <i class="bi bi-exclamation-triangle fs-1"></i>
                    <p class="mt-2 mb-0">${message}</p>
                </td>
            </tr>
        `;
    }

    // Export to CSV
    function exportCSV() {
        const params = new URLSearchParams({
            page: 1,
            limit: 10000, // Large limit to get all
            date_from: currentFilters.date_from,
            date_to: currentFilters.date_to,
            action_type: currentFilters.action_type,
            role: currentFilters.role,
            user_search: currentFilters.user_search
        });

        fetch(`/backend/admin/activity_logs.php?${params}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('hof_token') || ''}`
            }
        })
        .then(response => response.json())
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
    filterForm.addEventListener('submit', function(e) {
        e.preventDefault();
        if (!isWithinWindow(dateFrom.value, dateTo.value)) {
            currentFilters = {
                date_from: dateFrom.value,
                date_to: dateTo.value,
                action_type: actionTypeSelect.value,
                role: roleFilterSelect.value,
                user_search: userSearch.value.trim()
            };
            Swal.fire({ icon: 'error', title: 'Invalid Date Range', text: 'Supervisor access is limited to the last 31 days.' });
            return;
        }
        currentFilters = {
            date_from: dateFrom.value,
            date_to: dateTo.value,
            action_type: actionTypeSelect.value,
            role: roleFilterSelect.value,
            user_search: userSearch.value.trim()
        };
        loadActivityLogs(1);
    });

    resetFiltersBtn.addEventListener('click', function() {
        dateFrom.value = firstDayOfMonth.toISOString().split('T')[0];
        dateTo.value = today.toISOString().split('T')[0];
        actionTypeSelect.value = '';
        roleFilterSelect.value = '';
        userSearch.value = '';
        currentFilters = {
            date_from: dateFrom.value,
            date_to: dateTo.value,
            action_type: '',
            role: '',
            user_search: ''
        };
        loadActivityLogs(1);
    });

    exportBtn.addEventListener('click', exportCSV);

    // Initial load
    loadActivityLogs(1);
});