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
    setupCartNavigation();
    setupSwipeGestures(); // Initialize gesture listener bindings
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
function renderCart() {
    const rawCart = JSON.parse(localStorage.getItem('cart')) || [];

    const groupedCart = rawCart.reduce((acc, item) => {
        if (!acc[item.menu_item_id]) {
            acc[item.menu_item_id] = { ...item, quantity: 1 };
        } else {
            acc[item.menu_item_id].quantity += 1;
            const inc = (item.special_instructions || '').trim();
            if (inc) {
                const cur = (acc[item.menu_item_id].special_instructions || '').trim();
                acc[item.menu_item_id].special_instructions = cur ? cur + '; ' + inc : inc;
            }
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

        // Special instructions — compact control. When the line has no
        // instruction, we show a small "+ Add Instruction" button instead of
        // a large empty textarea. (Uses the shared window.* helpers below.)
        const specialInstructions = (item.special_instructions || '').trim();
        const safeInstr = escapeHtmlAttr(specialInstructions);
        const instrHtml = `
            <div class="instr-wrap" id="instr-${item.menu_item_id}">
                <div class="instr-view" style="${specialInstructions ? '' : 'display:none;'}">
                    <div class="instr-saved">${escapeHtmlAttr(specialInstructions) || '<span class="text-muted">No instruction</span>'}</div>
                    <div class="instr-actions">
                        <button type="button" class="instr-btn" onclick="toggleInstructionEditor(${item.menu_item_id}, true)">Edit</button>
                        <button type="button" class="instr-btn instr-btn-danger" onclick="removeInstruction(${item.menu_item_id})">Remove</button>
                    </div>
                </div>
                <div class="instr-edit" style="${specialInstructions ? 'display:none;' : ''}">
                    <button type="button" class="instr-add-btn" onclick="toggleInstructionEditor(${item.menu_item_id}, true)">+ Add Instruction</button>
                    <div class="instr-editor" style="display:none;">
                        <textarea class="special-instructions-input" placeholder="e.g., less spicy, no sauce, extra cheese" data-menu-item-id="${item.menu_item_id}" oninput="updateSpecialInstructions(this)">${safeInstr}</textarea>
                        <div class="instr-actions">
                            <button type="button" class="instr-btn instr-btn-primary" onclick="saveInstruction(${item.menu_item_id})">Save</button>
                            <button type="button" class="instr-btn" onclick="toggleInstructionEditor(${item.menu_item_id}, false)">Cancel</button>
                        </div>
                    </div>
                </div>
            </div>`;

        // Double-nested DOM layout architecture matching touch swiping expectations
        const card = `
            <div class="swipe-item-wrapper" id="wrapper-${item.menu_item_id}">
                <div class="swipe-delete-action" onclick="removeItem(${item.menu_item_id})">
                    <i class="fa-solid fa-trash-can"></i>
                </div>
                <div class="cart-item-content">
                <img src="${imageSrc}" alt="${item.item_name}" onerror="this.style.display='none';">
                    <div class="item-details">
                        <div>
                            <h3>${item.item_name}</h3>
                            <p>${item.description || 'Delicious side or entry option.'}</p>
                        </div>
                        ${instrHtml}
                        <div class="item-price-tag">₱ ${(parseFloat(item.price)).toFixed(2)}</div>
                    </div>
                    <div class="cart-controls">
                        <button class="btn-ctrl minus" ${minusStyle} onclick="changeQty(${item.menu_item_id}, -1, event)">-</button>
                        <div class="qty-label">${item.quantity}</div>
                        <button class="btn-ctrl plus" onclick="changeQty(${item.menu_item_id}, 1, event)">+</button>
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
window.changeQty = function (id, delta, event) {
    if (event) event.stopPropagation();

    let cart = JSON.parse(localStorage.getItem('cart')) || [];
    if (delta === 1) {
        const originalItem = cart.find(i => i.menu_item_id == id);
        if (originalItem) {
            cart.push({ ...originalItem });
        }
    } else {
        const currentQty = cart.filter(i => i.menu_item_id == id).length;
        if (currentQty > 1) {
            const index = cart.findIndex(i => i.menu_item_id == id);
            if (index > -1) cart.splice(index, 1);
        } else {
            return;
        }
    }
    localStorage.setItem('cart', JSON.stringify(cart));
    renderCart();
};

window.removeItem = function (id) {
    let cart = JSON.parse(localStorage.getItem('cart')) || [];
    cart = cart.filter(i => i.menu_item_id != id);
    localStorage.setItem('cart', JSON.stringify(cart));
    renderCart();
};

// --- Compact special-instructions control ("+ Add Instruction") ---
// Per line we render ONE of:
//   (a) no instructions   -> a small "+ Add Instruction" button
//   (b) has instructions  -> the saved text + Edit / Remove buttons
//   (c) editing           -> textarea + Save / Cancel
function escapeHtmlAttr(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Update special instructions in localStorage (live textarea, unchanged behavior)
window.updateSpecialInstructions = function (textarea) {
    const menuItemId = parseInt(textarea.dataset.menuItemId);
    const newInstructions = textarea.value.trim();

    let cart = JSON.parse(localStorage.getItem('cart')) || [];
    const itemIndex = cart.findIndex(i => i.menu_item_id === menuItemId);

    if (itemIndex !== -1) {
        cart[itemIndex].special_instructions = newInstructions;
        localStorage.setItem('cart', JSON.stringify(cart));
    }
};

// --- Compact "+ Add Instruction" toggle ---
// item wrapper id = `instr-<menu_item_id>` (rendered by renderCart)
window.toggleInstructionEditor = function (menuItemId, show) {
    const wrap = document.getElementById('instr-' + menuItemId);
    if (!wrap) return;
    const view = wrap.querySelector('.instr-view');
    const edit = wrap.querySelector('.instr-edit');
    if (!view || !edit) return;
    view.style.display = show ? 'none' : '';
    edit.style.display = show ? '' : 'none';
    // The editor body starts collapsed next to the "+ Add Instruction" label;
    // reveal or hide it together with the editor pane.
    const editorBody = edit.querySelector('.instr-editor');
    if (editorBody) editorBody.style.display = show ? '' : 'none';
    if (show) {
        const ta = edit.querySelector('textarea');
        if (ta) ta.focus();
    }
};

// Persist the text typed into the inline editor, then re-render.
window.saveInstruction = function (menuItemId) {
    const wrap = document.getElementById('instr-' + menuItemId);
    if (!wrap) return;
    const ta = wrap.querySelector('textarea');
    const text = ta ? ta.value.trim() : '';

    let cart = JSON.parse(localStorage.getItem('cart')) || [];
    const itemIndex = cart.findIndex(i => i.menu_item_id === menuItemId);
    if (itemIndex !== -1) {
        cart[itemIndex].special_instructions = text;
        localStorage.setItem('cart', JSON.stringify(cart));
    }
    renderCart();
};

// Clear the instruction and collapse the editor.
window.cancelInstruction = function (menuItemId) {
    window.toggleInstructionEditor(menuItemId, false);
};

window.removeInstruction = function (menuItemId) {
    let cart = JSON.parse(localStorage.getItem('cart')) || [];
    const itemIndex = cart.findIndex(i => i.menu_item_id === menuItemId);
    if (itemIndex !== -1) {
        cart[itemIndex].special_instructions = '';
        localStorage.setItem('cart', JSON.stringify(cart));
    }
    renderCart();
};

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
      const resp = await fetch('/backend/payments/get-payment-link.php', {
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
    const id = item.menu_item_id;
    if (!acc[id]) { acc[id] = { menu_item_id: id, price: parseFloat(item.price), quantity: 1, special_instructions: item.special_instructions || '' }; }
    else {
      acc[id].quantity += 1;
      const inc = (item.special_instructions || '').trim();
      if (inc) {
        const cur = (acc[id].special_instructions || '').trim();
        acc[id].special_instructions = cur ? cur + '; ' + inc : inc;
      }
    }
    return acc;
  }, {});
  return Object.values(grouped).reduce((sum, i) => sum + (i.price * i.quantity), 0);
}

function setupCartNavigation() {
    const placeOrderBtn = document.getElementById('placeOrderBtn');

    if (placeOrderBtn) {
        placeOrderBtn.addEventListener('click', async () => {
            const rawCart = JSON.parse(localStorage.getItem('cart')) || [];

            if (rawCart.length === 0) {
                alert("Your cart is empty!");
                return;
            }

            const grouped = rawCart.reduce((acc, item) => {
                const id = item.menu_item_id;
                if (!acc[id]) {
                    acc[id] = {
                        menu_item_id: id,
                        price: parseFloat(item.price),
                        quantity: 1,
                        special_instructions: item.special_instructions || ''
                    };
                } else {
                    acc[id].quantity += 1;
                    const inc = (item.special_instructions || '').trim();
                    if (inc) {
                        const cur = (acc[id].special_instructions || '').trim();
                        acc[id].special_instructions = cur ? cur + '; ' + inc : inc;
                    }
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
                    const updateResp = await fetch('update_existing_order.php', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            order_id: parseInt(editOrderId),
                            reference_number: editRefNumber,
                            items: finalCartItems
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
                        if (selectedPayment === 'GCASH') {
                            try {
                                const deviceId = (window.HOFDevice ? HOFDevice.id() : '');
                                const linkResp = await fetch('/backend/payments/get-payment-link.php', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ order_id: editOrderId, ref: editRefNumber, purpose: 'pay', device_id: deviceId })
                                });
                                const linkData = await linkResp.json();
                                if (linkData.success && linkData.signed_url) {
                                    window.location.href = linkData.signed_url;
                                } else {
                                    throw new Error(linkData.message || 'Could not generate payment link');
                                }
                            } catch (e) {
                                alert('Failed to create payment link: ' + e.message);
                            }
                        } else {
                            window.location.href = 'checkout.html';
                        }
                        return;
                    }
                    localStorage.removeItem('editOrderId');
                    localStorage.removeItem('editRefNumber');
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
                          const devIdDup = (window.HOFDevice ? HOFDevice.id() : '');
                          const linkRespDup = await fetch('/backend/payments/get-payment-link.php', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ order_id: result.order_id, ref: result.reference_number, purpose: 'pay', device_id: devIdDup })
                          });
                          const linkDataDup = await linkRespDup.json();
                          if (linkDataDup.success && linkDataDup.signed_url) {
                              window.location.href = linkDataDup.signed_url;
                          } else {
                              throw new Error(linkDataDup.message || 'Could not generate payment link');
                          }
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
                            const devIdNew = (window.HOFDevice ? HOFDevice.id() : '');
                            const linkRespNew = await fetch('/backend/payments/get-payment-link.php', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ order_id: result.order_id, ref: result.reference_number, purpose: 'pay', device_id: devIdNew })
                            });
                            const linkDataNew = await linkRespNew.json();
                            if (linkDataNew.success && linkDataNew.signed_url) {
                                window.location.href = linkDataNew.signed_url;
                            } else {
                                throw new Error(linkDataNew.message || 'Could not generate payment link');
                            }
                        } catch (e) {
                            alert('Failed to create payment link: ' + e.message);
                            placeOrderBtn.innerText = "Proceed to Payment";
                            placeOrderBtn.disabled = false;
                        }
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