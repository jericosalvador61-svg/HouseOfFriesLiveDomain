(function () {
const APP_ROOT = (() => {
    try {
        const m = window.location.pathname.match(/^(.*?)(?:\/public|\/customer|\/backend|\/admin|\/cashier|\/inventoryStaff|\/kitchenStaff|\/waiter|\/supervisor)(?:\/|$)/i);
        return (m && m[1]) ? m[1].replace(/\/$/, '') : '';
    } catch (_) { return ''; }
})();

  let pollInterval = null;

  // REQ-052 B3: shared escape helper for every dynamic value rendered into HTML.
  function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    var d = document.createElement('div');
    d.textContent = String(text);
    return d.innerHTML;
  }

  document.addEventListener('DOMContentLoaded', function () {
    updateBadge();
    const btn = document.getElementById('myOrdersBtn');
    if (btn) btn.addEventListener('click', handleMyOrdersClick);
    window.addEventListener('storage', updateBadge);
  });

  window.handleMyOrdersClick = function () {
    window.location.href = 'orderHistory.html';
  };

  window.updateBadge = function () {
    const badge = document.getElementById('myOrdersBadge');
    if (!badge) return;
    const count = window.HOFDevice ? HOFDevice.activeCount() : 0;
    badge.textContent = count;
    badge.style.display = count > 0 ? 'inline' : 'none';
  };

  window.openMyOrders = function () {
    if (!window.HOFDevice) return;
    const orders = HOFDevice.orders();
    if (orders.length === 0) {
      Swal.fire({ icon: 'info', title: 'No Orders', text: 'You have not placed any orders yet.', confirmButtonColor: '#FFB800' });
      return;
    }

    // Determine active filter (default: Active — hide CANCELLED)
    let activeFilter = sessionStorage.getItem('hof_myorders_filter') || 'active';
    renderFilteredOrders(orders, activeFilter);
  };

  function renderFilteredOrders(orders, filter) {
    sessionStorage.setItem('hof_myorders_filter', filter);

    const filtered = filter === 'all' ? orders
      : filter === 'cancelled' ? orders.filter(o => o.status === 'CANCELLED')
      : orders.filter(o => o.status !== 'CANCELLED');

    const filterChips = `
      <div style="display:flex;gap:8px;margin-bottom:12px;justify-content:center;">
        <span class="chip-filter ${filter === 'all' ? 'chip-active' : ''}" data-filter="all" style="padding:6px 16px;border-radius:20px;font-size:13px;font-weight:600;cursor:pointer;${filter === 'all' ? 'background:#FFB800;color:#1e1e1e;' : 'background:#f0f0f0;color:#666;'}">All</span>
        <span class="chip-filter ${filter === 'active' ? 'chip-active' : ''}" data-filter="active" style="padding:6px 16px;border-radius:20px;font-size:13px;font-weight:600;cursor:pointer;${filter === 'active' ? 'background:#FFB800;color:#1e1e1e;' : 'background:#f0f0f0;color:#666;'}">Active</span>
        <span class="chip-filter ${filter === 'cancelled' ? 'chip-active' : ''}" data-filter="cancelled" style="padding:6px 16px;border-radius:20px;font-size:13px;font-weight:600;cursor:pointer;${filter === 'cancelled' ? 'background:#FFB800;color:#1e1e1e;' : 'background:#f0f0f0;color:#666;'}">Cancelled</span>
      </div>`;

    let html = filterChips + '<div style="max-height:360px;overflow-y:auto;text-align:left;">';
    filtered.forEach(o => {
      const statusColor = statusChipColor(o.status);
      const paidLabel = o.paid ? '<span class="badge bg-success ms-1">Paid</span>' : '<span class="badge bg-warning text-dark ms-1">Unpaid</span>';
      const isEditable = o.status === 'PENDING' && !o.paid;
      const refSafe = escapeHtml(o.ref || o.order_id);
      const statusSafe = escapeHtml(o.status);
      const tableSafe = escapeHtml(o.table_number);
      const createdSafe = escapeHtml(o.created_at ? new Date(o.created_at).toLocaleString() : '');
      html += `<div style="padding:12px;border-bottom:1px solid #eee;display:flex;flex-direction:column;gap:6px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong>#${refSafe}</strong>
          <span><span class="badge" style="background:${statusColor};">${statusSafe}</span>${paidLabel}</span>
        </div>
        <div style="font-size:12px;color:#666;">
          ${tableSafe ? 'Table ' + tableSafe : 'Takeout'} · ${createdSafe}
        </div>
        <div style="display:flex;gap:8px;margin-top:4px;">
          <button class="btn btn-sm btn-outline-primary" onclick="window.location.href='orderTracker.html?order_id=${escapeHtml(o.order_id)}'" style="flex:1;font-size:12px;">Track</button>
          ${isEditable ? `<button class="btn btn-sm btn-outline-warning" onclick="window.editFromMyOrders(${escapeHtml(o.order_id)})" style="flex:1;font-size:12px;">Edit</button>` : ''}
          ${o.paid || o.status !== 'PENDING' ? `<button class="btn btn-sm btn-outline-success" onclick="window.orderAgainFromMyOrders()" style="flex:1;font-size:12px;">Order Again</button>` : ''}
        </div>
      </div>`;
    });
    html += '</div>';

    startPolling();

    const popup = Swal.fire({
      title: '<i class="fa-solid fa-receipt"></i> My Orders',
      html: html,
      showConfirmButton: false,
      showCloseButton: true,
      background: '#fff',
      customClass: { popup: 'rounded-4' },
      didOpen: () => {
        document.querySelectorAll('.chip-filter').forEach(chip => {
          chip.addEventListener('click', function () {
            const newFilter = this.dataset.filter;
            const orders = window.HOFDevice ? HOFDevice.orders() : [];
            Swal.close();
            renderFilteredOrders(orders, newFilter);
          });
        });
      },
      didClose: () => { stopPolling(); }
    });
  }

  function statusChipColor(status) {
    const map = { 'PENDING': '#FFB800', 'IN-PROGRESS': '#007AFF', 'PREPARING': '#007AFF', 'COOKING': '#FF9500', 'COMPLETED': '#34C759', 'READY': '#34C759', 'SERVED': '#8E8E93', 'CANCELLED': '#FF3B30' };
    return map[status] || '#8E8E93';
  }

  function startPolling() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(() => {
      const orders = window.HOFDevice ? HOFDevice.orders() : [];
      orders.forEach(o => {
        fetch('get_order_status.php?order_id=' + o.order_id)
          .then(r => r.json())
          .then(data => {
            if (data && data.status && data.status !== o.status) {
              HOFDevice.updateStatus(o.order_id, data.status, o.paid);
              updateBadge();
            }
          })
          .catch(() => {});
      });
    }, 15000);
  }

  function stopPolling() {
    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
  }

  window.editFromMyOrders = function (orderId) {
    const orders = window.HOFDevice ? HOFDevice.orders() : [];
    const order = orders.find(o => o.order_id == orderId);
    if (!order) return;
    // Guard: only PENDING + unpaid orders are editable
    if (order.status !== 'PENDING' || order.paid) {
      Swal.fire('Cannot Edit', 'This order is no longer editable. Please place a new order.', 'info');
      return;
    }
    // Load order items into cart and go to customer.html
    const deviceId = window.HOFDevice ? HOFDevice.id() : '';
    // REQ-050 C1: obtain BOTH the items sig (to load the cart) and the edit
    // sig (required later by update_existing_order.php ownership gate).
    fetch(`${APP_ROOT}/backend/payments/get-payment-link.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId, ref: order.ref, purpose: 'items', device_id: deviceId })
    })
    .then(r => r.json())
    .then(linkData => {
      let itemsUrl = 'get_order_items.php?order_id=' + orderId;
      if (linkData.success && linkData.sig) {
        itemsUrl += '&ref=' + encodeURIComponent(order.ref) + '&sig=' + encodeURIComponent(linkData.sig);
      }
      fetch(itemsUrl)
      .then(r => r.json())
      .then(data => {
        if (data.success && data.items) {
          localStorage.setItem('cart', JSON.stringify(data.items));
          localStorage.setItem('editOrderId', orderId);
          localStorage.setItem('editRefNumber', order.ref);
          // Fetch the edit sig so the subsequent update passes the gate.
          return fetch(`${APP_ROOT}/backend/payments/get-payment-link.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order_id: orderId, ref: order.ref, purpose: 'edit', device_id: deviceId })
          });
        } else {
          Swal.fire('Error', 'Could not load order items for editing.', 'error');
          return null;
        }
      })
      .then(editResp => {
        if (editResp && editResp.ok) return editResp.json();
        return null;
      })
      .then(editData => {
        if (editData && editData.success && editData.sig) {
          localStorage.setItem('editSig', editData.sig);
        }
        window.location.href = 'customer.html';
      })
      .catch(() => {
        Swal.fire('Error', 'Could not load order for editing.', 'error');
      });
    })
    .catch(() => {
      Swal.fire('Error', 'Could not load order for editing.', 'error');
    });
  };

  window.orderAgainFromMyOrders = function () {
    localStorage.removeItem('cart');
    localStorage.removeItem('lastOrderID');
    localStorage.removeItem('lastRefNumber');
    window.location.href = 'customer.html';
  };
})();