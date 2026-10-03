const APP_ROOT = (() => {
    try {
        const m = window.location.pathname.match(/^(.*?)(?:\/public|\/customer|\/backend|\/admin|\/cashier|\/inventoryStaff|\/kitchenStaff|\/waiter|\/supervisor)(?:\/|$)/i);
        return (m && m[1]) ? m[1].replace(/\/$/, '') : '';
    } catch (_) { return ''; }
})();
// 1. Selectors
const cartItemsList = document.getElementById('cartItemsList');
const cartViewTotalCount = document.getElementById('cartViewTotalCount');
const cartViewTotalAmount = document.getElementById('cartViewTotalAmount');
const tableDisplay = document.getElementById('tableDisplay');

// 2. Initialize
document.addEventListener('DOMContentLoaded', () => {
    // ── SESSION BOUNDARY CHECK ──
    // The cart page and the menu page share ONE session object
    // (hof_order_session). If the cart's session identity has drifted
    // from the menu page's (e.g. a new QR was scanned in another tab),
    // the old cart must not leak into the new session.
    try {
        const session = JSON.parse(localStorage.getItem('hof_order_session'));
        const currentTid = localStorage.getItem('currentTableId');
        if (session && session.table_id && currentTid && String(session.table_id) !== String(currentTid)) {
            localStorage.removeItem('cart');
        }
    } catch (e) { /* corrupted session — render from what we have */ }
    displayCurrentTable();
    renderCart();
    ensureMenuStatusCache().then(() => renderCart()); // REQ-054 B1: re-paint red once statuses arrive
    setupCartNavigation();
    setupSwipeGestures(); // Initialize gesture listener bindings
    bindMenuAvailability(); // REQ-050 L6: live menu availability on cart page
    bindOrderLiveUpdates(); // REQ-054 B4-G: Pusher + polling on the cart page
});

// --- 1. DYNAMIC HEADER LOGIC ---
// Uses the verified session + the stored table number. It never needs a
// network round trip, so Back-navigating to this page cannot show a stuck
// "Verifying your table…" spinner.
function displayCurrentTable() {
    let session = null;
    try {
        session = JSON.parse(localStorage.getItem('hof_order_session'));
    } catch (e) { session = null; }

    // Fetch the active preference from local storage (default to DINE_IN if not set)
    let savedType = (session && session.order_type) || localStorage.getItem('orderType') || 'DINE_IN';

    // Clean string formatting for the banner layout
    let displayType = (savedType === 'TAKE_OUT') ? 'Take Out' : 'Dine In';

    if (savedType === 'TAKE_OUT') {
        const customerName = localStorage.getItem('customerName');
        if (customerName && tableDisplay) {
            tableDisplay.textContent = `Takeout / ${customerName}`;
        } else if (tableDisplay) {
            tableDisplay.textContent = `Takeout Order`;
        }
    } else {
        const tableNumber = (session && session.table_number) || localStorage.getItem('currentTableNumber');
        const savedTableId = (session && session.table_id) || localStorage.getItem('currentTableId');
        if (tableNumber && tableDisplay) {
            tableDisplay.textContent = `Table ${tableNumber} / ${displayType}`;
        } else if (savedTableId && !session && tableDisplay) {
            // Legacy identity with no verified session — resolve it once.
            tableDisplay.textContent = `Verifying your table…`;
            fetch('validate_table.php?table_id=' + encodeURIComponent(savedTableId))
                .then(r => r.json())
                .then(info => {
                    if (info && info.valid) {
                        localStorage.setItem('currentTableNumber', info.table_number || '');
                        tableDisplay.textContent = `Table ${info.table_number} / ${displayType}`;
                    } else {
                        tableDisplay.textContent = `Table Unavailable`;
                    }
                })
                .catch(() => {
                    tableDisplay.textContent = `Ordering / ${displayType}`;
                });
        } else if (tableDisplay) {
            tableDisplay.textContent = `Ordering / ${displayType}`;
        }
    }
}

// 3. Logic to Group and Render Items
// A stored line is now { menu_item_id, quantity, price, special_instructions,
// choices[], addons[] } (REQ-040). Legacy carts hold one line per unit without
// a `quantity` field — those still render (backward compatible).

// Config signature so two lines of the SAME base item with different flavors /
// add-ons stay separate lines (REQ-040 MEDIUM-3).
function lineSignature(line) {
    const choices = (line.choices || []).map(c => String(c)).slice().sort();
    const addons = (line.addons || []).slice().sort((a, b) => String(a.menu_addon_id).localeCompare(String(b.menu_addon_id)))
        .map(a => a.menu_addon_id + 'x' + (parseInt(a.quantity, 10) || 1));
    return line.menu_item_id + '|' + choices.join(',') + '|' + addons.join(',');
}

// Attach/refresh line_key on a line so cart ops can target one configuration.
function withLineKey(line) {
    const clone = Object.assign({}, line);
    clone.line_key = lineSignature(clone);
    return clone;
}

// ── REQ-054 B1: live menu availability for carted lines ──
// Map of menu_item_id -> status ('Available' | 'Unavailable'), loaded once
// from get_menu.php so cart lines that reference an unavailable item render
// red immediately. Falls back to any previously cached menu data; never
// blocks rendering.
let menuStatusCache = null; // menu_item_id (string) -> status string

async function ensureMenuStatusCache() {
    if (menuStatusCache) return;
    function buildMap(menu) {
        const map = {};
        (menu || []).forEach(p => { map[String(p.menu_item_id)] = p.status || 'Available'; });
        return map;
    }
    try {
        const res = await fetch('get_menu.php');
        const data = await res.json();
        if (!Array.isArray(data)) throw new Error('bad payload');
        cartMenuCache = data;
        menuStatusCache = buildMap(data);
    } catch (e) {
        if (Array.isArray(cartMenuCache)) {
            menuStatusCache = buildMap(cartMenuCache);
        } else {
            menuStatusCache = {};
        }
    }
}

function renderCart() {
    const rawCart = JSON.parse(localStorage.getItem('cart')) || [];

    const groupedCart = rawCart.reduce((acc, item) => {
        const line = withLineKey(item);
        const qty = parseInt(line.quantity, 10);
        const lineQty = isNaN(qty) || qty < 1 ? 1 : qty;
        if (!acc[line.line_key]) {
            acc[line.line_key] = { ...line, quantity: lineQty };
        } else {
            acc[line.line_key].quantity += lineQty;
        }
        return acc;
    }, {});

    const items = Object.values(groupedCart);
    cartItemsList.innerHTML = '';

    if (items.length === 0) {
        cartItemsList.innerHTML = '<p style="text-align:center; padding: 40px 20px; color:#75757a; font-weight: 500;">Your cart is empty.</p>';
        updateTotals(0, 0);
        return;
    }

    let totalQuantity = 0;
    let totalPrice = 0;

    items.forEach(item => {
        const itemTotal = parseFloat(item.price) * item.quantity;
        totalQuantity += item.quantity;
        totalPrice += itemTotal;

        const minusStyle = item.quantity <= 1 ? 'style="opacity: 0.3; cursor: not-allowed;"' : '';

        // --- CLEAN PATH RESOLUTION ---
        let filename = item.image_url ? item.image_url.split('/').pop() : '';
        let imageSrc = filename ? `/images/menu/${filename}` : '';

        // Display composed options text: prefer the popup's display-only
        // `composed_instructions`; fall back to the server/legacy composed
        // `special_instructions`. The two are kept separate so the free-text
        // box in the popup isn't re-composed (REQ-040).
        const displayInstr = (item.composed_instructions || item.special_instructions || '').trim();
        const instrHtml = displayInstr
            ? `<div class="instr-wrap"><div class="instr-saved">${escapeHtmlAttr(displayInstr)}</div></div>`
            : '';

        // REQ-054 B1: mark lines whose menu item is now Unavailable in red
        // (tag + border), using the cached menu status when available.
        const isUnavailable = menuStatusCache
            && String(menuStatusCache[String(item.menu_item_id)] || '') === 'Unavailable';
        const unavailableTag = isUnavailable
            ? '<div class="unavailable-tag">Unavailable</div>'
            : '';
        const itemCardStyle = isUnavailable
            ? 'style="border:2px solid #dc3545;background:#fff5f5;"'
            : '';

        // Double-nested DOM layout architecture matching touch swiping expectations.
        // The item-details area is tappable to reopen the choice/add-on popup
        // (REQ-040); the swipe-delete + quantity steppers keep working as before.
        const card = `
            <div class="swipe-item-wrapper" id="wrapper-${item.line_key}">
                <div class="swipe-delete-action" onclick="removeItem('${item.line_key}', event)">
                    <i class="fa-solid fa-trash-can"></i>
                </div>
                <div class="cart-item-content" ${itemCardStyle}>
                <img src="${imageSrc}" alt="${escapeHtmlAttr(item.item_name)}" onerror="this.style.display='none';">
                    <div class="item-details" onclick="editCartLine('${item.line_key}')">
                        <div>
                            <h3>${escapeHtmlAttr(item.item_name)}</h3>
                            <p>${escapeHtmlAttr(item.description || 'Delicious side or entry option.')}</p>
                        </div>
                        ${unavailableTag}
                        ${instrHtml}
                        <div class="item-price-tag" ${isUnavailable ? 'style="color:#dc3545;"' : ''}>₱ ${(parseFloat(item.price)).toFixed(2)}</div>
                    </div>
                    <div class="cart-controls">
                        <button class="btn-ctrl minus" ${minusStyle} onclick="changeQty('${item.line_key}', -1, event)">-</button>
                        <div class="qty-label">${item.quantity}</div>
                        <button class="btn-ctrl plus" onclick="changeQty('${item.line_key}', 1, event)">+</button>
                    </div>
                </div>
            </div>
        `;
        cartItemsList.insertAdjacentHTML('beforeend', card);
    });

    updateTotals(totalQuantity, totalPrice);
}

function updateTotals(count, amount) {
    if (cartViewTotalCount) cartViewTotalCount.textContent = count;
    if (cartViewTotalAmount) {
        cartViewTotalAmount.textContent = `₱ ${amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
    }
}

// Added target event suppression so tapping quantity adjustments doesn't trigger swipe closures
window.changeQty = function (lineKey, delta, event) {
    if (event) event.stopPropagation();

    let cart = JSON.parse(localStorage.getItem('cart')) || [];
    const index = cart.findIndex(i => (withLineKey(i).line_key) === lineKey);
    if (index === -1) return;

    const originalItem = cart[index];
    const q = parseInt(originalItem.quantity, 10);
    const qty = isNaN(q) || q < 1 ? 1 : q;

    if (delta === 1) {
        cart[index].quantity = qty + 1;
    } else {
        if (qty > 1) {
            cart[index].quantity = qty - 1;
        } else {
            cart.splice(index, 1);
        }
    }
    localStorage.setItem('cart', JSON.stringify(cart));
    renderCart();
};

window.removeItem = function (lineKey, event) {
    if (event) event.stopPropagation();
    let cart = JSON.parse(localStorage.getItem('cart')) || [];
    cart = cart.filter(i => (withLineKey(i).line_key) !== lineKey);
    localStorage.setItem('cart', JSON.stringify(cart));
    renderCart();
};

// --- REQ-040: reopen the choice/add-on popup from the cart line ---
// The item-details area of each cart line is tappable. The stored line is
// passed as `initial` so the popup pre-fills the current configuration.
// On confirm the line is replaced in place (preserving other lines).
let cartMenuCache = null;
async function editCartLine(lineKey) {
    let cart = JSON.parse(localStorage.getItem('cart')) || [];
    const existingIndex = cart.findIndex(i => (withLineKey(i).line_key) === lineKey);
    if (existingIndex === -1) return;

    const initial = cart[existingIndex];
    const menuItemId = initial.menu_item_id;

    // Load the menu (once) so we can pass the full item with choices/add-ons.
    if (!cartMenuCache) {
        try {
            const res = await fetch('get_menu.php');
            cartMenuCache = await res.json();
        } catch (e) {
            alert("We couldn't load the menu. Please try again.");
            return;
        }
    }
    const item = cartMenuCache.find(p => String(p.menu_item_id) === String(menuItemId));
    if (!item) {
        alert("Sorry, this item is no longer on the menu.");
        return;
    }

    window.HOFChoicePopup.open({
        item: item,
        initial: initial,
        onConfirm: function (line) {
            // Preserve the DB-rebuilt (configured) marker so a resume/edit line
            // keeps skipping the required-group gate on re-submit (HIGH-3),
            // and keep the order_item_id so the authoritative stored price
            // survives re-submit (REQ-050 C2).
            const enriched = Object.assign({}, withLineKey(line), {
                configured: !!initial.configured,
                order_item_id: initial.order_item_id || 0,
                item_name: item.item_name,
                description: item.description,
                image_url: item.image_url
            });
            const idx = cart.findIndex(i => (withLineKey(i).line_key) === lineKey);
            if (idx !== -1) cart.splice(idx, 1, enriched);
            localStorage.setItem('cart', JSON.stringify(cart));
            renderCart();
        }
    });
}

// --- Compact special-instructions control ("+ Add Instruction") ---
// Each line renders one of: add-instruction button, saved text + Edit/Remove,
// or an inline textarea while editing.
function escapeHtmlAttr(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Touch-gesture tracking logic decoupled natively into the JS file
function setupSwipeGestures() {
    let startX = 0;
    let startY = 0;
    let activeCard = null;
    let isSwiping = false;

    cartItemsList.addEventListener('touchstart', (e) => {
        const card = e.target.closest('.cart-item-content');
        if (!card) return;

        if (activeCard && activeCard !== card) {
            activeCard.classList.remove('swiped');
            activeCard = null;
        }

        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        isSwiping = true;
    }, { passive: true });

    cartItemsList.addEventListener('touchmove', (e) => {
        if (!isSwiping) return;

        const card = e.target.closest('.cart-item-content');
        if (!card) return;

        const currentX = e.touches[0].clientX;
        const currentY = e.touches[0].clientY;

        const diffX = startX - currentX;
        const diffY = Math.abs(startY - currentY);

        if (diffY > 10 && !card.classList.contains('swiped')) {
            isSwiping = false;
            return;
        }

        if (diffX > 45) {
            card.classList.add('swiped');
            activeCard = card;
            isSwiping = false;
        } else if (diffX < -45) {
            card.classList.remove('swiped');
            if (activeCard === card) activeCard = null;
            isSwiping = false;
        }
    }, { passive: true });

    cartItemsList.addEventListener('touchend', () => {
        isSwiping = false;
    });
}

// --- 2. DYNAMIC SUBMISSION LOGIC ---
// Helper: rebuild cart from DB order items (F1 — resume paths must match DB)
async function rebuildCartFromOrder(orderId) {
  let itemsUrl = 'get_order_items.php?order_id=' + orderId;
  const editRef = localStorage.getItem('editRefNumber');
  if (editRef) {
    try {
      const deviceId = (window.HOFDevice ? HOFDevice.id() : '');
      const resp = await fetch(`${APP_ROOT}/backend/payments/get-payment-link.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: orderId, ref: editRef, purpose: 'items', device_id: deviceId })
      });
      const data = await resp.json();
      if (data.success && data.sig) {
        itemsUrl += '&ref=' + encodeURIComponent(editRef) + '&sig=' + encodeURIComponent(data.sig);
      }
    } catch (e) {}
  }
  const resp = await fetch(itemsUrl);
  if (!resp.ok) throw new Error('Failed to load order items');
  const data = await resp.json();
  if (!data.success || !data.items) throw new Error('Invalid order items response');
  localStorage.setItem('cart', JSON.stringify(data.items));
  const grouped = data.items.reduce((acc, item) => {
    const line = withLineKey(item);
    const id = item.menu_item_id;
    const lineQty = parseInt(item.quantity, 10);
    const qty = isNaN(lineQty) || lineQty < 1 ? 1 : lineQty;
    if (!acc[line.line_key]) {
      acc[line.line_key] = {
        menu_item_id: id,
        price: parseFloat(item.price),
        quantity: qty,
        special_instructions: item.special_instructions || '',
        composed_instructions: item.composed_instructions || item.special_instructions || '',
        choices: item.choices || [],
        addons: item.addons || [],
        configured: !!item.configured,
        order_item_id: item.order_item_id || 0
      };
    } else {
      acc[line.line_key].quantity += qty;
    }
    return acc;
  }, {});
  return Object.values(grouped).reduce((sum, i) => sum + (i.price * i.quantity), 0);
}

// ── REQ-050 L6: live menu availability on the cart page ──
// Mirrors the customer.html binding. When the kitchen/admin flips an item
// to Unavailable, lines in the cart that reference it are surfaced so the
// customer knows before checkout instead of discovering it at submit.
function bindMenuAvailability() {
    if (typeof Pusher === 'undefined') return;
    const pusher = new Pusher('a8860aca373dcc3400ce', { cluster: 'ap1' });
    const menuChannel = pusher.subscribe('hof-menu');
    menuChannel.bind('menu-availability-changed', function (data) {
        let payload = typeof data === 'string' ? JSON.parse(data) : data;
        if (typeof payload.data === 'string') payload = JSON.parse(payload.data);
        if (!payload.menu_item_id || !payload.status) return;

        const cart = JSON.parse(localStorage.getItem('cart')) || [];
        const hit = cart.some(line => String(line.menu_item_id) === String(payload.menu_item_id));
        if (!hit) return;

        // REQ-054 B1: reflect the new status in the cache so the line turns red live.
        if (!menuStatusCache) menuStatusCache = {};
        menuStatusCache[String(payload.menu_item_id)] = payload.status;

        const name = payload.item_name || ('Item #' + payload.menu_item_id);
        if (payload.status === 'Unavailable') {
            Swal.fire({
                icon: 'warning',
                title: 'Item Unavailable',
                text: name + ' is no longer available. Remove it or swap it before checking out.',
                confirmButtonText: 'OK',
                confirmButtonColor: '#FFB800'
            });
        }
        renderCart();
    });
}

// ── REQ-054 B4-G: Pusher + 30s polling on the cart page ──
// The cart is read-only for an active order, but live updates keep the badge
// and "unpaid order" resume flow in sync with the cashier's actions.
function bindOrderLiveUpdates() {
    const lastOrderId = localStorage.getItem('lastOrderID');

    if (typeof Pusher !== 'undefined') {
        try {
            const pusher = new Pusher('a8860aca373dcc3400ce', { cluster: 'ap1' });
            const orderChannel = pusher.subscribe('hof-orders');
            orderChannel.bind('order-status-changed', function (data) {
                let payload = typeof data === 'string' ? JSON.parse(data) : data;
                if (typeof payload.data === 'string') payload = JSON.parse(payload.data);
                if (!lastOrderId || String(payload.order_id) !== String(lastOrderId)) return;
                // When the order becomes paid, clear the stale cart badge.
                if (payload.status === 'IN-PROGRESS' || payload.status === 'COOKING') {
                    localStorage.removeItem('cart');
                    renderCart();
                }
            });
        } catch (e) { console.warn('Pusher init error:', e); }
    }

    setInterval(function () {
        const oid = localStorage.getItem('lastOrderID');
        if (!oid) return;
        fetch('get_order_status.php?order_id=' + encodeURIComponent(oid))
            .then(r => r.json())
            .then(data => {
                if (data && data.paid) {
                    localStorage.removeItem('cart');
                    renderCart();
                }
            })
            .catch(() => {});
    }, 30000);
}

function setupCartNavigation() {
    const placeOrderBtn = document.getElementById('placeOrderBtn');

    // REQ-054 B4-B: the button label follows the chosen method — the choice
    // is made HERE on the cart page and carried into checkout.
    function updateButtonLabel() {
        const selected = document.querySelector('input[name="payment_method"]:checked');
        if (!placeOrderBtn) return;
        if (selected && selected.value === 'GCASH') {
            placeOrderBtn.textContent = 'Pay with GCash';
        } else if (selected && selected.value === 'CASH') {
            placeOrderBtn.textContent = 'Proceed to Cashier / Pay at Counter';
        } else {
            placeOrderBtn.textContent = 'Proceed to Payment';
        }
    }
    document.querySelectorAll('input[name="payment_method"]').forEach(radio => {
        radio.addEventListener('change', updateButtonLabel);
    });
    updateButtonLabel();

    if (placeOrderBtn) {
        placeOrderBtn.addEventListener('click', async () => {
            const rawCart = JSON.parse(localStorage.getItem('cart')) || [];

            if (rawCart.length === 0) {
                alert("Your cart is empty!");
                return;
            }

            // ── REQ-054 B1: block unavailable items BEFORE geofence/edit ──
            // Check every carted line against the current menu status (cached
            // from get_menu.php; falls back to cached menu if fetch failed).
            if (!menuStatusCache) await ensureMenuStatusCache();
            const unavailableNames = [];
            const seenUnavailable = {};
            rawCart.forEach(line => {
                const key = String(line.menu_item_id);
                if (String(menuStatusCache[key] || '') === 'Unavailable' && !seenUnavailable[key]) {
                    seenUnavailable[key] = true;
                    unavailableNames.push('• ' + (line.item_name || ('Item #' + key)));
                }
            });
            if (unavailableNames.length > 0) {
                await Swal.fire({
                    icon: 'warning',
                    title: 'Some items are unavailable',
                    html: unavailableNames.join('<br>') + '<br><br>Please remove or replace them.',
                    confirmButtonColor: '#FFB800'
                });
                return;
            }

            const grouped = rawCart.reduce((acc, item) => {
                const line = withLineKey(item);
                const id = line.menu_item_id;
                const lineQty = parseInt(line.quantity, 10);
                const qty = isNaN(lineQty) || lineQty < 1 ? 1 : lineQty;
                if (!acc[line.line_key]) {
                    acc[line.line_key] = {
                        menu_item_id: id,
                        price: parseFloat(line.price),
                        quantity: qty,
                        special_instructions: line.special_instructions || '',
                        choices: line.choices || [],
                        addons: line.addons || [],
                        configured: !!line.configured,
                        order_item_id: line.order_item_id || 0
                    };
                } else {
                    acc[line.line_key].quantity += qty;
                }
                return acc;
            }, {});

            const finalCartItems = Object.values(grouped);
            const totalAmount = finalCartItems.reduce((sum, i) => sum + (i.price * i.quantity), 0);
            const savedTableId = localStorage.getItem('currentTableId');
            const currentOrderType = localStorage.getItem('orderType') || (savedTableId ? 'DINE_IN' : 'TAKE_OUT');

            // ── GEOFENCE QUICK CHECK FIRST (P0) ──
            // If admin turned geofence OFF, skip location check entirely.
            const geoDisabled = localStorage.getItem('hof_geo_disabled') === 'true'
                             || sessionStorage.getItem('hof_geo_disabled') === 'true';
            let geofence = null;
            if (!geoDisabled) {

            // Geofence (US-SYS-013) — the authoritative check happens again in
            // place_order.php; here we just refuse to submit without coords
            // and hand the customer back to the menu for a clean re-verify.
            const geoCoords = window.hofCustomerCoords
                || (() => {
                    try { return JSON.parse(sessionStorage.getItem('hof_geo_coords')); }
                    catch (e) { return null; }
                })()
                || (() => {
                    try { return JSON.parse(localStorage.getItem('hof_geo_coords')); }
                    catch (e) { return null; }
                })()
                || {};

            if (!geoCoords.lat && !geoCoords.lng) {
                await Swal.fire({
                    icon: 'warning',
                    title: "We couldn't verify your location",
                    html: "We couldn't verify your location.<br><br>" +
                        "Please allow location access, make sure your device GPS is enabled, " +
                        "and stay near the restaurant.<br><br>" +
                        "You will be taken back to the menu to verify again.",
                    confirmButtonText: 'Back to Menu',
                    confirmButtonColor: '#FFB800',
                    allowOutsideClick: false
                });
                window.location.href = 'customer.html';
                return;
            }

            geofence = {
                lat: parseFloat(geoCoords.lat),
                lng: parseFloat(geoCoords.lng),
                accuracy: parseFloat(geoCoords.accuracy) || 0
            };

            } // end if !geoDisabled

            // ── CHECK: EDIT EXISTING ORDER (REQ-015) ──
            const editOrderId = localStorage.getItem('editOrderId');
            const editRefNumber = localStorage.getItem('editRefNumber');
            if (editOrderId && editRefNumber) {
                placeOrderBtn.innerText = "Updating Order...";
                placeOrderBtn.disabled = true;
                try {
                    // REQ-050 C1: the update endpoint now requires the HMAC
                    // edit signature (bound to this device) issued when the
                    // edit link was obtained on checkout.
                    const editSig = localStorage.getItem('editSig') || '';
                    const deviceId = (window.HOFDevice ? HOFDevice.id() : '');
                    const updateResp = await fetch('update_existing_order.php', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            order_id: parseInt(editOrderId),
                            reference_number: editRefNumber,
                            items: finalCartItems,
                            sig: editSig,
                            device_id: deviceId
                        })
                    });
                    const updateResult = await updateResp.json();

                    if (updateResult.unavailable && updateResult.unavailable.length > 0) {
                        const list = updateResult.unavailable.map(n => '• ' + n).join('<br>');
                        await Swal.fire({
                            icon: 'warning',
                            title: 'Some items are unavailable',
                            html: list + '<br><br>Please remove or replace them, then check out again.',
                            confirmButtonColor: '#FFB800'
                        });
                        placeOrderBtn.innerText = "Proceed to Payment";
                        placeOrderBtn.disabled = false;
                        return;
                    }

                    if (updateResult.success) {
                        localStorage.setItem('lastOrderID', editOrderId);
                        localStorage.setItem('lastRefNumber', editRefNumber);
                        localStorage.removeItem('editOrderId');
                        localStorage.removeItem('editRefNumber');
                        localStorage.removeItem('editSig');
                        if (window.HOFDevice) {
                            HOFDevice.addOrder({
                                order_id: parseInt(editOrderId), ref: editRefNumber,
                                status: 'PENDING', paid: false,
                                table_number: localStorage.getItem('currentTableNumber') || null,
                                created_at: new Date().toISOString()
                            });
                        }
                        const editPaymentInput = document.querySelector('input[name="payment_method"]:checked');
                        if (!editPaymentInput) {
                            await Swal.fire({
                                icon: 'warning',
                                title: 'Payment Method Needed',
                                text: 'Please select a payment method first.',
                                confirmButtonText: 'OK',
                                confirmButtonColor: '#FFB800'
                            });
                            placeOrderBtn.innerText = "Proceed to Payment";
                            placeOrderBtn.disabled = false;
                            return;
                        }
                        const selectedPayment = editPaymentInput.value;
                        // REQ-054 B4-B: carry the cart's payment choice to checkout.
                        localStorage.setItem('payment_method', selectedPayment);
                        window.location.href = 'checkout.html';
                        return;
                    }
                    localStorage.removeItem('editOrderId');
                    localStorage.removeItem('editRefNumber');
                    localStorage.removeItem('editSig');
                    if (updateResp.status === 409) {
                        const placeNew = await Swal.fire({
                            icon: 'info', title: 'Cannot Edit',
                            text: updateResult.message,
                            confirmButtonText: 'Place New Order',
                            showCancelButton: true, cancelButtonText: 'Cancel'
                        });
                        if (!placeNew.isConfirmed) { return; }
                    } else {
                        alert(updateResult.message || 'Failed to update order');
                        return;
                    }
                } catch (err) {
                    console.error("Edit order error:", err);
                    alert("Failed to update order: " + err.message);
                    return;
                } finally {
                    placeOrderBtn.innerText = "Proceed to Payment";
                    placeOrderBtn.disabled = false;
                }
            }

            // ── TAKE-OUT GUARD (REQ-014): check for existing unpaid PENDING order ──
            if (!savedTableId && window.HOFDevice) {
                const activeOrders = HOFDevice.orders().filter(o => o.status === 'PENDING' && !o.paid);
                if (activeOrders.length > 0) {
                    const existing = activeOrders[0];
                    const continueOrder = await Swal.fire({
                        icon: 'info', title: 'Unpaid Order',
                        text: 'You have an unpaid order. Continue it?',
                        confirmButtonText: 'Continue',
                        showCancelButton: true, cancelButtonText: 'Start Over'
                    });
                    if (continueOrder.isConfirmed) {
                        localStorage.setItem('lastOrderID', existing.order_id);
                        localStorage.setItem('lastRefNumber', existing.ref);
                        try {
                          await rebuildCartFromOrder(existing.order_id);
                          window.location.href = 'checkout.html';
                        } catch (e) {
                          alert('Failed to load order items: ' + e.message);
                        }
                        return;
                    }
                }
            }

            const paymentInput = document.querySelector('input[name="payment_method"]:checked');

            // ── PAYMENT METHOD IS REQUIRED (P0) ──
            // Neither Cash nor GCash may be pre-selected. If the customer
            // tries to continue without choosing, stop here — the backend
            // re-validates this as well, but the UX must explain it first.
            if (!paymentInput) {
                await Swal.fire({
                    icon: 'warning',
                    title: 'Payment Method Needed',
                    text: 'Please select a payment method first.',
                    confirmButtonText: 'OK',
                    confirmButtonColor: '#FFB800'
                });
                return;
            }
            const selectedPayment = paymentInput.value;

            // ── DUPLICATE ORDER REDIRECT (REQ-014): handle server-side duplicate response ──
            // ── plus the AUTH backend-rejection helper below (deleted / maintenance
            //    table, failed geofence, missing payment method) ──
            const showBlockedOrderError = async (result) => {
                const blocked = String((result && result.blocked) || '').toUpperCase();
                const title =
                    blocked === 'TABLE_DELETED' ? 'Table Unavailable' :
                    blocked === 'TABLE_MAINTENANCE' ? 'Table Under Maintenance' :
                    blocked === 'GEOFENCE' ? "We couldn't verify your location" :
                    blocked === 'PAYMENT_METHOD' ? 'Payment Method Needed' :
                    blocked === 'CUSTOMER_NAME' ? 'Name Needed' :
                    'Order Not Accepted';
                await Swal.fire({
                    icon: 'error',
                    title: title,
                    text: (result && result.message) || 'Your order could not be accepted. Please try again.',
                    confirmButtonText: 'OK',
                    confirmButtonColor: '#FFB800'
                });
                placeOrderBtn.innerText = "Proceed to Payment";
                placeOrderBtn.disabled = false;
            };

            // ── AUTH BACKEND REJECTION FIRST (P0) ──
            // place_order.php is authoritative: a deleted/maintenance
            // table, a missing payment method, or a failed geofence
            // arrives as { success:false, blocked:'...', message }.
            const isAuthBlocked = (result) => (!result.success && !result.unavailable && !result.duplicate);

            if (selectedPayment === 'GCASH') {
                try {
                    placeOrderBtn.innerText = "Creating Order...";
                    placeOrderBtn.disabled = true;

                    const checkoutData = {
                        table_id: savedTableId ? Number(savedTableId) : null,
                        order_type: currentOrderType,
                        // The GCASH branch only runs when the radio IS selected.
                        payment_method: 'GCASH',
                        customer_name: localStorage.getItem('customerName') || null,
                        total_amount: totalAmount,
                        cart: finalCartItems,
                        geofence: geofence
                    };

                    const response = await fetch('place_order.php', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(checkoutData)
                    });

                    const result = await response.json();

                    // ── AUTH BACKEND REJECTION FIRST (P0) ──
                    if (isAuthBlocked(result)) {
                        await showBlockedOrderError(result);
                        return;
                    }

                    if (result.unavailable && result.unavailable.length > 0) {
                        const list = result.unavailable.map(n => '• ' + n).join('<br>');
                        await Swal.fire({
                            icon: 'warning',
                            title: 'Some items are unavailable',
                            html: list + '<br><br>Please remove or replace them, then check out again.',
                            confirmButtonColor: '#FFB800'
                        });
                        placeOrderBtn.innerText = "Proceed to Payment";
                        placeOrderBtn.disabled = false;
                        return;
                    }

                    if (result.duplicate) {
                        localStorage.setItem('lastOrderID', result.order_id);
                        localStorage.setItem('lastRefNumber', result.reference_number);
                        localStorage.setItem('payment_method', 'GCASH');
                        if (result.created_epoch) localStorage.setItem('lastOrderEpoch', result.created_epoch);
                        if (window.HOFDevice) {
                            HOFDevice.addOrder({
                                order_id: result.order_id, ref: result.reference_number,
                                status: 'PENDING', paid: false,
                                table_number: localStorage.getItem('currentTableNumber') || null,
                                created_at: new Date().toISOString()
                            });
                        }
                        try {
                          const rebuiltTotal = await rebuildCartFromOrder(result.order_id);
                          Swal.fire({ icon: 'info', title: 'Continuing Order', text: result.message, confirmButtonColor: '#FFB800' });
                          window.location.href = 'checkout.html';
                        } catch (e) {
                          alert('Failed to load order items: ' + e.message);
                          placeOrderBtn.innerText = "Proceed to Payment";
                          placeOrderBtn.disabled = false;
                        }
                        return;
                    }

                    if (result.success) {
                        localStorage.setItem('lastOrderID', result.order_id);
                        localStorage.setItem('lastRefNumber', result.reference_number);
                        localStorage.setItem('payment_method', 'GCASH');
                        if (result.created_epoch) localStorage.setItem('lastOrderEpoch', result.created_epoch);
                        if (window.HOFDevice) {
                            HOFDevice.addOrder({
                                order_id: result.order_id, ref: result.reference_number,
                                status: 'PENDING', paid: false,
                                table_number: localStorage.getItem('currentTableNumber') || null,
                                created_at: new Date().toISOString()
                            });
                        }
                        window.location.href = 'checkout.html';
                    } else {
                        throw new Error(result.message || 'Failed to create order');
                    }
                } catch (err) {
                    console.error("Order creation error:", err);
                    alert("Failed to create order: " + err.message);
                    placeOrderBtn.innerText = "Proceed to Payment";
                    placeOrderBtn.disabled = false;
                }
                return;
            }

            const checkoutData = {
                table_id: savedTableId ? Number(savedTableId) : null,
                order_type: currentOrderType, // Pass the dynamic configuration state string
                // The required payment method travels with the order.
                // The backend re-validates it; an absent radio can never mean "Cash".
                payment_method: selectedPayment,
                customer_name: localStorage.getItem('customerName') || null,
                total_amount: totalAmount,
                cart: finalCartItems,
                geofence: geofence
            };

            try {
                placeOrderBtn.innerText = "Processing...";
                placeOrderBtn.disabled = true;

                const response = await fetch('place_order.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(checkoutData)
                });

                const result = await response.json();

                // ── AUTH BACKEND REJECTION (P0) ──
                if (isAuthBlocked(result)) {
                    await showBlockedOrderError(result);
                    return;
                }

                if (result.unavailable && result.unavailable.length > 0) {
                    const list = result.unavailable.map(n => '• ' + n).join('<br>');
                    await Swal.fire({
                        icon: 'warning',
                        title: 'Some items are unavailable',
                        html: list + '<br><br>Please remove or replace them, then check out again.',
                        confirmButtonColor: '#FFB800'
                    });
                    placeOrderBtn.innerText = "Proceed to Payment";
                    placeOrderBtn.disabled = false;
                    return;
                }

                if (result.duplicate) {
                    localStorage.setItem('lastOrderID', result.order_id);
                    localStorage.setItem('lastRefNumber', result.reference_number);
                    localStorage.setItem('payment_method', selectedPayment);
                    if (result.created_epoch) localStorage.setItem('lastOrderEpoch', result.created_epoch);
                    if (window.HOFDevice) {
                        HOFDevice.addOrder({
                            order_id: result.order_id, ref: result.reference_number,
                            status: 'PENDING', paid: false,
                            table_number: localStorage.getItem('currentTableNumber') || null,
                            created_at: new Date().toISOString()
                        });
                    }
                    try {
                      await rebuildCartFromOrder(result.order_id);
                      Swal.fire({ icon: 'info', title: 'Continuing Order', text: result.message, confirmButtonColor: '#FFB800' });
                      window.location.href = 'checkout.html';
                    } catch (e) {
                      alert('Failed to load order items: ' + e.message);
                      placeOrderBtn.innerText = "Proceed to Payment";
                      placeOrderBtn.disabled = false;
                    }
                    return;
                }

                if (result.success) {
                    localStorage.setItem('lastOrderID', result.order_id);
                    localStorage.setItem('lastRefNumber', result.reference_number);
                    localStorage.setItem('payment_method', selectedPayment);
                    if (result.created_epoch) localStorage.setItem('lastOrderEpoch', result.created_epoch);
                    if (window.HOFDevice) {
                        HOFDevice.addOrder({
                            order_id: result.order_id, ref: result.reference_number,
                            status: 'PENDING', paid: false,
                            table_number: localStorage.getItem('currentTableNumber') || null,
                            created_at: new Date().toISOString()
                        });
                    }
                    window.location.href = 'checkout.html';
                } else {
                    // Any remaining server refusal shows the server's message
                    // instead of a raw dump, and leaves the button usable.
                    await Swal.fire({
                        icon: 'error',
                        title: 'Order Not Accepted',
                        text: result.message || 'Your order could not be accepted. Please try again.',
                        confirmButtonText: 'OK',
                        confirmButtonColor: '#FFB800'
                    });
                }
            } catch (err) {
                console.error("Fetch error:", err);
                alert("Check server connection.");
            } finally {
                placeOrderBtn.innerText = "Proceed to Payment";
                placeOrderBtn.disabled = false;
            }
        });
    }
}