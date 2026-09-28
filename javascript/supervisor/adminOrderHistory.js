/**
 * Admin Order History - Modular Vanilla JS
 * Follows admin/cashier pattern: init() → loadData() → setupEvents() → renderData()
 * Accessible by Admin, Supervisor, Kitchen Staff roles
 * Dropdown detail per row for order items breakdown
 */

// ============= NAMESPACE & GLOBAL STATE =============
const AdminOrderHistoryAPI = (function () {
    const BASE_URL = '../../backend/kitchenStaff/kitchenkds';
    const TOKEN_KEY = 'hof_token';

    async function fetchAPI(endpoint, options = {}) {
        const token = localStorage.getItem(TOKEN_KEY);
        if (!token) throw new Error('No authentication token found');

        const url = `${BASE_URL}${endpoint}${endpoint.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                }
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const error = await response.json().catch(() => ({ message: 'Request failed' }));
                throw new Error(error.message || `HTTP ${response.status}`);
            }

            return await response.json();
        } catch (err) {
            clearTimeout(timeoutId);
            if (err.name === 'AbortError') throw new Error('Request timeout');
            throw err;
        }
    }

    return {
        async getHistory(params = {}) {
            const query = new URLSearchParams({
                page: params.page || 1,
                limit: params.limit || 20,
                status: params.status || '',
                order_type: params.type || '',
                payment_method: params.paymentMethod || '',
                cashier: params.cashier || '',
                date_from: params.dateFrom || '',
                date_to: params.dateTo || '',
                search: params.search || ''
            }).toString();

            return fetchAPI(`/get_history.php?${query}`);
        },

        async getOrderDetails(orderId) {
            return fetchAPI(`/get_order_details.php?order_id=${encodeURIComponent(orderId)}`);
        },

        async exportCSV(params = {}) {
            const query = new URLSearchParams({
                export: 'csv',
                status: params.status || '',
                order_type: params.type || '',
                payment_method: params.paymentMethod || '',
                cashier: params.cashier || '',
                date_from: params.dateFrom || '',
                date_to: params.dateTo || '',
                search: params.search || ''
            }).toString();

            const token = localStorage.getItem(TOKEN_KEY);
            const url = `${BASE_URL}/get_history.php?${query}&token=${encodeURIComponent(token)}`;

            const response = await fetch(url);
            if (!response.ok) throw new Error('Export failed');

            const blob = await response.blob();
            const url_blob = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url_blob;
            a.download = `order-history-${new Date().toISOString().split('T')[0]}.csv`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url_blob);
            document.body.removeChild(a);
        }
    };
})();

// ============= UI CONTROLLER =============
const AdminOrderHistoryUI = (function () {
    // State
    let state = {
        orders: [],
        pagination: { page: 1, limit: 20, total: 0, total_pages: 1 },
        expandedOrderId: null,
        expandedDetailCache: new Map(),
        filters: {
            search: '',
            status: '',
            type: '',
            paymentMethod: '',
            cashier: '',
            dateFrom: '',
            dateTo: ''
        },
        isLoading: false
    };

    // DOM Elements
    let elements = {};

    function cacheElements() {
        elements = {
            tableBody: document.getElementById('ordersTableBody'),
            paginationList: document.getElementById('paginationList'),
            paginationContainer: document.getElementById('paginationContainer'),
            searchInput: document.getElementById('searchInput'),
            statusFilter: document.getElementById('statusFilter'),
            typeFilter: document.getElementById('typeFilter'),
            paymentMethodFilter: document.getElementById('paymentMethodFilter'),
            cashierFilter: document.getElementById('cashierFilter'),
            dateFrom: document.getElementById('dateFrom'),
            dateTo: document.getElementById('dateTo'),
            statRevenue: document.getElementById('statRevenue'),
            statTotalOrders: document.getElementById('statTotalOrders'),
            statCompletedToday: document.getElementById('statCompletedToday'),
            statAvgOrder: document.getElementById('statAvgOrder')
        };
    }

    // ============ INIT ============
    async function init() {
        cacheElements();
        setupEvents();
        await loadData();
    }

    // ============ EVENT SETUP ============
    function setupEvents() {
        // Search with debounce
        let searchDebounce;
        if (elements.searchInput) {
            elements.searchInput.addEventListener('input', () => {
                clearTimeout(searchDebounce);
                searchDebounce = setTimeout(() => {
                    state.filters.search = elements.searchInput.value.trim();
                    state.pagination.page = 1;
                    loadData();
                }, 300);
            });

            elements.searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    clearTimeout(searchDebounce);
                    state.filters.search = elements.searchInput.value.trim();
                    state.pagination.page = 1;
                    loadData();
                }
            });
        }

        // Status filter
        if (elements.statusFilter) {
            elements.statusFilter.addEventListener('change', () => {
                state.filters.status = elements.statusFilter.value;
                state.pagination.page = 1;
                loadData();
            });
        }

        // Type filter
        if (elements.typeFilter) {
            elements.typeFilter.addEventListener('change', () => {
                state.filters.type = elements.typeFilter.value;
                state.pagination.page = 1;
                loadData();
            });
        }

        // Payment method filter (Cash / GCash)
        if (elements.paymentMethodFilter) {
            elements.paymentMethodFilter.addEventListener('change', () => {
                state.filters.paymentMethod = elements.paymentMethodFilter.value;
                state.pagination.page = 1;
                loadData();
            });
        }

        // Cashier / attribution filter (includes "Admin" for online GCash orders)
        if (elements.cashierFilter) {
            elements.cashierFilter.addEventListener('change', () => {
                state.filters.cashier = elements.cashierFilter.value;
                state.pagination.page = 1;
                loadData();
            });
        }

        // Date filters
        if (elements.dateFrom) {
            elements.dateFrom.addEventListener('change', () => {
                state.filters.dateFrom = elements.dateFrom.value;
                state.pagination.page = 1;
                loadData();
            });
        }

        if (elements.dateTo) {
            elements.dateTo.addEventListener('change', () => {
                state.filters.dateTo = elements.dateTo.value;
                state.pagination.page = 1;
                loadData();
            });
        }
    }

    // ============ DATA LOADING ============
    async function loadData() {
        if (state.isLoading) return;
        state.isLoading = true;

        showLoading();

        try {
            const result = await AdminOrderHistoryAPI.getHistory({
                page: state.pagination.page,
                limit: state.pagination.limit,
                status: state.filters.status,
                type: state.filters.type,
                paymentMethod: state.filters.paymentMethod,
                cashier: state.filters.cashier,
                dateFrom: state.filters.dateFrom,
                dateTo: state.filters.dateTo,
                search: state.filters.search
            });

            if (result.status === 'success') {
                state.orders = result.data.data;
                state.pagination = result.data.pagination;
                renderTable();
                renderPagination();
                updateStats(result.data.stats);
                populateCashierFilter(result.data.cashiers);
            } else {
                showError(result.message || 'Failed to load orders');
            }
        } catch (err) {
            console.error('Load orders error:', err);
            showError(err.message || 'Failed to load orders. Please try again.');
        } finally {
            state.isLoading = false;
        }
    }

    // Populate cashier dropdown from API (preserve current selection)
    function populateCashierFilter(cashiers) {
        if (!elements.cashierFilter || !Array.isArray(cashiers) || cashiers.length === 0) return;
        if (elements.cashierFilter.dataset.populated === '1') return;

        const current = elements.cashierFilter.value;
        cashiers.forEach(name => {
            if (!name) return;
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name === 'Admin' ? 'Admin (Online GCash)' : name;
            elements.cashierFilter.appendChild(opt);
        });
        elements.cashierFilter.value = current;
        elements.cashierFilter.dataset.populated = '1';
    }

    // ============ RENDER ============
    function renderTable() {
        if (!elements.tableBody) return;

        if (state.orders.length === 0) {
            elements.tableBody.innerHTML = `
                <tr>
                    <td colspan="11" class="text-center py-5 text-muted">
                        <i class="bi bi-inbox fs-1 d-block mb-2"></i>
                        No orders found
                    </td>
                </tr>
            `;
            return;
        }

        elements.tableBody.innerHTML = state.orders.map(order => `
            <tr class="order-row ${state.expandedOrderId === order.order_id ? 'expanded' : ''}"
                data-order-id="${order.order_id}"
                onclick="AdminOrderHistoryUI.toggleDetail(${order.order_id})">
                <td>
                    <i class="bi bi-chevron-down expand-icon text-muted" style="font-size: 0.85rem;"></i>
                </td>
                <td class="fw-semibold text-dark">#${order.order_id}</td>
                <td class="text-muted">${order.reference_number || '—'}</td>
                <td class="text-muted">${formatDateTime(order.ordered_at)}</td>
                <td><span class="type-badge ${getTypeBadgeClass(order.order_type)}">${formatOrderType(order.order_type)}</span></td>
                <td><span class="status-badge ${getStatusBadgeClass(order.status)}">${formatStatus(order.status)}</span></td>
                <td>${formatPaymentCell(order)}</td>
                <td class="text-muted">${order.customer_name || 'Walk-in'}</td>
                <td class="text-muted">${order.table_number ? `Table ${order.table_number}` : '—'}</td>
                <td class="text-end fw-semibold text-dark">₱${formatNumber(order.total_amount)}</td>
            </tr>
            <tr class="order-detail-row ${state.expandedOrderId === order.order_id ? 'expanded' : ''}" data-detail-for="${order.order_id}">
                <td colspan="11" class="order-detail-cell">
                    <div class="order-detail-content" id="detail-content-${order.order_id}">
                        <div class="text-center py-4 text-muted">
                            <div class="spinner-border spinner-border-sm text-warning" role="status"></div>
                            <span class="ms-2">Loading details...</span>
                        </div>
                    </div>
                </td>
            </tr>
        `).join('');
    }

    function renderDetailContent(orderId, detailData) {
        const container = document.getElementById(`detail-content-${orderId}`);
        if (!container || !detailData) return;

        const order = detailData.data?.order || state.orders.find(o => o.order_id === orderId);
        const items = detailData.data?.items || order?.items || [];

        if (!order) {
            container.innerHTML = '<div class="text-center py-4 text-muted">Order details not available</div>';
            return;
        }

        // Group items by category
        const itemsByCategory = items.reduce((acc, item) => {
            const cat = item.category_name || 'Uncategorized';
            if (!acc[cat]) acc[cat] = [];
            acc[cat].push(item);
            return acc;
        }, {});

        let html = `
            <div class="row mb-3">
                <div class="col-md-3">
                    <small class="text-muted d-block">Order ID</small>
                    <strong>#${order.order_id}</strong>
                </div>
                <div class="col-md-3">
                    <small class="text-muted d-block">Reference</small>
                    <strong>${order.reference_number || '—'}</strong>
                </div>
                <div class="col-md-3">
                    <small class="text-muted d-block">Ordered At</small>
                    <strong>${formatDateTime(order.ordered_at)}</strong>
                </div>
                <div class="col-md-3">
                    <small class="text-muted d-block">Completed At</small>
                    <strong>${order.completed_at ? formatDateTime(order.completed_at) : '—'}</strong>
                </div>
            </div>
            <div class="row mb-3">
                <div class="col-md-3">
                    <small class="text-muted d-block">Order Type</small>
                    <span class="type-badge ${getTypeBadgeClass(order.order_type)}">${formatOrderType(order.order_type)}</span>
                </div>
                <div class="col-md-3">
                    <small class="text-muted d-block">Status</small>
                    <span class="status-badge ${getStatusBadgeClass(order.status)}">${formatStatus(order.status)}</span>
                </div>
                <div class="col-md-3">
                    <small class="text-muted d-block">Customer</small>
                    <strong>${order.customer_name || 'Walk-in'}</strong>
                </div>
                <div class="col-md-3">
                    <small class="text-muted d-block">Table</small>
                    <strong>${order.table_number ? `Table ${order.table_number}` : '—'}</strong>
                </div>
            </div>
            <hr class="my-3">
        `;

        for (const [category, catItems] of Object.entries(itemsByCategory)) {
            html += `<div class="item-category-label">${category}</div>`;

            catItems.forEach(item => {
                const specialInst = item.special_instructions ? `
                    <span class="special-instruction-badge">
                        <i class="bi bi-chat-left-text"></i> ${escapeHtmlStr(item.special_instructions)}
                    </span>
                ` : '';

                const cleanImgUrl = item.image_url ? `/images/menu/${item.image_url.split('/').pop().split('?')[0]}` : '';

                html += `
                    <div class="order-detail-item">
                        <div class="d-flex align-items-center gap-2">
                            ${cleanImgUrl ? `<img src="${cleanImgUrl}" alt="${item.item_name}" style="width: 32px; height: 32px; border-radius: 6px; object-fit: cover;">` : ''}
                            <div>
                                <div class="fw-medium small">${item.item_name}</div>
                                ${item.description ? `<small class="text-muted">${item.description}</small>` : ''}
                                ${specialInst}
                            </div>
                        </div>
                        <div class="text-end">
                            <div class="fw-semibold small">${item.quantity} × ₱${formatNumber(item.price)}</div>
                            <div class="text-muted small">₱${formatNumber(item.subtotal)}</div>
                        </div>
                    </div>
                `;
            });
        }

        html += `
            <hr class="my-3">
            <div class="d-flex justify-content-between align-items-center">
                <div>
                    <small class="text-muted">Subtotal</small>
                </div>
                <div class="fw-bold text-dark fs-5">₱${formatNumber(order.total_amount)}</div>
            </div>
        `;

        container.innerHTML = html;
    }

    function renderPagination() {
        if (!elements.paginationList) return;
        const { page, total_pages } = state.pagination;

        if (total_pages <= 1) {
            elements.paginationList.innerHTML = '';
            return;
        }

        let html = '';

        // Previous
        html += `
            <li class="page-item ${page === 1 ? 'disabled' : ''}">
                <button class="page-link" onclick="AdminOrderHistoryUI.goToPage(${page - 1})" aria-label="Previous">
                    <i class="bi bi-chevron-left"></i>
                </button>
            </li>
        `;

        const maxVisible = 5;
        let start = Math.max(1, page - Math.floor(maxVisible / 2));
        let end = Math.min(total_pages, start + maxVisible - 1);

        if (end - start + 1 < maxVisible) {
            start = Math.max(1, end - maxVisible + 1);
        }

        if (start > 1) {
            html += `<li class="page-item"><button class="page-link" onclick="AdminOrderHistoryUI.goToPage(1)">1</button></li>`;
            if (start > 2) html += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
        }

        for (let i = start; i <= end; i++) {
            html += `
                <li class="page-item ${i === page ? 'active' : ''}">
                    <button class="page-link" onclick="AdminOrderHistoryUI.goToPage(${i})">${i}</button>
                </li>
            `;
        }

        if (end < total_pages) {
            if (end < total_pages - 1) html += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
            html += `<li class="page-item"><button class="page-link" onclick="AdminOrderHistoryUI.goToPage(${total_pages})">${total_pages}</button></li>`;
        }

        // Next
        html += `
            <li class="page-item ${page === total_pages ? 'disabled' : ''}">
                <button class="page-link" onclick="AdminOrderHistoryUI.goToPage(${page + 1})" aria-label="Next">
                    <i class="bi bi-chevron-right"></i>
                </button>
            </li>
        `;

        elements.paginationList.innerHTML = html;
    }

    function updateStats(serverStats) {
        // Server computes stats over ALL filtered rows (not just current page),
        // and counts only PAID orders toward revenue (advisor rule: paid = sales).
        if (!serverStats) return;

        const totalOrders = parseInt(serverStats.total_orders) || 0;
        const paidRevenue = parseFloat(serverStats.paid_revenue) || 0;
        const avgOrder = parseFloat(serverStats.avg_order_value) || 0;

        if (elements.statTotalOrders) elements.statTotalOrders.textContent = totalOrders;
        if (elements.statRevenue) elements.statRevenue.textContent = `₱${formatNumber(paidRevenue)}`;
        if (elements.statAvgOrder) elements.statAvgOrder.textContent = `₱${formatNumber(avgOrder)}`;
        if (elements.statCompletedToday) {
            const paid = parseInt(serverStats.paid_orders) || 0;
            elements.statCompletedToday.textContent = `${paid} / ${totalOrders}`;
        }
    }

    // ============ ACTIONS ============
    async function toggleDetail(orderId) {
        const row = document.querySelector(`.order-row[data-order-id="${orderId}"]`);
        const detailRow = document.querySelector(`.order-detail-row[data-detail-for="${orderId}"]`);

        if (!row || !detailRow) return;

        const isExpanded = state.expandedOrderId === orderId;

        document.querySelectorAll('.order-row.expanded').forEach(r => r.classList.remove('expanded'));
        document.querySelectorAll('.order-detail-row.expanded').forEach(r => r.classList.remove('expanded'));

        if (isExpanded) {
            state.expandedOrderId = null;
            return;
        }

        row.classList.add('expanded');
        detailRow.classList.add('expanded');
        state.expandedOrderId = orderId;

        if (!state.expandedDetailCache.has(orderId)) {
            try {
                const detail = await AdminOrderHistoryAPI.getOrderDetails(orderId);
                if (detail.status === 'success') {
                    state.expandedDetailCache.set(orderId, detail);
                    renderDetailContent(orderId, detail);
                }
            } catch (err) {
                console.error('Detail load error:', err);
                const container = document.getElementById(`detail-content-${orderId}`);
                if (container) container.innerHTML = '<div class="text-center py-4 text-danger">Failed to load details</div>';
            }
        } else {
            renderDetailContent(orderId, state.expandedDetailCache.get(orderId));
        }
    }

    function goToPage(page) {
        if (page < 1 || page > state.pagination.total_pages) return;
        state.pagination.page = page;
        loadData();
    }

    function clearFilters() {
        state.filters = { search: '', status: '', type: '', paymentMethod: '', cashier: '', dateFrom: '', dateTo: '' };
        if (elements.searchInput) elements.searchInput.value = '';
        if (elements.statusFilter) elements.statusFilter.value = '';
        if (elements.typeFilter) elements.typeFilter.value = '';
        if (elements.paymentMethodFilter) elements.paymentMethodFilter.value = '';
        if (elements.cashierFilter) elements.cashierFilter.value = '';
        if (elements.dateFrom) elements.dateFrom.value = '';
        if (elements.dateTo) elements.dateTo.value = '';
        state.pagination.page = 1;
        loadData();
    }

    async function exportCSV() {
        try {
            await AdminOrderHistoryAPI.exportCSV({
                status: state.filters.status,
                type: state.filters.type,
                paymentMethod: state.filters.paymentMethod,
                cashier: state.filters.cashier,
                dateFrom: state.filters.dateFrom,
                dateTo: state.filters.dateTo,
                search: state.filters.search
            });
            Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'CSV exported', timer: 2000, showConfirmButton: false });
        } catch (err) {
            console.error('Export error:', err);
            Swal.fire({ toast: true, position: 'top-end', icon: 'error', title: 'Export failed', timer: 3000, showConfirmButton: false });
        }
    }

    function printReport() {
        window.print();
    }

    // ============ HELPERS ============
    function showLoading() {
        if (!elements.tableBody) return;
        elements.tableBody.innerHTML = `
            <tr>
                <td colspan="11" class="text-center py-5 text-muted">
                    <div class="spinner-border spinner-border-sm text-warning me-2" role="status"></div>
                    Loading orders...
                </td>
            </tr>
        `;
    }

    function showError(message) {
        if (!elements.tableBody) return;
        elements.tableBody.innerHTML = `
            <tr>
                <td colspan="11" class="text-center py-5">
                    <div class="text-danger">
                        <i class="bi bi-exclamation-triangle fs-1 d-block mb-2"></i>
                        ${message}
                        <button class="btn btn-sm btn-outline-warning mt-2" onclick="AdminOrderHistoryUI.loadData()">
                            <i class="bi bi-arrow-clockwise me-1"></i> Retry
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }

    function formatDateTime(str) {
        if (!str) return '—';
        try {
            const d = new Date(str);
            return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' +
                   d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
        } catch { return str; }
    }

    function formatNumber(num) {
        return parseFloat(num).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function getStatusBadgeClass(status) {
        const map = {
            'COOKING': 'status-cooking',
            'IN-PROGRESS': 'status-inprogress',
            'COMPLETED': 'status-completed',
            'CANCELLED': 'status-cancelled',
            'PENDING': 'status-pending'
        };
        return map[status] || 'status-pending';
    }

    function formatStatus(status) {
        const map = {
            'COOKING': 'Cooking',
            'IN-PROGRESS': 'In Progress',
            'COMPLETED': 'Completed',
            'CANCELLED': 'Cancelled',
            'PENDING': 'Pending'
        };
        return map[status] || status;
    }

    function getTypeBadgeClass(type) {
        const map = { 'DINE_IN': 'type-dine-in', 'TAKE_OUT': 'type-takeout', 'DELIVERY': 'type-takeout' };
        return map[type] || '';
    }

    function formatOrderType(type) {
        const map = { 'DINE_IN': 'Dine In', 'TAKE_OUT': 'Take Out', 'DELIVERY': 'Delivery' };
        return map[type] || type;
    }

    // Payment method chip + cashier attribution (Cash counter OR GCash/PayMongo)
    function formatPaymentCell(order) {
        const isPaid = parseInt(order.is_paid) === 1;
        const method = (order.payment_method || '').toUpperCase();
        const cashier = (order.cashier_name || '').trim();

        if (!isPaid || !method) {
            return '<span class="badge bg-secondary-subtle text-secondary" style="font-size:.68rem;">UNPAID</span>';
        }

        const cls = method === 'GCASH' ? 'bg-primary-subtle text-primary' : 'bg-success-subtle text-success';
        const icon = method === 'GCASH' ? 'bi-phone' : 'bi-cash-coin';
        return `
            <span class="badge ${cls}" style="font-size:.68rem;"><i class="bi ${icon} me-1"></i>${method}</span>
            ${cashier ? `<div class="text-muted" style="font-size:.68rem;margin-top:2px;"><i class="bi bi-person me-1"></i>${escapeHtmlStr(cashier)}</div>` : ''}
        `;
    }

    function escapeHtmlStr(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // ============ PUBLIC API ============
    return {
        init,
        loadData,
        toggleDetail,
        goToPage,
        clearFilters,
        exportCSV,
        printReport
    };
})();

// ============ BOOTSTRAP ============
document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('hof_token');
    if (!token) {
        window.location.href = '../../index.html';
        return;
    }

    // Verify token with check_session using relative path
    fetch('../../backend/check_session.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
    })
    .then(r => r.json())
    .then(data => {
        if (data.loggedIn) {
            const user = data;
            const allowedRoles = ['Admin', 'Supervisor', 'Kitchen Staff'];
            if (!allowedRoles.includes(user.role)) {
                Swal.fire({ icon: 'error', title: 'Access Denied', text: 'Insufficient permissions' })
                    .then(() => window.location.href = '../../index.html');
                return;
            }

            // Safe update sidebar user info with null checks to prevent crashes
            const userNameEl = document.querySelector('.user-name');
            const userRoleEl = document.querySelector('.user-role');
            const userAvatarEl = document.querySelector('.user-avatar');

            if (userNameEl) userNameEl.textContent = `${user.first_name} ${user.last_name}`;
            if (userRoleEl) userRoleEl.textContent = user.role;
            if (userAvatarEl) userAvatarEl.textContent = user.first_name?.charAt(0).toUpperCase() || 'U';

            AdminOrderHistoryUI.init();
        } else {
            window.location.href = '../../index.html';
        }
    })
    .catch(() => window.location.href = '../../index.html');
});