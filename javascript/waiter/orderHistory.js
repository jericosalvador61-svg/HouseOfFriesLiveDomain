/**
 * ============================================================
 * javascript/waiter/orderHistory.js
 * ------------------------------------------------------------
 * Drives public/waiter/order_history.html against
 * backend/waiter/get_order_history.php.
 *
 * The page previously had NO script bound to it: it rendered
 * `onclick="applyFilters()"` and an empty <tbody>, so the table
 * stayed on "Loading..." forever. This file supplies the missing
 * behaviour: filters, rendering and pagination.
 *
 * Statuses use HYPHENS (IN-PROGRESS), matching the DB enums.
 * ============================================================
 */

const ORDER_HISTORY_API = '../../backend/waiter/get_order_history.php';
const ORDER_TODAY_API = '../../backend/waiter/get_orders_today.php';

const orderHistoryState = {
    page: 1,
    limit: 25,
    search: '',
    status: 'all',
    scope: 'mine'
};

function orderHistoryEscape(text) {
    if (text === null || text === undefined) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function orderHistoryApiFetch(endpoint) {
    const token = localStorage.getItem('hof_token') || '';
    return fetch(ORDER_HISTORY_API + endpoint, {
        headers: token ? { 'Authorization': 'Bearer ' + token } : {}
    });
}

function orderHistoryStatusLabel(status) {
    const map = {
        'PENDING': 'Pending',
        'IN-PROGRESS': 'Preparing',
        'COOKING': 'Cooking',
        'COMPLETED': 'Ready to Deliver',
        'SERVED': 'Served',
        'CANCELLED': 'Cancelled'
    };
    return map[String(status || '').toUpperCase()] || (status || '-');
}


/** Render the orders table body. */
function renderOrderHistory(orders) {
    const tbody = document.getElementById('orderHistoryTableBody');
    if (!tbody) return;

    if (!orders || orders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--hof-muted);padding:24px;">No orders found for the selected filters.</td></tr>';
        return;
    }

    tbody.innerHTML = orders.map(o => {
        const items = (o.items || [])
            .map(i => `${Number(i.quantity)}x ${orderHistoryEscape(i.item_name)}`)
            .join(', ') || '-';

        const notifyCell = (typeof notifyStatusEligible === 'function' && typeof renderNotifyCell === 'function' && notifyStatusEligible(o.status))
            ? `<span class="notify-host" id="notifyHost-${o.order_id}">${renderNotifyCell(o.order_id, o.reference_number || o.order_id)}</span>`
            : '';

        return `
            <tr>
                <td>
                    <strong>${orderHistoryEscape(o.reference_number || '#' + o.order_id)}</strong>
                    <div style="font-size:0.72rem;color:var(--hof-muted);" title="${items}">${items}</div>
                </td>
                <td>${orderHistoryEscape(String(o.order_type || '').replace('_', ' '))}</td>
                <td>${o.table_number ? orderHistoryEscape(o.table_number) : '-'}</td>
                <td>${orderHistoryFormatPeso(o.total_amount)}</td>
                <td>${orderHistoryFormatDate(o.ordered_at)}</td>
                <td>${orderHistoryFormatDate(o.completed_at)}</td>
                <td>${orderHistoryEscape(o.creator_name || '-')}</td>
                <td>
                    <span class="pill ${getStatusPillClass(o.status)}">${orderHistoryStatusLabel(o.status)}</span>
                    ${notifyCell}
                </td>
            </tr>
        `;
    }).join('');
}

/** Render pagination controls + page-size selector. */
function renderOrderHistoryPagination(pagination) {
    const nav = document.getElementById('orderHistoryPagination');
    if (!nav) return;

    const totalPages = (pagination && pagination.total_pages) || 0;

    // Page-size selector (10 / 25 / 50 / 100).
    let html = '<div class="d-flex gap-2 justify-content-between align-items-center flex-wrap">';
    html += '<div class="d-flex align-items-center gap-2"><label class="small text-muted mb-0">Show</label>';
    html += '<select class="form-select form-select-sm" style="width:auto;" id="orderHistoryPageSize">';
    [10, 25, 50, 100].forEach(size => {
        const sel = size === orderHistoryState.limit ? ' selected' : '';
        html += `<option value="${size}"${sel}>${size}</option>`;
    });
    html += '</select>';
    html += '<span class="small text-muted">per page</span></div>';

    if (totalPages > 1) {
        html += '<div class="d-flex gap-1 justify-content-center flex-wrap">';
        for (let p = 1; p <= totalPages; p++) {
            const active = p === orderHistoryState.page;
            html += `<button class="btn-hof btn-sm ${active ? 'primary' : ''}" data-page="${p}" style="${active ? '' : 'opacity:0.75;'}">${p}</button>`;
        }
        html += '</div>';
    }
    html += '</div>';
    nav.innerHTML = html;

    const sizeSelect = document.getElementById('orderHistoryPageSize');
    if (sizeSelect) {
        sizeSelect.addEventListener('change', () => {
            orderHistoryState.limit = parseInt(sizeSelect.value, 10) || 25;
            orderHistoryState.page = 1;
            loadOrderHistory();
        });
    }

    nav.querySelectorAll('button[data-page]').forEach(btn => {
        btn.addEventListener('click', () => {
            orderHistoryState.page = parseInt(btn.getAttribute('data-page'), 10) || 1;
            loadOrderHistory();
        });
    });
}

function orderHistoryFormatDate(value) {
    if (!value || String(value).startsWith('0000-00-00')) return '-';
    const d = new Date(String(value).replace(' ', 'T'));
    if (isNaN(d.getTime())) return orderHistoryEscape(value);
    return d.toLocaleString('en-PH', {
        year: 'numeric', month: 'short', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: true
    });
}

/** Fetch and render the current page of order history. */
async function loadOrderHistory() {
    const tbody = document.getElementById('orderHistoryTableBody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--hof-muted);padding:24px;">Loading...</td></tr>';
    }

    const params = new URLSearchParams({
        page: String(orderHistoryState.page),
        limit: String(orderHistoryState.limit),
        scope: orderHistoryState.scope
    });
    if (orderHistoryState.status && orderHistoryState.status !== 'all') {
        params.set('status', orderHistoryState.status);
    }
    if (orderHistoryState.search) {
        params.set('search', orderHistoryState.search);
    }

    try {
        const res = await orderHistoryApiFetch('?' + params.toString());
        const data = await res.json();

        if (!data.success) {
            renderOrderHistory([]);
            return;
        }

        renderOrderHistory(data.orders || []);
        renderOrderHistoryPagination(data.pagination);
    } catch (e) {
        console.error('Failed to load order history:', e);
        renderOrderHistory([]);
    }
}

/** Read the filter controls and reload from page 1. Bound to the Search button. */
function applyFilters() {
    const searchInput = document.getElementById('searchInput');
    const statusFilter = document.getElementById('statusFilter');
    const ownershipFilter = document.getElementById('ownershipFilter');

    orderHistoryState.search = searchInput ? searchInput.value.trim() : '';
    orderHistoryState.status = statusFilter ? statusFilter.value : 'all';
    orderHistoryState.scope = ownershipFilter ? ownershipFilter.value : 'mine';
    orderHistoryState.page = 1;

    loadOrderHistory();
}

/** Live search: re-query shortly after the user stops typing. */
function setupOrderHistoryEvents() {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        let timer;
        searchInput.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(applyFilters, 350);
        });
    }
}

/** Thin "Needs Assist" banner fed by get_orders_today.php unclaimed_orders.
 *  Reuses window.claimOrder (waiter.js) for the Assist action. */
let needsAssistInFlight = false;
async function loadNeedsAssistBanner() {
    const banner = document.getElementById('needsAssistBanner');
    if (!banner || needsAssistInFlight) return;
    needsAssistInFlight = true;
    try {
        const token = localStorage.getItem('hof_token') || '';
        const res = await fetch(ORDER_TODAY_API + '?scope=mine', {
            headers: token ? { 'Authorization': 'Bearer ' + token } : {}
        });
        const data = await res.json();
        if (!data.success) {
            banner.innerHTML = '';
            return;
        }
        const unclaimed = data.unclaimed_orders || [];
        if (unclaimed.length === 0) {
            banner.innerHTML = '';
            needsAssistInFlight = false;
            return;
        }

        banner.innerHTML = `
            <div class="card-hof" style="margin-bottom:18px;border:1px solid #ffc107;">
                <div class="flex-between" style="margin-bottom:8px;">
                    <div>
                        <h2 class="section-title"><span class="pill pending">Needs Assist</span></h2>
                        <p class="section-sub">Unclaimed customer orders awaiting a waiter. Assign one to get started.</p>
                    </div>
                </div>
                <div style="display:grid;gap:10px;">
                    ${unclaimed.map(o => `
                        <div class="flex-between" style="flex-wrap:wrap;gap:8px;padding:10px;border:1px solid #eee;border-radius:10px;">
                            <div>
                                <div class="fw-semibold">${orderHistoryEscape(o.reference_number || '#' + o.order_id)}</div>
                                <div class="small text-muted">
                                    ${orderHistoryEscape(String(o.order_type || '').replace('_', ' '))}
                                    · ${o.table_number ? 'Table ' + orderHistoryEscape(o.table_number) : 'Take Out'}
                                    · ${orderHistoryFormatPeso(o.total_amount)}
                                </div>
                            </div>
                            <button class="btn-hof btn-sm primary" onclick="claimOrder(${Number(o.order_id)}); return false;">
                                <i class="bi bi-hand-index-thumb"></i> Assist
                            </button>
                        </div>
                    `).join('')}
                </div>
            </div>`;
        needsAssistInFlight = false;
    } catch (e) {
        console.error('Failed to load Needs Assist banner:', e);
        banner.innerHTML = '';
        needsAssistInFlight = false;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Initialise on both the order-history page AND the unified Orders page
    // (B2-5: the table + filters live on orders.html now).
    if (!document.getElementById('orderHistoryTableBody')) return;
    applyRoleRestrictions();
    setupOrderHistoryEvents();
    loadOrderHistory();
    loadNeedsAssistBanner();
});

// Only Admin/Supervisor may view all staff orders (the server also hard-blocks
// with a 403). For anyone else, disable the "All Staff" option and keep the
// scope on 'mine'.
function applyRoleRestrictions() {
    const ownershipFilter = document.getElementById('ownershipFilter');
    if (!ownershipFilter) return;
    const token = localStorage.getItem('hof_token') || '';
    fetch('../../backend/check_session.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
    })
        .then(r => r.json())
        .then(data => {
            const role = String(data && data.role ? data.role : '').toLowerCase();
            if (role !== 'admin' && role !== 'supervisor') {
                const allOption = ownershipFilter.querySelector('option[value="all"]');
                if (allOption) allOption.disabled = true;
                if (orderHistoryState.scope === 'all') orderHistoryState.scope = 'mine';
            }
        })
        .catch(() => { /* keep default mine */ });
}

function orderHistoryFormatPeso(amount) {
    return '₱' + parseFloat(amount || 0).toLocaleString('en-PH', {
        minimumFractionDigits: 2, maximumFractionDigits: 2
    });
}
