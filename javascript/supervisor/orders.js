/**
 * House of Fries — Supervisor Orders JS
 * Real-time order monitoring via Pusher 'hof-orders' channel
 */

const API_BASE = '../../backend';

// ── Utility ──
function formatPeso(amount) {
    return '₱' + parseFloat(amount).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

function timeAgo(epochSeconds) {
    if (!epochSeconds || epochSeconds <= 0) return 'N/A';
    const date = new Date(epochSeconds * 1000);
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);
    const absTime = date.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila' });
    let rel = '';
    if (diff < 60) rel = 'just now';
    else if (diff < 3600) rel = Math.floor(diff / 60) + ' min ago';
    else if (diff < 86400) rel = Math.floor(diff / 3600) + ' hr ago';
    else rel = Math.floor(diff / 86400) + ' days ago';
    return absTime + ' (' + rel + ')';
}

function getStatusLabel(status) {
    const map = {
        'PENDING': 'Pending',
        'IN-PROGRESS': 'In Progress',
        'COOKING': 'Cooking',
        'COMPLETED': 'Completed',
        'SERVED': 'Served',
        'CANCELLED': 'Cancelled'
    };
    return map[status] || status;
}

function getStatusBadgeClass(status) {
    const map = {
        'PENDING': 'bg-warning text-dark',
        'IN-PROGRESS': 'bg-info text-dark',
        'COOKING': 'bg-primary',
        'COMPLETED': 'bg-success',
        'SERVED': 'bg-secondary',
        'CANCELLED': 'bg-danger'
    };
    return map[status] || 'bg-secondary';
}

// ── Play notification sound ──
function playNotificationSound() {
    try {
        const audio = new Audio('../../sounds/notification.wav');
        audio.volume = 0.5;
        audio.play().catch(e => console.log('Sound notification failed:', e));
    } catch (e) {
        console.log('Sound not available');
    }
}

// ── Show toast notification ──
function showNotification(title, message, type = 'info') {
    const toast = Swal.mixin({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 4000,
        timerProgressBar: true,
        didOpen: (toast) => {
            toast.addEventListener('mouseenter', Swal.stopTimer);
            toast.addEventListener('mouseleave', Swal.resumeTimer);
        }
    });
    toast.fire({ icon: type, title: title + ': ' + message });
}

// ── Initialize Pusher ──
function initPusher() {
    if (typeof Pusher === 'undefined') {
        setTimeout(initPusher, 500);
        return;
    }
    const pusher = new Pusher('a8860aca373dcc3400ce', {
        cluster: 'ap1',
        // REQ-064: protocol-matched transport (kitchenUI.js pattern) — hardcoded
        // forceTLS breaks either local http or the live https site.
        forceTLS: (window.location.protocol === 'https:')
    });
    const channel = pusher.subscribe('hof-orders');

    channel.bind('new-order', function(data) {
        const msg = (data && data.message) ? String(data.message) : '';
        const orderId = data.order_id || '';
        console.log('[Pusher] new-order:', data);

        playNotificationSound();

        if (msg.indexOf('New Order') !== -1) {
            showNotification('New Order', 'Order ' + orderId + ' received', 'info');
        } else if (msg === 'COMPLETED') {
            showNotification('Order Completed', 'Order ' + orderId + ' is ready', 'success');
        } else if (msg) {
            showNotification('Order Updated', 'Order ' + orderId + ' ' + msg, 'info');
        }

        loadOrders();
    });
}

// ── Load orders ──
async function loadOrders() {
    const tbody = document.getElementById('ordersTableBody');
    if (!tbody) return;

    try {
        const token = localStorage.getItem('hof_token') || '';
        const res = await fetch(API_BASE + '/waiter/get_orders_today.php?scope=all', {
            headers: token ? { 'Authorization': 'Bearer ' + token } : {}
        });
        const data = await res.json();

        if (!data.success) {
            tbody.innerHTML = '<tr><td colspan="9" class="text-center py-4 text-muted">Failed to load orders</td></tr>';
            return;
        }

        const orders = data.orders || [];

        // Update stats
        const active = orders.filter(o => ['PENDING', 'IN-PROGRESS', 'COOKING'].includes(o.status));
        const completed = orders.filter(o => o.status === 'COMPLETED');
        const inProgress = orders.filter(o => ['IN-PROGRESS', 'COOKING'].includes(o.status));
        const newToday = orders.filter(o => o.status === 'PENDING');

        document.getElementById('statActiveOrders').textContent = active.length;
        document.getElementById('statNewToday').textContent = newToday.length;
        document.getElementById('statInProgress').textContent = inProgress.length;
        document.getElementById('statCompletedToday').textContent = completed.length;

        if (orders.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="text-center py-4 text-muted">No orders today</td></tr>';
            return;
        }

        tbody.innerHTML = orders.map(o => {
            const statusLabel = getStatusLabel(o.status);
            const badgeClass = getStatusBadgeClass(o.status);
            const tableDisplay = o.table_number ? 'Table ' + escapeHtml(o.table_number) : 'Takeout / Walk-in';
            const paymentMethod = o.payment_method || '—';
            const orderType = o.order_type || '—';

            return `
                <tr>
                    <td><strong>${escapeHtml(o.order_id)}</strong></td>
                    <td>${escapeHtml(o.reference_number || '#' + o.order_id)}</td>
                    <td>${timeAgo(o.ordered_at_epoch)}</td>
                    <td>${escapeHtml(orderType)}</td>
                    <td><span class="badge ${badgeClass}">${statusLabel}</span></td>
                    <td>${escapeHtml(paymentMethod)}</td>
                    <td>${tableDisplay}</td>
                    <td class="text-end fw-bold">${formatPeso(o.total_amount || 0)}</td>
                    <td class="text-center">
                        <button class="btn btn-sm btn-outline-primary" onclick="viewOrderDetails(${o.order_id})">
                            <i class="bi bi-eye"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (e) {
        console.error('Failed to load orders:', e);
        tbody.innerHTML = '<tr><td colspan="9" class="text-center py-4 text-muted">Error loading orders</td></tr>';
    }
}

// ── View order details ──
async function viewOrderDetails(orderId) {
    Swal.fire({ title: 'Loading...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
        const token = localStorage.getItem('hof_token') || '';
        const res = await fetch(API_BASE + '/waiter/get_order_details.php?order_id=' + orderId, {
            headers: token ? { 'Authorization': 'Bearer ' + token } : {}
        });
        const data = await res.json();

        if (!data.success) {
            Swal.fire({ icon: 'error', title: 'Error', text: data.message || 'Failed to load order details' });
            return;
        }

        const o = data.order || data;
        const items = o.items || [];
        let itemsHtml = items.length > 0
            ? items.map(i => `<tr><td>${escapeHtml(i.item_name)}</td><td>${Number(i.quantity)}</td><td class="text-end">${formatPeso(i.price || 0)}</td></tr>`).join('')
            : '<tr><td colspan="3" class="text-muted text-center">No items</td></tr>';

        Swal.fire({
            title: 'Order #' + escapeHtml(o.reference_number || orderId),
            html: `
                <div class="text-start mb-2"><strong>Status:</strong> ${getStatusLabel(o.status)}</div>
                <div class="text-start mb-2"><strong>Type:</strong> ${escapeHtml(o.order_type || '—')}</div>
                <div class="text-start mb-2"><strong>Table:</strong> ${escapeHtml(o.table_number || 'N/A')}</div>
                <div class="text-start mb-2"><strong>Payment:</strong> ${escapeHtml(o.payment_method || '—')}</div>
                <div class="text-start mb-2"><strong>Total:</strong> ${formatPeso(o.total_amount || 0)}</div>
                <hr>
                <table class="table table-sm mb-0">
                    <thead><tr><th>Item</th><th>Qty</th><th class="text-end">Price</th></tr></thead>
                    <tbody>${itemsHtml}</tbody>
                </table>
            `,
            width: '500px',
            confirmButtonText: 'Close'
        });
    } catch (e) {
        console.error(e);
        Swal.fire({ icon: 'error', title: 'Error', text: 'Network error' });
    }
}

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
    loadOrders();
    initPusher();

    // Auto-refresh every 60s as fallback
    setInterval(loadOrders, 60000);

    // Search filter
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            const q = this.value.toLowerCase();
            document.querySelectorAll('#ordersTableBody tr').forEach(row => {
                const text = row.textContent.toLowerCase();
                row.style.display = text.includes(q) ? '' : 'none';
            });
        });
    }
});