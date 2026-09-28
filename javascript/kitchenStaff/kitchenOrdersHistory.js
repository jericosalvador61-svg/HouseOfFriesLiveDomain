/**
 * Kitchen Orders History - Modular Vanilla JS
 * Follows admin/cashier pattern: init() → loadData() → setupEvents() → renderData()
 * Kitchen Staff, Admin, Supervisor access
 */

// ========================================
// CONFIGURATION
// ========================================
const HISTORY_API = {
    BASE: '/backend/kitchenStaff/kitchenkds/',
    GET_HISTORY: 'get_history.php',
    GET_ORDER_DETAILS: 'get_order_details.php'
};

// ========================================
// STATE
// ========================================
let currentPage = 1;
const pageSize = 20;
let activeTab = 'completed'; // 'completed' | 'cancelled_today'
let currentFilters = {
    search: '',
    status: '',
    type: ''
};

// ========================================
// HELPER FUNCTIONS
// ========================================
function getToken() {
    return localStorage.getItem('hof_token');
}

function getHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`
    };
}

function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&')
        .replace(/</g, '<')
        .replace(/>/g, '>')
        .replace(/"/g, '"')
        .replace(/'/g, '&#039;');
}

function formatCurrency(amount) {
    const n = parseFloat(amount) || 0;
    return '₱' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Format duration between two dates as "Xm Ys" or "Xh Ym"
 */
function formatDuration(startStr, endStr) {
    if (!startStr || !endStr) return '--';
    const start = new Date(startStr);
    const end = new Date(endStr);
    const diffMs = end - start;
    if (diffMs < 0) return '--';
    const totalSeconds = Math.floor(diffMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}

function getPaymentBadgeClass(method) {
    const upper = (method || '').toUpperCase();
    if (upper === 'GCASH') return 'badge bg-info text-dark';
    if (upper === 'CASH') return 'badge bg-success';
    return 'badge bg-secondary';
}

function formatDateTime(dateStr) {
    if (!dateStr) return '--';
    const date = new Date(dateStr);
    return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });
}

function formatTimeOnly(dateStr) {
    if (!dateStr) return '--:--';
    const date = new Date(dateStr);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
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

function getTypeBadgeClass(type) {
    return type === 'TAKE_OUT' ? 'type-takeout' : 'type-dine-in';
}

function getTypeLabel(type) {
    return type === 'TAKE_OUT' ? 'Take Out' : 'Dine In';
}

// ========================================
// API FUNCTIONS
// ========================================
async function fetchHistory(page = 1, filters = {}, tab = 'completed') {
    const params = new URLSearchParams({
        page: page.toString(),
        limit: pageSize.toString(),
        ...filters
    });

    // If cancelled_today tab, add the flag — backend will filter by status=CANCELLED + today
    if (tab === 'cancelled_today') {
        params.set('cancelled_today', '1');
    }

    const res = await fetch(HISTORY_API.BASE + HISTORY_API.GET_HISTORY + '?' + params, {
        method: 'GET',
        headers: getHeaders()
    });

    if (!res.ok) throw new Error('Network error');
    const data = await res.json();

    if (data.status !== 'success') {
        throw new Error(data.message || 'Failed to fetch history');
    }

    return data.data; // { data: [...], pagination: {...} }
}

async function fetchOrderDetails(orderId) {
    const res = await fetch(HISTORY_API.BASE + HISTORY_API.GET_ORDER_DETAILS + '?order_id=' + orderId, {
        method: 'GET',
        headers: getHeaders()
    });

    if (!res.ok) throw new Error('Network error');
    const data = await res.json();

    if (data.status !== 'success') {
        throw new Error(data.message || 'Failed to fetch order details');
    }

    return data.data;
}

// ========================================
// RENDER FUNCTIONS
// ========================================
function renderOrdersTable(orders) {
    const tbody = document.getElementById('ordersTableBody');
    if (!tbody) return;

    if (!orders || orders.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="11" class="text-center py-5 text-muted">
                    <i class="bi bi-journal-x fs-1 d-block mb-2"></i>
                    No orders found matching your filters.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = orders.map((order, index) => {
        const statusClass = getStatusBadgeClass(order.status);
        const typeClass = getTypeBadgeClass(order.order_type);
        const typeLabel = getTypeLabel(order.order_type);
        const itemsSummary = (order.items || []).map(i => `${i.item_name} x${i.quantity}`).join(', ');

        // Payment method display
        let paymentDisplay = '<span class="badge bg-secondary">--</span>';
        if (order.is_paid && order.is_paid == 1) {
            const method = order.payment_method || 'CASH';
            const cls = getPaymentBadgeClass(method);
            paymentDisplay = `<span class="${cls}">${method}</span>`;
        } else if (order.status === 'CANCELLED') {
            paymentDisplay = '<span class="badge bg-danger">VOID</span>';
        }

        // Time to complete (for COMPLETED orders)
        const timeToComplete = order.status === 'COMPLETED'
            ? formatDuration(order.ordered_at, order.completed_at)
            : '--';

        // Table number display
        const tableDisplay = order.table_number
            ? `<span class="badge bg-dark">#${escapeHtml(order.table_number)}</span>`
            : '<span class="text-muted">--</span>';

        return `
            <tr>
                <td class="fw-bold text-dark">${(currentPage - 1) * pageSize + index + 1}</td>
                <td class="fw-semibold text-dark">#${escapeHtml(order.reference_number || order.order_id)}</td>
                <td class="text-center">${tableDisplay}</td>
                <td>${paymentDisplay}</td>
                <td class="text-muted">${formatTimeOnly(order.ordered_at)}</td>
                <td><span class="badge ${typeClass}">${typeLabel}</span></td>
                <td><span class="badge ${statusClass}">${escapeHtml(order.status)}</span></td>
                <td class="text-muted small">${escapeHtml(order.customer_name || 'Walk-in')}</td>
                <td class="text-end fw-bold text-success">${formatCurrency(order.total_amount)}</td>
                <td class="text-muted small text-center">${timeToComplete}</td>
                <td class="text-center">
                    <button class="btn btn-sm btn-light border px-2 py-1" onclick="viewOrderDetails(${order.order_id})">
                        <i class="bi bi-eye"></i> View
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function renderPagination(pagination) {
    const container = document.getElementById('paginationContainer');
    const list = document.getElementById('paginationList');

    if (!container || !list) return;

    if (!pagination || pagination.total_pages <= 1) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'flex';

    let html = '';

    // Previous
    html += `
        <li class="page-item ${currentPage === 1 ? 'disabled' : ''}">
            <a class="page-link" href="#" onclick="kitchenHistoryUI.goToPage(${currentPage - 1})" aria-label="Previous">
                <i class="bi bi-chevron-left"></i>
            </a>
        </li>
    `;

    // Page numbers
    const startPage = Math.max(1, currentPage - 2);
    const endPage = Math.min(pagination.total_pages, currentPage + 2);

    for (let i = startPage; i <= endPage; i++) {
        html += `
            <li class="page-item ${i === currentPage ? 'active' : ''}">
                <a class="page-link" href="#" onclick="kitchenHistoryUI.goToPage(${i})">${i}</a>
            </li>
        `;
    }

    // Next
    html += `
        <li class="page-item ${currentPage === pagination.total_pages ? 'disabled' : ''}">
            <a class="page-link" href="#" onclick="kitchenHistoryUI.goToPage(${currentPage + 1})" aria-label="Next">
                <i class="bi bi-chevron-right"></i>
            </a>
        </li>
    `;

    list.innerHTML = html;
}

function renderSummaryStats(orders) {
    const cooking = orders.filter(o => o.status === 'COOKING').length;
    const inProgress = orders.filter(o => o.status === 'IN-PROGRESS').length;
    const completed = orders.filter(o => o.status === 'COMPLETED').length;
    const cancelled = orders.filter(o => o.status === 'CANCELLED').length;

    document.getElementById('statCooking').textContent = cooking;
    document.getElementById('statInProgress').textContent = inProgress;
    document.getElementById('statCompleted').textContent = completed;
    document.getElementById('statCancelled').textContent = cancelled;
}

function renderOrderDetailsModal(order) {
    document.getElementById('detailOrderedAt').textContent = formatDateTime(order.ordered_at);
    document.getElementById('detailOrderType').textContent = getTypeLabel(order.order_type);
    document.getElementById('detailOrderType').className = 'badge fw-semibold ' + getTypeBadgeClass(order.order_type);
    document.getElementById('detailStatus').textContent = escapeHtml(order.status);
    document.getElementById('detailStatus').className = 'status-badge ' + getStatusBadgeClass(order.status);
    document.getElementById('detailCustomer').textContent = escapeHtml(order.customer_name || 'Walk-in Customer');
    document.getElementById('detailTable').textContent = order.table_number ? 'Table ' + order.table_number : '--';
    document.getElementById('detailTotal').textContent = formatCurrency(order.total_amount);

    // Payment method
    let paymentText = '--';
    let paymentBadge = 'badge bg-secondary';
    if (order.is_paid && order.is_paid == 1) {
        const method = order.payment_method || 'CASH';
        paymentText = method;
        paymentBadge = 'badge fw-semibold ' + (getPaymentBadgeClass(method).replace('badge ', ''));
    } else if (order.status === 'CANCELLED') {
        paymentText = 'VOID';
        paymentBadge = 'badge fw-semibold bg-danger';
    }
    document.getElementById('detailPayment').textContent = paymentText;
    document.getElementById('detailPayment').className = paymentBadge;

    // Reference number
    document.getElementById('detailReference').textContent = order.reference_number ? '#' + order.reference_number : '--';

    // Time to complete
    const timeToComplete = order.status === 'COMPLETED'
        ? formatDuration(order.ordered_at, order.completed_at)
        : '--';
    document.getElementById('detailTimeToComplete').textContent = timeToComplete;

    // Render items grouped by category
    const itemsByCategory = {};
    (order.items || []).forEach(item => {
        const cat = item.category_name || 'Uncategorized';
        if (!itemsByCategory[cat]) itemsByCategory[cat] = [];
        itemsByCategory[cat].push(item);
    });

    let itemsHtml = '';
    for (const [category, items] of Object.entries(itemsByCategory)) {
        itemsHtml += `<div class="item-category-label">${escapeHtml(category)}</div>`;
        items.forEach(item => {
            const specialHtml = item.special_instructions
                ? `<span class="special-instruction-badge"><i class="bi bi-exclamation-triangle"></i> ${escapeHtml(item.special_instructions)}</span>`
                : '';
            itemsHtml += `
                <div class="order-detail-item">
                    <div>
                        <div class="fw-semibold">${escapeHtml(item.item_name)}</div>
                        <div class="text-muted small">${specialHtml}</div>
                    </div>
                    <div class="text-end">
                        <div class="fw-bold">${formatCurrency(item.subtotal || item.price * item.quantity)}</div>
                        <div class="text-muted small">x${item.quantity} @ ${formatCurrency(item.price)}</div>
                    </div>
                </div>
            `;
        });
    }

    document.getElementById('detailItemsContainer').innerHTML = itemsHtml || '<p class="text-muted text-center py-3">No items found</p>';

    // Show modal
    const modal = new bootstrap.Modal(document.getElementById('orderDetailsModal'));
    modal.show();
}

// ========================================
// MAIN CONTROLLER
// ========================================
const kitchenHistoryUI = {
    async init() {
        console.log('[KitchenHistoryUI] Initializing...');
        this.setupEvents();
        await this.loadOrders();
        this.initPusher();
    },

    // ========================================
    // REALTIME: Pusher (WebSocket) — no refresh needed
    // ========================================
    initPusher() {
        if (typeof Pusher === 'undefined') {
            setTimeout(() => this.initPusher(), 500);
            return;
        }
        const pusher = new Pusher('a8860aca373dcc3400ce', { cluster: 'ap1' });
        const channel = pusher.subscribe('hof-orders');
        channel.bind('new-order', (data) => {
            console.log('[Pusher] New order:', data);
            this.loadOrders();
        });
        channel.bind('order-status-changed', (data) => {
            console.log('[Pusher] Status changed:', data);
            this.loadOrders();
        });
    },

    setupEvents() {
        // Filter inputs - debounced
        const debounce = (fn, delay) => {
            let timeoutId;
            return (...args) => {
                clearTimeout(timeoutId);
                timeoutId = setTimeout(() => fn(...args), delay);
            };
        };

        const applyFiltersDebounced = debounce(() => this.applyFilters(), 300);

        ['searchInput', 'statusFilter', 'typeFilter'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('input', applyFiltersDebounced);
                el.addEventListener('change', applyFiltersDebounced);
            }
        });
    },

    async loadOrders() {
        try {
            const result = await fetchHistory(currentPage, currentFilters, activeTab);
            this.renderData(result);
        } catch (err) {
            console.error('Failed to load orders:', err);
            this.showError(err.message);
        }
    },

    renderData(result) {
        renderOrdersTable(result.data);
        renderPagination(result.pagination);
        renderSummaryStats(result.data);
    },

    showError(message) {
        const tbody = document.getElementById('ordersTableBody');
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="11" class="text-center py-5 text-danger">
                        <i class="bi bi-exclamation-triangle-fill fs-1 d-block mb-2"></i>
                        ${escapeHtml(message)}
                    </td>
                </tr>
            `;
        }
        document.getElementById('paginationContainer').style.display = 'none';
    },

    applyFilters() {
        currentFilters = {
            search: document.getElementById('searchInput')?.value.trim() || '',
            status: document.getElementById('statusFilter')?.value || '',
            type: document.getElementById('typeFilter')?.value || ''
        };
        currentPage = 1;
        this.loadOrders();
    },

    clearFilters() {
        ['searchInput', 'statusFilter', 'typeFilter'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        currentFilters = { search: '', status: '', type: '' };
        currentPage = 1;
        this.loadOrders();
    },

    goToPage(page) {
        if (page < 1) return;
        currentPage = page;
        this.loadOrders();
    },

    switchTab(tab) {
        activeTab = tab;
        currentPage = 1;

        // Update tab button active states
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        const activeBtn = document.getElementById('tab-' + tab);
        if (activeBtn) activeBtn.classList.add('active');

        // Hide status filter when viewing cancelled_today (status is fixed)
        const statusFilterRow = document.getElementById('statusFilterRow');
        if (statusFilterRow) {
            statusFilterRow.style.display = tab === 'cancelled_today' ? 'none' : '';
        }

        // Clear any status filter when switching to a tab
        if (tab === 'cancelled_today') {
            currentFilters.status = '';
            const statusEl = document.getElementById('statusFilter');
            if (statusEl) statusEl.value = '';
        }

        this.loadOrders();
    }

    // REMOVED: exportCSV() and printReport() - Admin only features
};

// ========================================
// GLOBAL FUNCTIONS (for inline onclick)
// ========================================
async function viewOrderDetails(orderId) {
    try {
        const order = await fetchOrderDetails(orderId);
        renderOrderDetailsModal(order);
    } catch (err) {
        console.error('Failed to fetch order details:', err);
        Swal.fire({ icon: 'error', title: 'Error', text: err.message, confirmButtonColor: '#dc3545' });
    }
}

// ========================================
// INITIALIZATION
// ========================================
document.addEventListener('DOMContentLoaded', () => {
    kitchenHistoryUI.init();
});