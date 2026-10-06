/**
 * HOF Waiter Dashboard JavaScript
 * Handles session check, sidebar, tabs, tables, and orders
 */

const API_BASE = '../../backend/waiter';

/**
 * Single fetch wrapper for the whole module.
 * Always sends the JWT as a Bearer header (auth_middleware also accepts the
 * hof_token cookie, but the header is the explicit, primary path).
 */
function hofFetch(endpoint, options = {}) {
    const token = localStorage.getItem('hof_token') || '';
    const opts = { ...options };
    opts.headers = {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
        ...(options.headers || {})
    };
    return fetch(API_BASE + '/' + endpoint, opts);
}

// â”€â”€ Session Check â”€â”€
async function checkSession() {
    const token = localStorage.getItem('hof_token');
    if (!token) { window.location.href = '../../index.html'; return; }

    try {
        const res = await fetch('../../backend/check_session.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
        });
        const data = await res.json();
        if (!data.loggedIn) {
            localStorage.removeItem('hof_token');
            window.location.href = '../../index.html';
            return;
        }
        const userNameEl = document.querySelector('.user-name');
        const userRoleEl = document.querySelector('.user-role');
        const userAvatarEl = document.querySelector('.user-avatar');
        if (userNameEl) userNameEl.textContent = data.first_name + ' ' + data.last_name;
        if (userRoleEl) userRoleEl.textContent = data.role;
        if (userAvatarEl) userAvatarEl.textContent = (data.first_name?.[0] || 'W');

        // page_gate.php and every waiter endpoint also admit Admin, so the
        // client check must match the server's allow-list.
        const role = (data.role || '').toLowerCase();
        if (role !== 'waiter' && role !== 'admin') {
            Swal.fire({ icon: 'error', title: 'Access Denied', text: 'This page is for waiters only.' });
            setTimeout(() => { window.location.href = '../../index.html'; }, 2000);
        }
    } catch (e) {
        console.error('Session check failed:', e);
    }
}

// â”€â”€ Format Currency â”€â”€
function formatPeso(amount) {
    return '\u20B1' + parseFloat(amount).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// â”€â”€ Format Relative Time (accepts epoch seconds) â”€â”€
function timeAgo(epochSeconds) {
    if (!epochSeconds || epochSeconds <= 0) return 'N/A';
    const date = new Date(epochSeconds * 1000);
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);
    // Absolute HH:MM (Asia/Manila)
    const absTime = date.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila' });
    // Relative label
    let rel = '';
    if (diff < 0) rel = 'just now';
    else if (diff < 60) rel = 'just now';
    else if (diff < 3600) rel = Math.floor(diff / 60) + ' min ago';
    else if (diff < 86400) rel = Math.floor(diff / 3600) + ' hr ago';
    else rel = Math.floor(diff / 86400) + ' days ago';
    return absTime + ' (' + rel + ')';
}

function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// â”€â”€ Play Notification Sound â”€â”€
function playNotificationSound() {
    try {
        const audio = new Audio('../../sounds/notification.wav');
        audio.volume = 0.5;
        audio.play().catch(e => console.log('Sound notification failed:', e));
    } catch (e) {
        console.log('Sound not available');
    }
}

// â”€â”€ Initialize Pusher Notifications â”€â”€
// Backend broadcasts 'new-order' on channel 'hof-orders' with payload {order_id, message}.
// Kitchen sends message = status ("COMPLETED" = ready to deliver). place_order sends "New Order #...".
function initPusherNotifications() {
    if (typeof Pusher !== 'undefined') {
        // REQ-064: match the transport to the page (kitchenUI.js pattern) —
        // a hardcoded forceTLS breaks either local http or the live https site.
        const pusher = new Pusher('a8860aca373dcc3400ce', {
            cluster: 'ap1',
            forceTLS: (window.location.protocol === 'https:')
        });

        const channel = pusher.subscribe('hof-orders');
        
        channel.bind('new-order', function(data) {
            const msg = (data && data.message) ? String(data.message) : '';
            const orderId = data.order_id || '';
            console.log('Pusher new-order:', data);

            // Kitchen marked order COMPLETED â†’ READY TO DELIVER
            if (msg === 'COMPLETED') {
                playNotificationSound();
                showNotification('Ready to Deliver', `Order ${orderId} is ready for delivery`, 'success');
                loadOrders();
                loadDashboardStats();
                return;
            }

            // New order placed (customer or cashier)
            if (msg.indexOf('New Order') !== -1) {
                playNotificationSound();
                showNotification('New Order', `Order ${orderId} received`, 'info');
                loadOrders();
                loadDashboardStats();
                return;
            }

            // Any other status update (IN-PROGRESS, COOKING, CANCELLED, SERVED...)
            if (msg) {
                playNotificationSound();
                showNotification('Order Updated', `Order ${orderId} ${msg}`, 'info');
            }
            loadOrders();
            loadDashboardStats();
        });
    }
}

// â”€â”€ Pill Class Mapper â”€â”€
// Flow: PENDING -> IN-PROGRESS -> COOKING -> COMPLETED (kitchen) -> SERVED (waiter delivers)
function getStatusPillClass(status) {
    const map = {
        'PENDING': 'pending',
        'IN-PROGRESS': 'preparing',
        'COOKING': 'preparing',
        'COMPLETED': 'ready',      // ready to deliver
        'SERVED': 'served',        // delivered by waiter
        'CANCELLED': 'cancelled',
        'AVAILABLE': 'available',
        'OCCUPIED': 'occupied',
        'MAINTENANCE': 'maintenance'
    };
    return map[status?.toUpperCase()] || 'pending';
}

function getStatusLabel(status) {
    const map = {
        'PENDING': 'Pending',
        'IN-PROGRESS': 'Preparing',
        'COOKING': 'Cooking',
        'COMPLETED': 'Ready to Deliver',
        'SERVED': 'Served',
        'CANCELLED': 'Cancelled',
        'AVAILABLE': 'Available',
        'OCCUPIED': 'Occupied',
        'MAINTENANCE': 'Maintenance'
    };
    return map[status?.toUpperCase()] || status;
}

// â”€â”€ Load Dashboard Stats â”€â”€
async function loadDashboardStats() {
    try {
        const res = await hofFetch('get_dashboard_stats.php');
        const data = await res.json();
        if (!data.success) return;

        const availEl = document.getElementById('statAvailable');
        const occEl = document.getElementById('statOccupied');
        const activeEl = document.getElementById('statActiveOrders');
        const servedEl = document.getElementById('statServed');
        const totalEl = document.getElementById('statTotal');

        if (availEl) availEl.textContent = data.available_tables;
        if (occEl) occEl.textContent = data.occupied_tables;
        if (activeEl) activeEl.textContent = data.active_orders;
        if (servedEl) servedEl.textContent = data.served_today;
        // Previously never populated - the "Total Tables" tile stayed at "--".
        if (totalEl) {
            totalEl.textContent = (data.total_tables !== undefined)
                ? data.total_tables
                : (data.available_tables + data.occupied_tables + (data.maintenance_tables || 0));
        }
    } catch (e) { console.error('Failed to load dashboard stats:', e); }
}

// â”€â”€ Load Recent Tables (for dashboard) â”€â”€
async function loadRecentTables() {
    try {
        const res = await hofFetch('get_tables.php?table_type=DINE_IN');
        const data = await res.json();
        if (!data.success) return;

        const container = document.getElementById('recentTables');
        if (!container) return;

        if (!data.tables || data.tables.length === 0) {
            container.innerHTML = '<div class="empty-state" style="grid-column: 1/-1;"><i class="bi bi-inbox"></i><p>No tables found</p></div>';
            return;
        }

        const tablesToShow = data.tables.slice(0, 6);
        container.innerHTML = tablesToShow.map(t => {
            const pillClass = getStatusPillClass(t.status);
            const statusLabel = getStatusLabel(t.status);

            return `
                <div class="table-card" data-table-id="${t.table_id}">
                    <div class="flex-between">
                        <h3>Table ${escapeHtml(t.table_number)}</h3>
                        <span class="pill ${pillClass}">${statusLabel}</span>
                    </div>
                </div>
            `;
        }).join('');
    } catch (e) { console.error('Failed to load recent tables:', e); }
}

// â”€â”€ Load Active Orders (dashboard) - all in-flight orders â”€â”€
async function loadActiveOrders() {
    try {
        // 'active' maps server-side to PENDING,IN-PROGRESS,COOKING,COMPLETED,SERVED.
        const res = await hofFetch('get_orders.php?status=active');
        const data = await res.json();
        if (!data.success) return;

        const container = document.getElementById('activeOrdersList');
        if (!container) return;

        if (!data.orders || data.orders.length === 0) {
            container.innerHTML = '<div class="empty-state"><i class="bi bi-inbox"></i><p>No active orders right now</p></div>';
            return;
        }

        const ordersToShow = data.orders.slice(0, 4);
        container.innerHTML = ordersToShow.map(o => {
            // All DB-sourced strings are escaped - customer_name is user input.
            const itemNames = (o.items || []).map(i => `${Number(i.quantity)}x ${escapeHtml(i.item_name)}`).join(', ');
            const pillClass = getStatusPillClass(o.status);
            const pillLabel = getStatusLabel(o.status);
            const tableLabel = (o.order_type === 'TAKE_OUT')
                ? 'Take Out'
                : ('Table ' + escapeHtml(o.table_number || 'N/A'));
            const notify = notifyStatusEligible(o.status)
                ? `<span class="notify-host" id="notifyHost-${o.order_id}">${renderNotifyCell(o.order_id, o.reference_number || o.order_id)}</span>`
                : '';

            return `
                <div class="order-card">
                    <div class="order-header">
                        <div>
                            <div class="o-title">${escapeHtml(o.reference_number || '#' + o.order_id)}</div>
                            <div class="o-sub">${escapeHtml(o.order_type)} \u00B7 ${tableLabel} \u00B7 ${timeAgo(o.ordered_at_epoch)}</div>
                        </div>
                        <span class="pill ${pillClass}">${pillLabel}</span>
                    </div>
                    <div class="order-body">
                        <div><strong>Items:</strong> ${itemNames || '-'}</div>
                        <div><strong>Total:</strong> ${formatPeso(o.total_amount || 0)}</div>
                        ${o.customer_name ? `<div><strong>Customer:</strong> ${escapeHtml(o.customer_name)}</div>` : ''}
                    </div>
                    <div class="order-footer" style="margin-top:8px;">
                        ${o.status === 'COMPLETED' ? `
                        <button class="btn-hof btn-sm success" onclick="deliverOrder(${o.order_id})">
                            <i class="bi bi-bicycle"></i> Deliver
                        </button>` : ''}
                        ${notify}
                    </div>
                </div>
            `;
        }).join('');
    } catch (e) { console.error('Failed to load active orders:', e); }
}

// â”€â”€ Load Orders (page-aware dispatcher for Pusher callback) â”€â”€
// Refreshes whichever panels are present on the current page.
function loadOrders() {
    if (document.getElementById('ordersList')) loadTodaysOrders();
    if (document.getElementById('activeOrdersList')) loadActiveOrders();
    if (document.getElementById('recentTables')) loadRecentTables();
    if (document.getElementById('tablesGrid')) loadAllTables();
    if (document.getElementById('needsAssistBanner')) loadNeedsAssistBanner();
}

// â”€â”€ Load All Tables (Tables page) â”€â”€
async function loadAllTables(status = tablesState.status, page = tablesState.page) {
    tablesState.status = status || 'all';
    tablesState.page = page || 1;
    try {
        const params = new URLSearchParams({
            table_type: 'DINE_IN',
            status: tablesState.status,
            search: tablesState.search,
            page: String(tablesState.page),
            limit: String(tablesState.limit)
        });
        const res = await hofFetch(`get_tables.php?${params}`);
        const data = await res.json();
        if (!data.success) return;

        // Server-side stats (all matching rows, not just this page).
        if (data.stats) {
            const totalEl = document.getElementById('statTotal');
            const availableEl = document.getElementById('statAvailable');
            const occupiedEl = document.getElementById('statOccupied');
            if (totalEl) totalEl.textContent = data.stats.total;
            if (availableEl) availableEl.textContent = data.stats.available;
            if (occupiedEl) occupiedEl.textContent = data.stats.occupied;
        }

        const container = document.getElementById('tablesGrid');
        if (!container) return;

        if (!data.tables || data.tables.length === 0) {
            container.innerHTML = '<div class="empty-state" style="grid-column: 1/-1;"><i class="bi bi-inbox"></i><p>No tables found</p></div>';
            renderTablePagination(data.pagination);
            return;
        }

        container.innerHTML = data.tables.map(t => {
                    const id = t.table_id;
                    const number = escapeHtml(t.table_number || '--');
                    const pillClass = getStatusPillClass(t.status);
                    const statusLabel = getStatusLabel(t.status);

                    return `
                        <div class="table-card ${pillClass}" data-status="${escapeHtml(t.status)}">
                            <div class="table-card-head">
                                <h3>Table ${number}</h3>
                                <span class="status-pill ${pillClass}">${statusLabel}</span>
                            </div>
                            <div class="table-actions">
                                ${t.status === 'AVAILABLE' ? `
                                <button class="btn-hof primary btn-take" onclick="takeOrder(${id})">
                                    <i class="bi bi-cart-plus"></i> Take Order
                                </button>
                                ` : ''}
                                <button class="btn-hof secondary btn-qr" onclick="showQRCode(${id}, '${number}')">
                                    <i class="bi bi-qr-code"></i> View QR
                                </button>
                                ${t.status !== 'AVAILABLE' ? `
                                <button class="btn-hof danger btn-clear" onclick="clearTable(${id})">
                                    <i class="bi bi-trash"></i> Clear
                                </button>
                                ` : ''}
                            </div>
                        </div>
                    `;
        }).join('');

        renderTablePagination(data.pagination);

        // Re-apply the active filter after every re-render.
        const activeFilter = document.querySelector('.filter-btn.active');
        if (activeFilter) {
            filterTables(activeFilter.getAttribute('data-filter'));
        }
    } catch (e) { console.error('Failed to load tables:', e); }
}

// REQ-052 B2-7: server-side search + status + pagination state + helpers.
// Filter buttons still call filterTables() (client hide/show) but the toolbar
// wiring below sends page/search/status to get_tables.php. Returned shape
// (id/table_id/table_number/table_type/status/updated_at) is preserved.
let tablesState = { page: 1, limit: 9, search: '', status: 'all' };
let tablesSearchTimer = null;

/** Render prev/next + page buttons under the grid (REQ-052 B2-7). */
function renderTablePagination(pagination) {
    let nav = document.getElementById('tablePagination');
    if (!nav) {
        nav = document.createElement('nav');
        nav.id = 'tablePagination';
        nav.style.cssText = 'display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin-top:16px;';
        const grid = document.getElementById('tablesGrid');
        if (grid && grid.parentElement) grid.parentElement.appendChild(nav);
    }
    if (!pagination) { nav.innerHTML = ''; return; }
    const { page, total_pages } = pagination;
    if (total_pages <= 1) { nav.innerHTML = ''; return; }
    let html = '';
    if (page > 1) html += `<button class="btn-hof btn-sm" data-page="${page - 1}">&larr; Prev</button>`;
    for (let p = 1; p <= total_pages; p++) {
        const active = p === page ? ' primary' : '';
        html += `<button class="btn-hof btn-sm${active}" data-page="${p}">${p}</button>`;
    }
    if (page < total_pages) html += `<button class="btn-hof btn-sm" data-page="${page + 1}">Next &rarr;</button>`;
    nav.innerHTML = html;
    nav.querySelectorAll('button[data-page]').forEach(btn => {
        btn.addEventListener('click', () => loadAllTables(tablesState.status, parseInt(btn.getAttribute('data-page'), 10) || 1));
    });
}

/** Wire the topbar search box (debounced) + status select (REQ-052 B2-7). */
function setupTableToolbar() {
    const searchInput = document.getElementById('searchTableInput');
    if (searchInput) {
        searchInput.addEventListener('input', function () {
            clearTimeout(tablesSearchTimer);
            tablesSearchTimer = setTimeout(() => {
                tablesState.search = searchInput.value.trim();
                tablesState.page = 1;
                loadAllTables();
            }, 350);
        });
    }
    const statusSelect = document.getElementById('filterStatus');
    if (statusSelect) {
        statusSelect.addEventListener('change', function () {
            tablesState.status = statusSelect.value || 'all';
            tablesState.page = 1;
            loadAllTables();
        });
    }
}

// â”€â”€ Show QR Code Modal â”€â”€
function showQRCode(tableId, tableNumber) {
    // Build the customer URL from the current origin so it works on both the
    // live domain and localhost. Preserve any sub-folder deployment prefix.
    const appRoot = (() => {
        const m = window.location.pathname.match(/^(.*?)\/public\/waiter\//i);
        return m && m[1] ? m[1] : '';
    })();
    const qrData = `${window.location.origin}${appRoot}/customer/customer.html?table_id=${encodeURIComponent(tableId)}&type=DINE_IN`;

    // Update modal content
    const numEl = document.getElementById('qrTableNumber');
    const numTextEl = document.getElementById('qrTableNumberText');
    if (numEl) numEl.textContent = tableNumber;
    if (numTextEl) numTextEl.textContent = tableNumber;

    // Generate QR code
    const container = document.getElementById('qrCodeContainer');
    if (!container) return;
    container.innerHTML = '';

    if (typeof QRCode !== 'undefined') {
        new QRCode(container, {
            text: qrData,
            width: 128,
            height: 128,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.H
        });
    } else {
        container.innerHTML = '<p class="text-muted small">QR code library unavailable.<br>Menu link: ' + escapeHtml(qrData) + '</p>';
    }

    // Show modal
    const modalEl = document.getElementById('qrCodeModal');
    if (modalEl && typeof bootstrap !== 'undefined') {
        new bootstrap.Modal(modalEl).show();
    }
}

// â”€â”€ Download QR Code â”€â”€
function downloadQRCode() {
    const canvas = document.querySelector('#qrCodeContainer canvas');
    if (canvas) {
        const link = document.createElement('a');
        link.download = `table-qr-${document.getElementById('qrTableNumberText').textContent}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    }
}

// â”€â”€ Clear Table (Set to AVAILABLE) â”€â”€
async function clearTable(tableId) {
    const confirmed = await Swal.fire({
        title: 'Clear Table?',
        text: 'This will mark the table as Available. Any active order will need to be handled separately.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc3545',
        cancelButtonColor: '#6c757d',
        confirmButtonText: 'Yes, Clear Table'
    });
    
    if (!confirmed.isConfirmed) return;
    
    try {
        const res = await hofFetch('clear_table.php', {
            method: 'POST',
            body: JSON.stringify({ table_id: tableId, status: 'AVAILABLE' })
        });
        const data = await res.json();
        if (data.success) {
            Swal.fire({ icon: 'success', title: 'Cleared', timer: 1200, showConfirmButton: false });
            loadAllTables();
            loadDashboardStats();
        } else if (data.error === 'TABLE_HAS_ACTIVE_ORDER') {
            Swal.fire({ icon: 'warning', title: 'Cannot Clear Table', text: data.message || 'This table still has an active order. Complete or cancel it first.' });
        } else {
            Swal.fire({ icon: 'error', title: 'Error', text: data.message || 'Failed to clear table' });
        }
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Error', text: 'Network error' });
    }
}

// â”€â”€ Load Today's Orders (Orders page) â”€â”€
async function loadTodaysOrders() {
    try {
        const res = await hofFetch('get_orders_today.php?scope=mine');
        const data = await res.json();
        if (!data.success) return;

        const container = document.getElementById('ordersList');
        if (!container) return;

        const orders = data.orders || [];
        const unclaimed = data.unclaimed_orders || [];

        if (orders.length === 0 && unclaimed.length === 0) {
            container.innerHTML = '<div class="empty-state"><i class="bi bi-inbox"></i><p>No orders today</p></div>';
            return;
        }

        let html = '';

        // Needs Assist (unclaimed customer orders)
        if (unclaimed.length > 0) {
            html += `<div class="mb-4"><h5 class="section-title"><span class="pill pending">Needs Assist</span> ${unclaimed.length}</h5>`;
            html += renderOrderCards(unclaimed, true);
            html += '</div>';
        }

        // Group orders by status
        const pending = orders.filter(o => o.status === 'PENDING');
        const preparing = orders.filter(o => ['IN-PROGRESS', 'COOKING'].includes(o.status));
        const ready = orders.filter(o => o.status === 'COMPLETED');
        const served = orders.filter(o => o.status === 'SERVED');

        // Pending
        if (pending.length > 0) {
            html += `<div class="mb-4"><h5 class="section-title"><span class="pill pending">Pending</span> ${pending.length}</h5>`;
            html += renderOrderCards(pending);
            html += '</div>';
        }

        // Preparing
        if (preparing.length > 0) {
            html += `<div class="mb-4"><h5 class="section-title"><span class="pill preparing">Preparing</span> ${preparing.length}</h5>`;
            html += renderOrderCards(preparing);
            html += '</div>';
        }

        // Ready to Deliver
        if (ready.length > 0) {
            html += `<div class="mb-4"><h5 class="section-title"><span class="pill ready">Ready to Deliver</span> ${ready.length}</h5>`;
            html += renderOrderCards(ready);
            html += '</div>';
        }

        // Served
        if (served.length > 0) {
            html += `<div class="mb-4"><h5 class="section-title"><span class="pill served">Served</span> ${served.length}</h5>`;
            html += renderOrderCards(served);
            html += '</div>';
        }

        container.innerHTML = html;
    } catch (e) { console.error('Failed to load today\'s orders:', e); }
}

function renderOrderCards(orders, isUnclaimed) {
    return orders.map(o => {
        const itemNames = (o.items || []).map(i => `${i.quantity}x ${escapeHtml(i.item_name)}`).join(', ');
        const pillClass = getStatusPillClass(o.status);
        const pillLabel = getStatusLabel(o.status);
        const tableLabel = (o.order_type === 'TAKE_OUT')
            ? 'Take Out'
            : ('Table ' + escapeHtml(o.table_number || 'N/A'));

        let actionBtn = '';
        // Claim/Assist flow removed per owner — waiters act directly (Deliver on COMPLETED).
        if (o.status === 'COMPLETED') {
            actionBtn = `<button class="btn-hof btn-sm success" onclick="deliverOrder(${o.order_id})">
                <i class="bi bi-bicycle"></i> Deliver to Customer
            </button>`;
        } else if (o.status === 'SERVED') {
            actionBtn = `<span class="pill served"><i class="bi bi-check2-circle"></i> Delivered</span>`;
        }

        const notifyCell = (isUnclaimed || !notifyStatusEligible(o.status))
            ? ''
            : `<span class="notify-host" id="notifyHost-${o.order_id}">${renderNotifyCell(o.order_id, o.reference_number || o.order_id)}</span>`;

        return `
            <div class="order-card" data-order-id="${o.order_id}">
                <div class="order-header">
                    <div>
                        <div class="o-title">${escapeHtml(o.reference_number || '#' + o.order_id)}</div>
                        <div class="o-sub">${escapeHtml(o.order_type)} \u00B7 ${tableLabel} \u00B7 ${timeAgo(o.ordered_at_epoch)}</div>
                    </div>
                    <span class="pill ${pillClass}">${pillLabel}</span>
                </div>
                <div class="order-body">
                    <div><strong>Items:</strong> ${itemNames || '-'}</div>
                    <div><strong>Total:</strong> ${formatPeso(o.total_amount || 0)}</div>
                    ${o.customer_name ? `<div><strong>Customer:</strong> ${escapeHtml(o.customer_name)}</div>` : ''}
                    ${o.created_by_name ? `<div><strong>Assigned:</strong> ${escapeHtml(o.created_by_name)}</div>` : ''}
                </div>
                <div class="order-footer">
                    ${actionBtn}
                    ${notifyCell}
                </div>
            </div>
        `;
    }).join('');
}

// ── Waiter "Notify Customer" (REQ-055 #6 / REQ-062 #5) ──
// Shared timer store across waiter.js + orderHistory.js. Broadcasts a
// `customer-notify` Pusher alert to the order so the customer's tracker can
// beep. Auto-stops after 30s; the waiter can Stop early. Never touches payment.
window._notifyTimers = window._notifyTimers || {};

function notifyStatusEligible(status) {
    const s = String(status || '').toUpperCase();
    return s === 'IN-PROGRESS' || s === 'COOKING' || s === 'COMPLETED';
}

function isNotifyActive(orderId) {
    return !!(window._notifyTimers && window._notifyTimers[orderId]);
}

function notifyCountdownHtml(orderId) {
    const rec = window._notifyTimers[orderId];
    const secs = (rec && typeof rec.remaining === 'number') ? rec.remaining : 30;
    return `<span class="pill preparing" id="notifyCountdown-${Number(orderId)}">Notify&hellip; ${secs}s</span>`;
}

// Stop button uses no ref lookup — the active timer record stores it.
function notifyStopBtnHtml(orderId) {
    return `<button class="btn-hof btn-sm danger" onclick="stopCustomerNotify(${Number(orderId)}); return false;" title="Stop the customer alert">
        <i class="bi bi-stop-fill"></i> Stop
    </button>`;
}

function renderNotifyCell(orderId, ref) {
    if (isNotifyActive(orderId)) {
        return notifyCountdownHtml(orderId) + ' ' + notifyStopBtnHtml(orderId);
    }
    return `<button class="btn-hof btn-sm" onclick="startCustomerNotify(${Number(orderId)}, '${escapeHtml(String(ref))}'); return false;" title="Ping the customer's phone">
        <i class="bi bi-bell"></i> Notify Customer
    </button>`;
}

function refreshNotifyCell(orderId) {
    const host = document.getElementById('notifyHost-' + orderId);
    if (!host) return;
    const rec = window._notifyTimers[orderId];
    if (rec) {
        const cd = document.getElementById('notifyCountdown-' + orderId);
        if (cd) cd.innerHTML = 'Notify&hellip; ' + rec.remaining + 's';
    }
}

function stopNotifyRecord(orderId) {
    const rec = window._notifyTimers[orderId];
    if (rec && rec._timer) clearInterval(rec._timer);
    delete window._notifyTimers[orderId];
}

async function postNotify(orderId, ref, type) {
    const res = await fetch(`${API_BASE}/notify_customer.php`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + (localStorage.getItem('hof_token') || '')
        },
        body: JSON.stringify({ order_id: Number(orderId), ref: String(ref), type: type })
    });
    return res.json();
}

window.startCustomerNotify = async function (orderId, ref) {
    if (isNotifyActive(orderId)) return;
    const refValue = String(ref || orderId);

    // Optimistically render countdown + Stop.
    const rec = { remaining: 30, _ref: refValue };
    rec._timer = setInterval(() => {
        const r = window._notifyTimers[orderId];
        if (!r) return;
        r.remaining -= 1;
        refreshNotifyCell(orderId);
        if (r.remaining <= 0) {
            clearInterval(r._timer);
            stopNotifyRecord(orderId);
            postNotify(orderId, refValue, 'stop').catch(() => {});
            const host = document.getElementById('notifyHost-' + orderId);
            if (host) host.innerHTML = renderNotifyCell(orderId, refValue);
        }
    }, 1000);
    window._notifyTimers[orderId] = rec;
    refreshNotifyCell(orderId);

    try {
        const data = await postNotify(orderId, refValue, 'notify');
        if (!data.success) {
            stopNotifyRecord(orderId);
            refreshNotifyCell(orderId);
            Swal.fire({ icon: 'error', title: 'Notify failed', text: data.message || 'Could not notify customer.' });
        }
    } catch (e) {
        stopNotifyRecord(orderId);
        refreshNotifyCell(orderId);
        Swal.fire({ icon: 'error', title: 'Network error', text: 'Please try again.' });
    }
};

window.stopCustomerNotify = async function (orderId) {
    const rec = window._notifyTimers[orderId];
    const refValue = rec ? rec._ref : '';
    if (rec && rec._timer) clearInterval(rec._timer);
    delete window._notifyTimers[orderId];
    try {
        if (refValue) await postNotify(orderId, refValue, 'stop');
    } catch (e) { /* stop is best-effort */ }
    const host = document.getElementById('notifyHost-' + orderId);
    if (host) host.innerHTML = renderNotifyCell(orderId, refValue || orderId);
};

// ── Update Order Status ──
async function updateOrderStatus(orderId, status) {
    Swal.fire({ title: 'Updating...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
        const res = await hofFetch('update_order_status.php', {
            method: 'POST',
            body: JSON.stringify({ order_id: orderId, status })
        });
        const data = await res.json();
        if (data.success) {
            Swal.fire({ icon: 'success', title: 'Updated', timer: 1200, showConfirmButton: false });
            loadTodaysOrders();
            loadDashboardStats();
        } else {
            Swal.fire({ icon: 'error', title: 'Error', text: data.message || 'Failed to update order' });
        }
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Error', text: 'Network error' });
    }
}

// â”€â”€ â­ CLAIM ORDER (Assist â€” first-come-first-served) â”€â”€
async function claimOrder(orderId) {
    Swal.fire({ title: 'Claiming...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
        const res = await fetch(`${API_BASE}/claim_order.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order_id: orderId })
        });
        const data = await res.json();
        if (data.success && data.claimed) {
            Swal.fire({ icon: 'success', title: 'Order Assigned!', text: data.message, timer: 1500, showConfirmButton: false });
            loadTodaysOrders();
            loadDashboardStats();
        } else {
            Swal.fire({ icon: 'info', title: data.claimed === false ? 'Already Taken' : 'Error', text: data.message || 'Could not claim order.' });
            loadTodaysOrders();
        }
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Error', text: 'Network error' });
    }
}

// â”€â”€ â­ DELIVER FLOW: Mark COMPLETED order as SERVED (delivered to customer) â”€â”€
async function deliverOrder(orderId) {
    const confirmed = await Swal.fire({
        title: 'Deliver Order?',
        text: 'Confirm you have delivered this order to the customer. Table will be freed.',
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#28a745',
        cancelButtonColor: '#d33',
        confirmButtonText: 'Yes, Delivered!'
    });

    if (!confirmed.isConfirmed) return;

    Swal.fire({ title: 'Delivering...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
        const res = await hofFetch('update_order_status.php', {
            method: 'POST',
            body: JSON.stringify({ order_id: orderId, status: 'SERVED' })
        });
        const data = await res.json();
        if (data.success) {
            playNotificationSound();
            Swal.fire({ icon: 'success', title: 'Order Delivered', text: 'Table is now available.', timer: 1500, showConfirmButton: false });
            loadTodaysOrders();
            loadDashboardStats();
        } else {
            Swal.fire({ icon: 'error', title: 'Error', text: data.message || 'Failed to deliver order' });
        }
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Error', text: 'Network error' });
    }
}

// â”€â”€ Show Notification Helper â”€â”€
function showNotification(title, message, type = 'info') {
    const toast = Swal.mixin({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 3000,
        timerProgressBar: true,
        didOpen: (toast) => {
            toast.addEventListener('mouseenter', Swal.stopTimer)
            toast.addEventListener('mouseleave', Swal.resumeTimer)
        }
    });

    toast.fire({
        icon: type,
        title: `${title}: ${message}`
    });
}

// ── Logout ──
/**
 * SECURITY: the hof_token COOKIE must also be cleared.
 * backend/page_gate.php and auth_middleware.php both accept the cookie, so
 * clearing localStorage alone left a fully valid server-side session behind
 * (the previous version of this function had that bug).
 * logout.js exposes the branded flow as window.hofLogout - prefer it.
 */
function logout() {
    if (typeof window.hofLogout === 'function') {
        window.hofLogout();
        return;
    }
    localStorage.removeItem('hof_token');
    document.cookie = 'hof_token=; path=/; Max-Age=0; SameSite=Strict';
    const m = window.location.pathname.match(/^(.*?)(?:\/public|\/customer|\/backend)(?:\/|$)/i);
    window.location.href = (m && m[1] ? m[1] : '') + '/index.html';
}

// ── Notification bell (role-filtered, DB-backed) ──
// Builds a small self-contained Bootstrap dropdown around the `.bell` button
// and fills it from get_notifications.php (role-filtered). Clicking an item
// marks it read via backend/notifications/mark_read.php.
async function loadNotificationBadge() {
    const bell = document.querySelector('.bell');
    if (!bell) return;
    try {
        const res = await hofFetch('get_notifications.php');
        const data = await res.json();
        if (!data.success) return;

        const unread = parseInt(data.unread_count, 10) || 0;
        let badge = bell.querySelector('.badge-dot');
        if (unread > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'badge-dot';
                badge.style.cssText = 'position:absolute;top:4px;right:4px;background:#dc3545;color:#fff;border-radius:50%;font-size:0.6rem;padding:1px 5px;z-index:5;';
                bell.style.position = 'relative';
                bell.appendChild(badge);
            }
            badge.textContent = unread > 99 ? '99+' : String(unread);
        } else if (badge) {
            badge.remove();
        }

        renderWaiterNotificationDropdown(bell, data);
    } catch (e) { /* badge is non-critical */ }
}

// Populate / lazily build the bell dropdown. `data` = {items, ...} from
// get_notifications.php; each item has {id, type, title, message, url,
// created_at, read}.
function renderWaiterNotificationDropdown(bell, data) {
    // Lazily create the Bootstrap dropdown wrapper + menu only if not present.
    let wrapper = bell.closest('.dropdown');
    let menu = wrapper ? wrapper.querySelector('.dropdown-menu') : null;
    if (!wrapper || !menu) {
        if (!wrapper) {
            wrapper = document.createElement('div');
            wrapper.className = 'dropdown d-inline-block';
            if (bell.parentNode) bell.parentNode.insertBefore(wrapper, bell);
            wrapper.appendChild(bell);
        }
        bell.classList.add('dropdown-toggle');
        bell.setAttribute('data-bs-toggle', 'dropdown');
        bell.setAttribute('aria-expanded', 'false');
        menu = document.createElement('ul');
        menu.className = 'dropdown-menu dropdown-menu-end shadow border mt-2';
        menu.id = 'waiterNotifMenu';
        menu.style.cssText = 'width:340px;max-height:420px;overflow-y:auto;';
        wrapper.appendChild(menu);
    }

    const items = Array.isArray(data.items) ? data.items : [];
    let html = '<li class="dropdown-header border-bottom fw-bold text-dark">Notifications</li>';
    if (items.length === 0) {
        html += '<li><span class="dropdown-item text-muted text-center py-3">All clear!</span></li>';
    } else {
        html += items.map(item => {
            const isNew = !item.read ? '<span class="badge bg-warning rounded-pill ms-2">New</span>' : '';
            const href = (item.url && item.url !== '#') ? item.url : '#';
            return `
                <li>
                    <a class="dropdown-item d-flex justify-content-between align-items-center py-2 ${item.read ? '' : 'fw-bold'}"
                       href="${escapeHtml(href)}" data-notification-id="${encodeURIComponent(item.id)}">
                        <span class="small text-truncate">${escapeHtml(item.message || item.title || 'Notification')}</span>
                        ${isNew}
                    </a>
                </li>`;
        }).join('');
    }
    menu.innerHTML = html;

    // Mark a notification as read when clicked.
    menu.querySelectorAll('[data-notification-id]').forEach(el => {
        el.addEventListener('click', () => markWaiterNotificationRead(el.getAttribute('data-notification-id')));
    });
}

// POST /backend/notifications/mark_read.php {id} then refresh badge+list.
async function markWaiterNotificationRead(id) {
    if (!id) return;
    try {
        const token = localStorage.getItem('hof_token') || '';
        const res = await fetch('../../backend/notifications/mark_read.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': 'Bearer ' + token } : {})
            },
            body: JSON.stringify({ id })
        });
        if ((await res.json()).success) loadNotificationBadge();
    } catch (e) { /* non-critical */ }
}

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
    checkSession();
    initPusherNotifications();

    // Load whichever panels this page actually has.
    if (document.getElementById('statActiveOrders')) loadDashboardStats();
    if (document.getElementById('recentTables')) loadRecentTables();
    if (document.getElementById('activeOrdersList')) loadActiveOrders();
    if (document.getElementById('ordersList')) loadTodaysOrders();
    if (document.getElementById('tablesGrid')) {
        loadAllTables();
        setupTableFilters();
        setupTableToolbar();
    }
    loadNotificationBadge();

    // Keep the dashboard fresh without a manual refresh. Refresh orders too:
    // Pusher can silently drop events, and this is the network-failure fallback.
    setInterval(() => {
        if (window.__hofRefreshing) return; // skip if the previous tick is still running
        window.__hofRefreshing = true;
        try {
            loadOrders();
            if (document.getElementById('statActiveOrders')) loadDashboardStats();
            loadNotificationBadge();
        } finally {
            window.__hofRefreshing = false;
        }
    }, 60000);
});

/**
 * Wire the All / Available / Occupied filter buttons on the Tables page.
 */
function setupTableFilters() {
    const filterButtons = document.querySelectorAll('.filter-btn');
    filterButtons.forEach(btn => {
        btn.addEventListener('click', function () {
            filterButtons.forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            filterTables(this.getAttribute('data-filter'));
        });
    });
}

/**
 * Fetch the tables grid (delegates to the single renderer loadAllTables).
 * Kept as a named entry point for backwards compatibility.
 */
function fetchTableData() {
    return loadAllTables();
}

/**
 * Update the Quick Stats counters from the rendered table list.
 */
function updateTableStats(tables) {
    const list = Array.isArray(tables) ? tables : [];
    const total = list.length;
    const available = list.filter(t => String(t.status).toUpperCase() === 'AVAILABLE').length;
    const occupied = list.filter(t => String(t.status).toUpperCase() === 'OCCUPIED').length;

    const totalEl = document.getElementById('statTotal');
    const availableEl = document.getElementById('statAvailable');
    const occupiedEl = document.getElementById('statOccupied');

    if (totalEl) totalEl.textContent = total;
    if (availableEl) availableEl.textContent = available;
    if (occupiedEl) occupiedEl.textContent = occupied;
}

/**
 * Filters the displayed table cards by status (client-side, no refetch).
 */
function filterTables(statusFilter) {
    const tableItems = document.querySelectorAll('#tablesGrid .table-card[data-status]');

    tableItems.forEach(item => {
        const itemStatus = item.getAttribute('data-status');
        if (!statusFilter || statusFilter === 'ALL' || statusFilter === 'all' || itemStatus === statusFilter) {
            item.style.display = '';
        } else {
            item.style.display = 'none';
        }
    });
}

window.takeOrder = function (tableId) {
    window.location.href = 'new_order.html?table_id=' + encodeURIComponent(tableId);
};
