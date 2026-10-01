(function () {
    let pusherChannel = null;
    let filter = sessionStorage.getItem('hof_history_filter') || 'active';

    document.addEventListener('DOMContentLoaded', () => {
        updateBadges();
        loadHistory();
        initPusher();
        // REQ-052 B3: refresh the right order source when the account state
        // changes in the shared auth modal (chip).
        window.HOFCustomerOnLogin = function () { loadHistory(); };
        window.HOFCustomerOnLogout = function () { loadHistory(); };
        document.getElementById('cartTrigger')?.addEventListener('click', () => {
            const cart = JSON.parse(localStorage.getItem('cart') || '[]');
            if (cart.length > 0) { window.location.href = 'cart.html'; }
            else { Swal.fire({ icon: 'info', title: 'Cart Empty', text: 'Your cart is empty.', confirmButtonColor: '#FFB800' }); }
        });
    });

    function escapeHtml(text) {
        if (!text) return '';
        var d = document.createElement('div');
        d.textContent = text;
        return d.innerHTML;
    }

    function statusColor(status) {
        var map = { 'PENDING': '#FFB800', 'IN-PROGRESS': '#007AFF', 'PREPARING': '#007AFF', 'COOKING': '#FF9500', 'COMPLETED': '#34C759', 'READY': '#34C759', 'SERVED': '#8E8E93', 'CANCELLED': '#FF3B30' };
        return map[status] || '#8E8E93';
    }

    function isEditable(status, paid) {
        return status === 'PENDING' && !paid;
    }

    window.loadHistory = function () {
        if (window.HOFCustomer && window.HOFCustomer.isLoggedIn()) {
            renderFilters();
            loadServerOrders();
        } else {
            var orders = window.HOFDevice ? HOFDevice.orders() : [];
            renderFilters();
            renderOrders(orders);
        }
    };

    // REQ-052 B3: logged-in customers fetch their server-side order history
    // (get_my_orders.php — scoped by the validated token only). On failure we
    // fall back to the device registry so the page never bricks.
    function loadServerOrders() {
        var container = document.getElementById('ordersContainer');
        if (container) {
            container.innerHTML = '<div class="empty-state" style="padding:40px;"><p>Loading your orders…</p></div>';
        }

        var fetchOpts = {
            headers: { 'Authorization': 'Bearer ' + (window.HOFCustomer.getToken() || '') }
        };
        fetch('get_my_orders.php', fetchOpts)
            .then(function (r) {
                if (r.status === 401) throw { status: 401 };
                return r.json();
            })
            .then(function (data) {
                if (data && data.success) {
                    renderOrders(data.orders || []);
                } else {
                    throw new Error((data && data.message) || 'Could not load orders');
                }
            })
            .catch(function (err) {
                // 401 → token stale/expired; silently drop back to device flow.
                if (err && err.status === 401 && window.HOFCustomer) {
                    window.HOFCustomer.clear();
                    window.HOFCustomer.renderChip();
                }
                // Server unavailable → fall back to device registry (guest view)
                // so the page never bricks; logged-in server history is best-effort.
                var orders = window.HOFDevice ? HOFDevice.orders() : [];
                renderOrders(orders);
            });
    }

    function renderFilters() {
        var row = document.getElementById('filterRow');
        if (!row) return;
        row.innerHTML = '';
        ['active', 'all', 'cancelled'].forEach(function (f) {
            var btn = document.createElement('button');
            btn.className = 'chip ' + (filter === f ? 'chip-active' : 'chip-inactive');
            btn.textContent = f.charAt(0).toUpperCase() + f.slice(1);
            btn.onclick = function () { filter = f; sessionStorage.setItem('hof_history_filter', filter); sessionStorage.setItem('hof_history_page', '1'); loadHistory(); };
            row.appendChild(btn);
        });
    }

    function renderOrders(orders) {
        var container = document.getElementById('ordersContainer');
        if (!container) return;

        if (orders.length === 0) {
            container.innerHTML = '<div class="empty-state"><i class="fa-solid fa-receipt"></i><p>No orders yet</p><button onclick="window.location.href=\'customer.html\'">Start Ordering</button></div>';
            return;
        }

        var filtered = filter === 'all' ? orders : (filter === 'cancelled' ? orders.filter(function (o) { return o.status === 'CANCELLED'; }) : orders.filter(function (o) { return o.status !== 'CANCELLED'; }));

                if (filtered.length === 0) {
                    container.innerHTML = '<div class="empty-state"><p>No ' + filter + ' orders</p><button onclick="window.location.href=\'customer.html\'">Start Ordering</button></div>';
                    return;
                }

                // Pagination: 10 items per page, newest first
                var page = parseInt(sessionStorage.getItem('hof_history_page') || '1');
                var perPage = 10;
                var totalPages = Math.ceil(filtered.length / perPage);
                if (page < 1) page = 1;
                if (page > totalPages) page = totalPages;
                var start = (page - 1) * perPage;
                var pageItems = filtered.slice(start, start + perPage);

                var hasPendingUnpaid = filtered.some(function (o) { return o.status === 'PENDING' && !o.paid; });

                var html = '';
                pageItems.forEach(function (o) {
                    var color = statusColor(o.status);
                    var paidBadge = o.paid ? '<span style="background:#34C759;color:white;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;margin-left:6px;">Paid</span>' : '<span style="background:#FFB800;color:#1e1e1e;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;margin-left:6px;">Unpaid</span>';

                    var actions = '<button class="btn-track" onclick="window.location.href=\'orderTracker.html?order_id=' + o.order_id + '\'"><i class="fa-solid fa-location-dot"></i> Track</button>';
                    // Edit/Pay need the order in THIS device's registry (they act
                    // on HOFDevice). Server-only orders (placed on another device)
                    // get Track + Order Again only.
                    var inDevice = window.HOFDevice && HOFDevice.orders().some(function (x) { return String(x.order_id) === String(o.order_id); });
                    if (isEditable(o.status, o.paid) && inDevice) {
                        actions += '<button class="btn-edit" onclick="window.editFromMyOrders(' + o.order_id + ')"><i class="fa-solid fa-pen"></i> Edit</button>';
                        actions += '<button class="btn-again" onclick="window.resumeGcashPayment(' + o.order_id + ',\'' + escapeHtml(o.ref || o.order_id) + '\')" style="background:#0056E3;color:white;"><i class="fa-solid fa-qrcode"></i> Pay</button>';
                    } else if (!hasPendingUnpaid) {
                        // Order Again is now in the top bar only — no per-card button
                    }

                    var tableLabel = o.table_number ? 'Table ' + o.table_number : 'Takeout';
                    var dateStr = (o.created_at || o.ordered_at) ? new Date(o.created_at || o.ordered_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) : '';

                    html += '<div class="order-card" data-order-id="' + o.order_id + '">'
                        + '<div class="order-header">'
                        + '<span class="order-ref">#' + escapeHtml(o.ref || o.order_id) + '</span>'
                        + '<span><span class="status-chip" style="background:' + color + '20;color:' + color + ';border:1px solid ' + color + '40;">' + escapeHtml(o.status) + '</span>' + paidBadge + '</span>'
                        + '</div>'
                        + '<div class="order-meta">' + escapeHtml(tableLabel) + ' \u00B7 ' + escapeHtml(dateStr) + '</div>'
                        + '<div class="action-row">' + actions + '</div>'
                        + '</div>';
                });
                container.innerHTML = html;

                // Pagination controls
                if (totalPages > 1) {
                    var pagHtml = '<div style="display:flex;justify-content:center;gap:8px;margin-top:16px;padding:12px 0;">';
                    if (page > 1) {
                        pagHtml += '<button onclick="window.goHistoryPage(' + (page - 1) + ')" style="background:#FFB800;border:none;padding:8px 16px;border-radius:10px;font-weight:700;cursor:pointer;">Prev</button>';
                    }
                    pagHtml += '<span style="padding:8px 12px;font-weight:600;color:#666;">Page ' + page + ' of ' + totalPages + '</span>';
                    if (page < totalPages) {
                        pagHtml += '<button onclick="window.goHistoryPage(' + (page + 1) + ')" style="background:#FFB800;border:none;padding:8px 16px;border-radius:10px;font-weight:700;cursor:pointer;">Next</button>';
                    }
                    pagHtml += '</div>';
                    container.innerHTML += pagHtml;
                }
    }

    function initPusher() {
        if (typeof Pusher === 'undefined') { setTimeout(initPusher, 500); return; }
        var pusher = new Pusher('a8860aca373dcc3400ce', { cluster: 'ap1' });
        pusherChannel = pusher.subscribe('hof-orders');
        pusherChannel.bind('new-order', function () { setTimeout(loadHistory, 500); });
        pusherChannel.bind('order-status-changed', function (data) {
            var payload = typeof data === 'string' ? JSON.parse(data) : data;
            if (typeof payload.data === 'string') payload = JSON.parse(payload.data);
            if (payload.order_id && window.HOFDevice) {
                HOFDevice.updateStatus(payload.order_id, payload.status || payload.message, undefined);
                updateBadges();
                loadHistory();
            }
        });
    }

    // Polling fallback: every 15s update statuses from server.
    // get_order_status.php accepts unsigned requests for read-only status.
    // (Logged-in customers use get_my_orders.php instead; the device poll is
    //  only meaningful for the guest/device path.)
    let historyPollInterval = setInterval(function () {
        if (window.HOFCustomer && window.HOFCustomer.isLoggedIn()) return;
        const orders = window.HOFDevice ? HOFDevice.orders() : [];
        if (orders.length === 0) return;
        orders.forEach(function (o) {
            if (o.status === 'CANCELLED' || o.status === 'COMPLETED' || o.status === 'SERVED') return;
            fetch('get_order_status.php?order_id=' + o.order_id)
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (data && data.status && data.status !== o.status) {
                        HOFDevice.updateStatus(o.order_id, data.status, undefined);
                        updateBadges();
                        renderOrders(HOFDevice.orders());
                    }
                })
                .catch(function () {});
        });
    }, 15000);

    window.addEventListener('beforeunload', () => clearInterval(historyPollInterval));

    function updateBadges() {
        if (window.updateBadge) window.updateBadge();
        var cart = JSON.parse(localStorage.getItem('cart') || '[]');
        var badge = document.getElementById('cartBadgeCount');
        if (badge) { badge.textContent = cart.length; }
    }

    window.resumeGcashPayment = async function (orderId, ref) {
        try {
            var deviceId = window.HOFDevice ? HOFDevice.id() : '';
            var resp = await fetch('/backend/payments/get-payment-link.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ order_id: orderId, ref: String(ref), purpose: 'pay', device_id: deviceId })
            });
            var data = await resp.json();
            if (data.success && data.signed_url) {
                window.location.href = data.signed_url;
            } else {
                window.location.href = 'checkout.html';
            }
        } catch (err) {
            window.location.href = 'checkout.html';
        }
    };

    window.obtainCancelSig = async function (orderId) {
        var ref = orderId;
        if (window.HOFDevice) {
            var order = HOFDevice.orders().find(function (o) { return o.order_id == orderId; });
            if (order && order.ref) ref = order.ref;
        }
        try {
            var resp = await fetch('/backend/payments/get-payment-link.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ order_id: orderId, ref: String(ref), purpose: 'cancel' })
            });
            var data = await resp.json();
            return data.success && data.sig ? data.sig : null;
        } catch (e) {
            return null;
        }
    };

    window.obtainReceiptSig = async function (orderId) {
        var ref = orderId;
        if (window.HOFDevice) {
            var order = HOFDevice.orders().find(function (o) { return o.order_id == orderId; });
            if (order && order.ref) ref = order.ref;
        }
        try {
            var resp = await fetch('/backend/payments/get-payment-link.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ order_id: orderId, ref: String(ref), purpose: 'receipt' })
            });
            var data = await resp.json();
            return data.success && data.sig ? data.sig : null;
        } catch (e) {
            return null;
        }
    };

    window.goHistoryPage = function (page) {
        sessionStorage.setItem('hof_history_page', String(page));
        loadHistory();
    };

    window.handleOrderAgain = function() {
        var orders = JSON.parse(localStorage.getItem('hof_orders') || '[]');
        var pendingUnpaid = orders.find(function(o) {
            return o.status === 'PENDING' && (!o.paid || o.payment_status !== 'COMPLETED');
        });
        if (pendingUnpaid) {
            window.location.href = '../customer/checkout.html?order_id=' + pendingUnpaid.order_id;
        } else {
            localStorage.removeItem('cart');
            window.location.href = '../customer/customer.html';
        }
    };
})();