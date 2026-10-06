// ── HTML escaping helpers ──
// Cashier order cards now render customer names + reference numbers coming
// from the database. These MUST be escaped before interpolation to avoid
// breaking the DOM (or injecting markup).
function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
    return escapeHtml(value);
}

// Initialize Pusher
const pusher = new Pusher('a8860aca373dcc3400ce', {
    cluster: 'ap1',
    // REQ-064: protocol-matched transport (kitchenUI.js pattern).
    forceTLS: (window.location.protocol === 'https:')
});

// Subscribe to the order channel
const channel = pusher.subscribe('hof-orders');

// Listen for the update event
channel.bind('new-order', function (data) {
    console.log('Order update received:', data.message);
    loadPendingOrders();

    // If the cashier is viewing the specific updated order, refresh details
    if (activeOrderId && data.order_id == activeOrderId) {
        fetchOrderDetails(activeOrderId);
    }
});

channel.bind('order-status-changed', function (data) {
    console.log('Order status changed:', data);
    loadPendingOrders();
    if (activeOrderId && data.order_id == activeOrderId) {
        fetchOrderDetails(activeOrderId);
    }
});

// Global state to track the selected order across auto-refreshes
let activeOrderId = null;
let isVoidMode = false; // Track if void selection mode is active
let currentTableFilter = "all";
let currentInput = "";
let isAmountConfirmed = false;
let confirmedCash = 0;
// The order total the cashier was looking at when they pressed ENTER.
// Used only to explain a mid-payment price change; never used to compute money.
let confirmedUiTotal = 0;

// Global tracking for bulk void selection
let selectedVoidItemIds = new Set();

// REQ-049: tracks whether the active order currently has a discount applied.
let activeOrderHasDiscount = false;

/**
 * GCASH AUTO-VERIFY
 * While the cashier dashboard is open, poll for QR/web orders whose GCash
 * payment is awaiting confirmation and verify them WITH this cashier's
 * token — so the sale is recorded under whoever is logged in at that time.
 */
function verifyPendingGcashOrders() {
    const token = localStorage.getItem('hof_token');
    if (!token) return;

    fetch('/backend/cashier/get_pending_gcash_orders.php')
        .then(r => r.json())
        .then(data => {
            if (!data.success || !data.orders || data.orders.length === 0) return;
            data.orders.forEach(order => {
                fetch(`/backend/payments/check-payment-status.php?order_id=${order.order_id}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                })
                    .then(r => r.json())
                    .then(res => {
                        if (res.success && res.paid) {
                            loadPendingOrders();
                            if (typeof HOFNavbar !== 'undefined' && HOFNavbar.refreshNotifications) {
                                HOFNavbar.refreshNotifications();
                            }
                        }
                    })
                    .catch(() => { /* network hiccup - retry next cycle */ });
            });
        })
        .catch(() => { /* silent */ });
}
setInterval(verifyPendingGcashOrders, 15000);
setTimeout(verifyPendingGcashOrders, 3000);

// Polling fallback for pending orders every 10s
setInterval(() => {
    if (!document.hidden) loadPendingOrders();
}, 10000);

// --- FUNCTION DEFINITIONS (Declared first so DOMContentLoaded can safely call them) ---

function resetOrderSummaryUI() {
    isAmountConfirmed = false;
    confirmedCash = 0;
    confirmedUiTotal = 0;
    currentInput = "";
    activeOrderHasDiscount = false;

    const displayEl = document.querySelector('.input-display');
    if (displayEl) displayEl.innerText = "₱0.00";

    const orderIdEl = document.getElementById('current-order-id');
    if (orderIdEl) orderIdEl.innerText = '#-----';

    const container = document.getElementById('order-items-container');
    if (container) {
        container.innerHTML = `
            <tr><td colspan="4" class="text-center text-muted py-5">Select an order or start an OTC ticket to view details</td></tr>
        `;
    }
    const subEl = document.getElementById('summary-subtotal');
    const discountEl = document.getElementById('summary-discount');
    const totalEl = document.getElementById('summary-total');
    if (subEl) subEl.innerText = '₱0.00';
    if (discountEl) discountEl.innerText = '₱0.00';
    if (totalEl) totalEl.innerText = '₱0.00';
    const discountBtn = document.getElementById('discount-toggle-btn');
    if (discountBtn) discountBtn.innerText = 'DISCOUNT';
}

function updateDisplay() {
    const inputDisplay = document.querySelector('.input-display');
    if (!inputDisplay) return;
    inputDisplay.innerText = currentInput ? `₱${parseFloat(currentInput).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "₱0.00";
}

function loadCategories() {
    const catSelect = document.querySelector('.cat-select');
    fetch('/backend/cashier/get_categories.php')
        .then(res => res.json())
        .then(data => {
            if (data.success && catSelect) {
                catSelect.innerHTML = '<option value="all">ALL CATEGORIES</option>';
                data.categories.forEach(cat => {
                    catSelect.innerHTML += `<option value="${cat.category_id}">${cat.category_name}</option>`;
                });
            }
        });
}

function loadItems(catId = 'all') {
    const itemGrid = document.querySelector('.cat-grid');
    fetch(`/backend/cashier/get_items_by_category.php?category_id=${catId}`)
        .then(res => res.json())
        .then(data => {
            if (data.success && itemGrid) {
                itemGrid.innerHTML = '';
                data.items.forEach(item => {
                    const btn = document.createElement('button');
                    btn.className = 'cat-btn';
                    btn.innerText = item.item_name;
                    btn.onclick = () => openItemPopup(item);
                    itemGrid.appendChild(btn);
                });
            }
        });
}

function loadPendingOrders() {
    const listContainer = document.getElementById('pending-list-container');
    const badge = document.getElementById('pending-count');
    const searchEl = document.getElementById('otcOrderSearch');
    const searchTerm = (searchEl ? searchEl.value : '').trim().toLowerCase();

    fetch(`/backend/cashier/get_pending_orders.php?filter=${currentTableFilter}`)
        .then(response => {
            if (!response.ok) throw new Error(`Server returned ${response.status}`);
            return response.json();
        })
        .then(data => {
            if (data.success && listContainer) {
                let orders = data.orders || [];

                // ── OTC OPERATIONAL SEARCH (#45) ──
                // Filters locally on order ref / customer name / table label,
                // so the cashier can locate a ticket as they type.
                if (searchTerm) {
                    orders = orders.filter(o => {
                        const ref = String(o.reference_number || o.order_id || '').toLowerCase();
                        const cust = String(o.customer_name || '').toLowerCase();
                        const tbl = String(o.table_number || '').toLowerCase();
                        return ref.includes(searchTerm) || cust.includes(searchTerm) || tbl.includes(searchTerm);
                    });
                }

                if (badge) badge.innerText = data.count;
                listContainer.innerHTML = '';

                if (orders.length === 0) {
                    listContainer.innerHTML = searchTerm
                        ? '<p class="text-center text-muted mt-3">No pending order matches that search.</p>'
                        : '<p class="text-center text-muted mt-3">No matching orders found</p>';
                    return;
                }

                orders.forEach(order => {
                    // --- TIMEZONE FIX APPLIED HERE ---
                    const formattedString = order.created_at.replace(' ', 'T');
                    const orderTime = new Date(formattedString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    
                    const isDineIn = order.order_type === 'DINE_IN';
                    const typeLabel = isDineIn
                        ? `Dine-In | Table ${order.table_number || '?'}`
                        : `Take-Out${order.table_number ? ' / ' + order.table_number : ''}`;

                    // Customer name is shown on the card so the cashier does not
                    // have to open the order to identify it.
                    const customerName = (order.customer_name || '').trim();
                    const customerHtml = customerName
                        ? `<small class="d-block order-card-customer" title="${escapeAttr(customerName)}">${escapeHtml(customerName)}</small>`
                        : '';

                    const cardHtml = `
                        <div class="order-card ${activeOrderId == order.order_id ? 'active' : 'inactive'}" data-id="${order.order_id}" data-status="${order.status}">
                            <div class="mb-1">
                                <h3 class="mb-0 fw-bold text-truncate" title="#${escapeAttr(order.reference_number || order.order_id)}">#${escapeHtml(order.reference_number || order.order_id)}</h3>
                                ${customerHtml}
                                <small class="text-muted d-block order-card-meta">
                                    ${typeLabel}
                                </small>
                            </div>
                            <div class="d-flex justify-content-between mt-2">
                                <small>${orderTime}</small>
                                <small class="fw-bold">₱${parseFloat(order.total_amount).toFixed(2)}</small>
                            </div>
                            <div class="mt-2 d-flex gap-2">
                            </div>
                        </div>`;
                    listContainer.innerHTML += cardHtml;
                });

                updateActiveCardUI();
            }
        })
        .catch(error => {
            console.error("Error loading orders:", error);
        });
}

function updateActiveCardUI() {
    document.querySelectorAll('.order-card').forEach(c => {
        if (c.getAttribute('data-id') == activeOrderId) {
            c.classList.add('active');
            c.classList.remove('inactive');
        } else {
            c.classList.remove('active');
            c.classList.add('inactive');
        }
    });
}

function fetchOrderDetails(id) {
    const container = document.getElementById('order-items-container');
    if (!container) return;

    container.innerHTML = '<tr><td colspan="4" class="text-center">Loading...</td></tr>';

    fetch(`/backend/cashier/get_order_details.php?order_id=${id}`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                const orderIdEl = document.getElementById('current-order-id');
                if (orderIdEl) orderIdEl.innerText = '#' + (data.order_info.reference_number || id);

                container.innerHTML = '';

                if (data.items.length === 0) {
                    container.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-5">No items in this order yet. Click menu items to add.</td></tr>';
                } else {
                    data.items.forEach(item => {
                        const isMinusDisabled = item.quantity <= 1 ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : '';
                        const voidControlsDisplay = isVoidMode ? 'inline-block' : 'none';
                        const isChecked = selectedVoidItemIds.has(item.order_item_id) ? 'checked' : '';

                        const row = `
                        <tr>
                            <td class="fs-5">
                                <input type="checkbox" class="form-check-input void-checkbox me-2" style="display: ${voidControlsDisplay}; width: 20px; height: 20px; vertical-align: middle;" value="${item.order_item_id}" ${isChecked} onchange="toggleItemSelection('${item.order_item_id}')">
                                ${escapeHtml(item.item_name)}
                                ${(item.special_instructions || '').trim()
                                    ? `<div class="small text-muted fw-normal">${escapeHtml(item.special_instructions)}</div>`
                                    : ''}
                            </td>
                            <td class="text-center fw-bold fs-5">${item.quantity}</td>
                            <td class="text-center fw-bold fs-5">₱${parseFloat(item.price).toFixed(2)}</td>
                            <td class="text-center">
                                <button class="qty-btn add-btn" onclick="updateQty(event, '${id}', '${item.order_item_id}', 'add')">+</button>
                                <button class="qty-btn sub-btn" ${isMinusDisabled} onclick="updateQty(event, '${id}', '${item.order_item_id}', 'sub')">-</button>
                                
                                <button class="btn btn-link text-danger void-icon-btn ms-2" 
                                        style="display: ${voidControlsDisplay}; border: none; text-decoration: none;" 
                                        onclick="confirmSingleVoid('${id}', '${item.order_item_id}', '${item.item_name}')">
                                    <i class="fa-solid fa-trash"></i>
                                </button>
                            </td>
                        </tr>`;
                        container.innerHTML += row;
                    });
                }

                // REQ-049: subtotal stays GROSS, discount shows -₱, total shows NET.
                const subtotal = parseFloat(data.order_info.subtotal_amount ?? data.order_info.total_amount).toFixed(2);
                const discountAmount = data.order_info.discount_amount != null
                    ? parseFloat(data.order_info.discount_amount).toFixed(2)
                    : null;
                const total = parseFloat(data.order_info.total_amount).toFixed(2);

                const subEl = document.getElementById('summary-subtotal');
                const discountEl = document.getElementById('summary-discount');
                const totalEl = document.getElementById('summary-total');
                const discountBtn = document.getElementById('discount-toggle-btn');
                if (subEl) subEl.innerText = `₱${subtotal}`;
                if (discountEl) discountEl.innerText = discountAmount != null ? `-₱${discountAmount}` : '₱0.00';
                if (totalEl) totalEl.innerText = `₱${total}`;

                activeOrderHasDiscount = discountAmount != null;
                if (discountBtn) {
                    discountBtn.innerText = activeOrderHasDiscount ? 'REMOVE DISCOUNT' : 'DISCOUNT';
                }
            }
        });
}

function updateQty(e, orderId, orderItemId, action) {
    const btn = e.target;
    const row = btn.closest('tr');
    if (!row) return;

    const currentQty = parseInt(row.cells[1].innerText);
    if (action === 'sub' && currentQty <= 1) return;

    fetch('/backend/cashier/update_item_quantity.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: orderId, order_item_id: orderItemId, action: action })
    })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                fetchOrderDetails(orderId);
                loadPendingOrders();
            } else {
                Swal.fire('Error', data.message, 'error');
            }
        });
}

function openItemPopup(item) {
    if (typeof window.HOFChoicePopup === 'undefined') {
        Swal.fire('Missing Component', 'The choice popup is not loaded on this page.', 'error');
        return;
    }
    window.HOFChoicePopup.open({
        item: {
            menu_item_id: item.menu_item_id,
            item_name: item.item_name,
            description: item.description,
            price: item.price,
            choices: item.choices || [],
            addons: item.addons || []
        },
        onConfirm: (line) => {
            addItemToCurrentOrder(item, line);
        }
    });
}

function addItemToCurrentOrder(item, line) {
    if (!activeOrderId) {
        Swal.fire('Wait!', 'Please select an order from the left panel first.', 'info');
        return;
    }

    const payload = {
        order_id: activeOrderId,
        menu_item_id: item.menu_item_id,
        price: (line && Number(line.price)) || item.price,
        quantity: (line && Number(line.quantity)) || 1,
        choices: (line && Array.isArray(line.choices)) ? line.choices : [],
        addons: (line && Array.isArray(line.addons)) ? line.addons : [],
        special_instructions: (line && line.special_instructions) || '',
        configured: !!(line && line.configured)
    };

    fetch('/backend/cashier/add_item_to_order.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                fetchOrderDetails(activeOrderId);
                loadPendingOrders();
            } else {
                Swal.fire('Error', data.message, 'error');
            }
        });
}

function toggleVoidMode() {
    isVoidMode = !isVoidMode;
    selectedVoidItemIds.clear(); // Reset selections when toggling

    const trashIcons = document.querySelectorAll('.void-icon-btn');
    const checkboxes = document.querySelectorAll('.void-checkbox');
    const voidBtn = document.getElementById('void-toggle-btn');

    trashIcons.forEach(icon => {
        icon.style.display = isVoidMode ? 'inline-block' : 'none';
    });

    checkboxes.forEach(cb => {
        cb.style.display = isVoidMode ? 'inline-block' : 'none';
        cb.checked = false;
    });

    if (voidBtn) {
        if (isVoidMode) {
            voidBtn.style.backgroundColor = '#d33';
            voidBtn.style.color = 'white';
            voidBtn.innerHTML = '<i class="fa-solid fa-check"></i> Void Selected (<span id="selected-void-count">0</span>)';
            voidBtn.onclick = () => {
                if (selectedVoidItemIds.size === 0) {
                    toggleVoidMode();
                } else {
                    confirmBulkVoid(activeOrderId);
                }
            };
        } else {
            voidBtn.style.backgroundColor = '';
            voidBtn.style.color = '';
            voidBtn.innerHTML = '<i class="fa-solid fa-ban"></i> Void Mode';
            voidBtn.onclick = toggleVoidMode;
        }
    }
}

function toggleItemSelection(orderItemId) {
    if (selectedVoidItemIds.has(orderItemId)) {
        selectedVoidItemIds.delete(orderItemId);
    } else {
        selectedVoidItemIds.add(orderItemId);
    }
    const countSpan = document.getElementById('selected-void-count');
    if (countSpan) countSpan.innerText = selectedVoidItemIds.size;
}

function confirmSingleVoid(orderId, orderItemId, itemName) {
    selectedVoidItemIds.clear();
    selectedVoidItemIds.add(orderItemId);

    const refNumText = document.getElementById('current-order-id')?.innerText || `#${orderId}`;
    showVoidAuthModal(orderId, `Remove &quot;${itemName}&quot; from Order ${refNumText}?`);
}

function confirmBulkVoid(orderId) {
    if (!orderId) {
        Swal.fire('Error', 'Please select an active order first.', 'error');
        return;
    }
    if (selectedVoidItemIds.size === 0) {
        toggleVoidMode();
        return;
    }

    const refNumText = document.getElementById('current-order-id')?.innerText || `#${orderId}`;
    showVoidAuthModal(orderId, `Void ${selectedVoidItemIds.size} selected item(s) from Order ${refNumText}?`);
}

function showVoidAuthModal(orderId, message) {
    Swal.fire({
        title: 'Admin/Supervisor Authorization Required',
        html: `
            <div class="text-start">
                <p class="text-muted mb-3">${message}</p>
                <div class="mb-3">
                    <label class="form-label fw-bold">Void Reason:</label>
                    <select id="swal-void-reason" class="form-select">
                        <option value="Customer changed mind">Customer changed mind</option>
                        <option value="Wrong item entered">Wrong item entered</option>
                        <option value="Kitchen delay / Out of stock">Kitchen delay / Out of stock</option>
                        <option value="Duplicate entry">Duplicate entry</option>
                        <option value="Customer request">Customer request</option>
                    </select>
                </div>
                <div class="mb-3">
                    <label class="form-label fw-bold">Authorizer Username:</label>
                    <input type="text" id="swal-auth-user" class="form-control" placeholder="Admin or Supervisor username">
                </div>
                <div class="mb-3">
                    <label class="form-label fw-bold">Password:</label>
                    <input type="password" id="swal-auth-pass" class="form-control" placeholder="Enter password">
                </div>
            </div>
        `,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Authorize & Void',
        preConfirm: () => {
            const reason = document.getElementById('swal-void-reason').value;
            const username = document.getElementById('swal-auth-user').value.trim();
            const password = document.getElementById('swal-auth-pass').value;

            if (!username || !password) {
                Swal.showValidationMessage('Please enter both authorizer username and password.');
                return false;
            }
            return { reason, username, password };
        }
    }).then((result) => {
        if (result.isConfirmed) {
            executeVoid(orderId, result.value);
        }
    });
}

function executeVoid(orderId, authData) {
    const itemIdsArray = Array.from(selectedVoidItemIds);
    const token = localStorage.getItem('hof_token');

    Swal.showLoading();

    fetch('/backend/cashier/void_order_items.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            order_id: orderId,
            order_item_ids: itemIdsArray,
            reason: authData.reason,
            authorizer_username: authData.username,
            authorizer_password: authData.password,
            token: token
        })
    })
        .then(res => res.json())
        .then(data => {
            Swal.close();
            if (data.success) {
                Swal.fire({
                    icon: 'success',
                    title: 'Voided!',
                    text: data.message || 'Items have been successfully voided.',
                    timer: 2000,
                    showConfirmButton: false
                });
                selectedVoidItemIds.clear();
                if (isVoidMode) toggleVoidMode();
                fetchOrderDetails(orderId);
                loadPendingOrders();
            } else {
                Swal.fire('Authorization Failed', data.message, 'error');
            }
        })
        .catch(err => {
            Swal.close();
            console.error("Void processing error:", err);
            Swal.fire('Error', 'An unexpected error occurred while processing the void.', 'error');
        });
}

// ============================================================
// REQ-049 — COUNTER DISCOUNT (Senior / PWD)
// ============================================================
// The cashier clicks DISCOUNT (or REMOVE DISCOUNT when already applied).
// Applying or removing a discount always requires Admin/Supervisor
// credentials ON THE SPOT — the exact VOID authorization flow.
function handleDiscountClick() {
    if (!activeOrderId) {
        Swal.fire('Error', 'Please select an order first.', 'error');
        return;
    }

    if (activeOrderHasDiscount) {
        showDiscountAuthModal(activeOrderId, 'Remove the discount from this order?', 'remove');
    } else {
        loadActiveDiscountTypes().then(types => {
            if (!types || types.length === 0) {
                Swal.fire('No Discount Types', 'No active discount types found. Ask an Admin to add one in Settings.', 'info');
                return;
            }
            showDiscountAuthModal(activeOrderId, 'Apply a discount to this order?', 'apply', types);
        });
    }
}

function loadActiveDiscountTypes() {
    return fetch('/backend/cashier/get_discount_types.php')
        .then(res => res.json())
        .then(data => {
            if (!data.success) throw new Error(data.message || 'Could not load discount types.');
            return data.types || [];
        })
        .catch(err => {
            console.error('Error loading discount types:', err);
            Swal.fire('Error', err.message || 'Could not load discount types.', 'error');
            return [];
        });
}

function showDiscountAuthModal(orderId, message, mode, types) {
    const typeOptions = (types || []).map(t =>
        `<option value="${t.discount_type_id}">${escapeHtml(t.name)} (${parseFloat(t.percent).toFixed(2)}%)</option>`
    ).join('');

    const typeField = mode === 'apply'
        ? `
            <div class="mb-3">
                <label class="form-label fw-bold">Discount Type:</label>
                <select id="swal-discount-type" class="form-select">
                    ${typeOptions || '<option value="">No active discount types</option>'}
                </select>
            </div>
            <div class="mb-3">
                <label class="form-label fw-bold">ID Number:</label>
                <input type="text" id="swal-discount-id" class="form-control" placeholder="Senior / PWD ID number" maxlength="50">
            </div>
        `
        : '';

    Swal.fire({
        title: mode === 'apply' ? 'Apply Discount' : 'Remove Discount',
        html: `
            <div class="text-start">
                <p class="text-muted mb-3">${message}</p>
                ${typeField}
                <div class="mb-3">
                    <label class="form-label fw-bold">Authorizer Username:</label>
                    <input type="text" id="swal-auth-user" class="form-control" placeholder="Admin or Supervisor username">
                </div>
                <div class="mb-3">
                    <label class="form-label fw-bold">Password:</label>
                    <input type="password" id="swal-auth-pass" class="form-control" placeholder="Enter password">
                </div>
            </div>
        `,
        icon: mode === 'apply' ? 'info' : 'warning',
        showCancelButton: true,
        confirmButtonColor: mode === 'apply' ? '#0d6efd' : '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: mode === 'apply' ? 'Authorize & Apply Discount' : 'Authorize & Remove Discount',
        preConfirm: () => {
            const username = document.getElementById('swal-auth-user').value.trim();
            const password = document.getElementById('swal-auth-pass').value;
            const discountTypeId = mode === 'apply' ? document.getElementById('swal-discount-type').value : null;
            const discountIdNumber = mode === 'apply' ? document.getElementById('swal-discount-id').value.trim() : null;

            if (!username || !password) {
                Swal.showValidationMessage('Please enter both authorizer username and password.');
                return false;
            }
            if (mode === 'apply' && !discountTypeId) {
                Swal.showValidationMessage('Please select a discount type.');
                return false;
            }
            if (mode === 'apply' && !discountIdNumber) {
                Swal.showValidationMessage('Please enter the customer\'s discount ID number.');
                return false;
            }
            return { username, password, discountTypeId, discountIdNumber };
        }
    }).then((result) => {
        if (result.isConfirmed) {
            if (mode === 'apply') {
                applyDiscount(orderId, result.value);
            } else {
                removeDiscount(orderId, result.value);
            }
        }
    });
}

function applyDiscount(orderId, authData) {
    const token = localStorage.getItem('hof_token');

    Swal.showLoading();

    fetch('/backend/cashier/apply_discount.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            order_id: orderId,
            discount_type_id: authData.discountTypeId,
            discount_id_number: authData.discountIdNumber,
            authorizer_username: authData.username,
            authorizer_password: authData.password,
            token: token
        })
    })
        .then(res => res.json())
        .then(data => {
            Swal.close();
            if (data.success) {
                Swal.fire({
                    icon: 'success',
                    title: 'Discount Applied!',
                    text: data.message || 'Discount applied.',
                    timer: 2000,
                    showConfirmButton: false
                });
                fetchOrderDetails(orderId);
                loadPendingOrders();
            } else {
                Swal.fire('Discount Failed', data.message, 'error');
            }
        })
        .catch(err => {
            Swal.close();
            console.error('Discount apply error:', err);
            Swal.fire('Error', 'An unexpected error occurred while applying the discount.', 'error');
        });
}

function removeDiscount(orderId, authData) {
    const token = localStorage.getItem('hof_token');

    Swal.showLoading();

    fetch('/backend/cashier/remove_discount.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            order_id: orderId,
            authorizer_username: authData.username,
            authorizer_password: authData.password,
            token: token
        })
    })
        .then(res => res.json())
        .then(data => {
            Swal.close();
            if (data.success) {
                Swal.fire({
                    icon: 'success',
                    title: 'Discount Removed!',
                    text: data.message || 'Discount removed.',
                    timer: 2000,
                    showConfirmButton: false
                });
                fetchOrderDetails(orderId);
                loadPendingOrders();
            } else {
                Swal.fire('Remove Failed', data.message, 'error');
            }
        })
        .catch(err => {
            Swal.close();
            console.error('Discount remove error:', err);
            Swal.fire('Error', 'An unexpected error occurred while removing the discount.', 'error');
        });
}

function round2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * Fetch the CURRENT order total straight from the server.
 * A payment total must never be derived from stale DOM text.
 */
async function fetchLiveOrderTotal(orderId) {
    const response = await fetch(`/backend/cashier/get_order_details.php?order_id=${encodeURIComponent(orderId)}`);
    const data = await response.json();
    if (!data.success || !data.order_info) {
        throw new Error(data.error || 'Could not load the latest order details.');
    }
    return {
        total: round2(parseFloat(data.order_info.total_amount) || 0),
        reference: data.order_info.reference_number || '',
        customer: data.order_info.customer_name || ''
    };
}

function handleEnter() {
    if (!activeOrderId) {
        Swal.fire('Error', 'Please select an order first.', 'error');
        return;
    }

    const inputDisplayEl = document.querySelector('.input-display');
    if (!inputDisplayEl) return;

    const inputDisplay = inputDisplayEl.innerText.replace('₱', '').replace(/,/g, '');
    const cashAmount = parseFloat(inputDisplay);
    const uiTotalAmount = parseFloat(document.getElementById('summary-total').innerText.replace('₱', '').replace(/,/g, ''));

    if (isNaN(cashAmount) || cashAmount <= 0) {
        Swal.fire('Invalid Amount', 'Please enter a valid cash amount.', 'warning');
        return;
    }

    // Quick UI-side sanity check only — the server re-validates against the
    // LIVE total before committing, because this DOM value can go stale.
    if (cashAmount < uiTotalAmount) {
        Swal.fire('Insufficient Cash', `Total is ₱${uiTotalAmount.toFixed(2)}. Need more cash!`, 'error');
        return;
    }

    isAmountConfirmed = true;
    confirmedCash = cashAmount;
    // Remember the total the cashier was looking at so we can explain a
    // mid-payment price change precisely.
    confirmedUiTotal = uiTotalAmount;

    Swal.fire({
        title: 'Amount Entered',
        text: `Cash Received: ₱${confirmedCash.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
        icon: 'success',
        timer: 1000,
        showConfirmButton: false
    });
}

async function handlePay() {
    if (!activeOrderId) return;

    if (!isAmountConfirmed) {
        Swal.fire('Wait!', 'Please enter the cash amount and press ENTER first.', 'warning');
        return;
    }

    let live;
    try {
        // ── AUTHORITATIVE TOTAL (P0) ──
        // The customer may have added items AFTER the cashier typed the cash
        // amount, so we always settle against the CURRENT server total.
        live = await fetchLiveOrderTotal(activeOrderId);
    } catch (err) {
        console.error('Could not refresh order total:', err);
        Swal.fire('Error', err.message || 'Could not refresh the order total. Please try again.', 'error');
        return;
    }

    const serverTotal = live.total;

    // ── INSUFFICIENT PAYMENT IS REJECTED BEFORE THE RECEIPT IS SHOWN ──
    if (confirmedCash < serverTotal) {
        Swal.fire({
            icon: 'error',
            title: 'Insufficient Payment',
            html: `Insufficient payment. Current order total is <b>₱${serverTotal.toFixed(2)}</b>.`
                + (round2(confirmedUiTotal) !== serverTotal
                    ? `<br><br><small>The total changed from ₱${round2(confirmedUiTotal).toFixed(2)} to ₱${serverTotal.toFixed(2)} — the customer added items.</small>`
                    : '')
                + `<br><br>Cash received: ₱${round2(confirmedCash).toFixed(2)}. Please collect the correct amount and try again.`,
            confirmButtonColor: '#FF3B30'
        });
        isAmountConfirmed = false;
        confirmedCash = 0;
        confirmedUiTotal = 0;
        return;
    }

    // Change is derived from the SERVER total, so it can never be negative.
    const change = round2(confirmedCash - serverTotal);

    // Fetch full order details for receipt (items, cashier name, etc.)
    let receiptItems = [];
    let cashierName = '';
    let receiptSubtotal = null;
    let receiptDiscount = null;
    try {
        const detailsResp = await fetch(`/backend/cashier/get_order_details.php?order_id=${activeOrderId}`);
        const detailsData = await detailsResp.json();
        if (detailsData.success) {
            receiptItems = detailsData.items || [];
            cashierName = detailsData.cashier_name || detailsData.order_info?.cashier_name || '';
            receiptSubtotal = detailsData.order_info?.subtotal_amount != null
                ? round2(parseFloat(detailsData.order_info.subtotal_amount))
                : null;
            receiptDiscount = detailsData.order_info?.discount_amount != null
                ? round2(parseFloat(detailsData.order_info.discount_amount))
                : null;
            if (!cashierName) {
                const token = localStorage.getItem('hof_token');
                if (token) {
                    try {
                        const payload = JSON.parse(atob(token.split('.')[1]));
                        cashierName = payload.username || payload.first_name + ' ' + payload.last_name || '';
                    } catch (e) {}
                }
            }
        }
    } catch (e) {}

    const now = new Date();
    const dateStr = now.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });

    const itemsHtml = receiptItems.map(item =>
        `<tr><td style="padding:4px 8px;">${escapeHtml(item.item_name)}</td><td style="padding:4px 8px;text-align:center;">${item.quantity}</td><td style="padding:4px 8px;text-align:right;">₱${parseFloat(item.price).toFixed(2)}</td><td style="padding:4px 8px;text-align:right;">₱${(parseFloat(item.price) * item.quantity).toFixed(2)}</td></tr>`
    ).join('');

    Swal.fire({
        title: '<span style="font-family: Courier; font-weight: bold;">HOUSE OF FRIES</span>',
        html: `
            <div id="receiptContent" style="font-family: Courier; font-size: 13px; text-align: left; max-width: 300px; margin: 0 auto;">
                <div style="text-align: center; margin-bottom: 8px;">
                    <strong>HOUSE OF FRIES</strong><br>
                    <small>Tagoloan Branch</small><br>
                    ${dateStr} ${timeStr}<br>
                    ${live.reference ? `<small>#${escapeHtml(live.reference)}</small>` : ''}
                </div>
                <hr style="border-top: 1px dashed #000; margin: 4px 0;">
                ${live.customer ? `<p style="margin:2px 0;"><strong>CUSTOMER:</strong> ${escapeHtml(live.customer.toUpperCase())}</p>` : ''}
                ${cashierName ? `<p style="margin:2px 0;"><strong>CASHIER:</strong> ${escapeHtml(cashierName)}</p>` : ''}
                <hr style="border-top: 1px dashed #000; margin: 4px 0;">
                <table style="width:100%; font-size: 12px;">
                    <thead><tr style="font-weight:bold;"><th style="padding:4px 8px;text-align:left;">Item</th><th style="padding:4px 8px;text-align:center;">Qty</th><th style="padding:4px 8px;text-align:right;">Price</th><th style="padding:4px 8px;text-align:right;">Sub</th></tr></thead>
                    <tbody>${itemsHtml || '<tr><td colspan="4" style="text-align:center;padding:8px;">No items</td></tr>'}</tbody>
                </table>
                <hr style="border-top: 1px dashed #000; margin: 4px 0;">
                <p style="margin:2px 0;display:flex;justify-content:space-between;"><span>SUBTOTAL:</span> <span>₱${(receiptSubtotal != null ? receiptSubtotal : serverTotal).toFixed(2)}</span></p>
                ${receiptDiscount != null && receiptDiscount > 0
                    ? `<p style="margin:2px 0;display:flex;justify-content:space-between;"><span>DISCOUNT:</span> <span>-₱${receiptDiscount.toFixed(2)}</span></p>`
                    : ''}
                <p style="margin:2px 0;display:flex;justify-content:space-between;"><span>TOTAL:</span> <span>₱${serverTotal.toFixed(2)}</span></p>
                <p style="margin:2px 0;display:flex;justify-content:space-between;"><span>CASH RECEIVED:</span> <span>₱${round2(confirmedCash).toFixed(2)}</span></p>
                <h4 style="margin:4px 0;display:flex;justify-content:space-between;font-weight:bold;"><span>CHANGE:</span> <span>₱${change.toFixed(2)}</span></h4>
                <hr style="border-top: 1px dashed #000; margin: 4px 0;">
                <p style="text-align:center;margin:8px 0 0 0;font-size:11px;">Thank you for your purchase!</p>
            </div>
        `,
        confirmButtonText: 'COMPLETE TRANSACTION',
        confirmButtonColor: '#28a745',
        showCancelButton: true,
        cancelButtonText: 'Print Receipt',
        cancelButtonColor: '#6c757d',
        allowOutsideClick: false
    }).then((result) => {
        if (result.isConfirmed) {
            processPayment(activeOrderId, confirmedCash, serverTotal);
        } else if (result.dismiss === Swal.DismissReason.cancel) {
            printReceipt(activeOrderId, live.reference, live.customer, cashierName, serverTotal, confirmedCash, change, receiptItems, dateStr, timeStr, receiptSubtotal, receiptDiscount);
        }
    });
}

function printReceipt(orderId, refNumber, customerName, cashierName, total, cash, change, items, dateStr, timeStr, subtotal, discount) {
    const itemsRows = items.map(item =>
        `<tr><td style="padding:4px 8px;">${escapeHtml(item.item_name)}</td><td style="padding:4px 8px;text-align:center;">${item.quantity}</td><td style="padding:4px 8px;text-align:right;">₱${parseFloat(item.price).toFixed(2)}</td><td style="padding:4px 8px;text-align:right;">₱${(parseFloat(item.price) * item.quantity).toFixed(2)}</td></tr>`
    ).join('');

    const win = window.open('', '_blank', 'width=400,height=600');
    if (!win) {
        Swal.fire('Print Error', 'Please allow pop-ups to print the receipt.', 'warning');
        return;
    }
    win.document.write(`
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Receipt</title>
<style>
  @page { margin: 0; size: 80mm auto; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Courier New', monospace; font-size: 12px; color: #000; width: 80mm; padding: 10px; }
  .receipt { max-width: 80mm; margin: 0 auto; }
  .center { text-align: center; }
  .line { border-top: 1px dashed #000; margin: 4px 0; }
  table { width: 100%; font-size: 11px; border-collapse: collapse; }
  th { font-weight: bold; text-align: left; padding: 4px 4px; }
  td { padding: 2px 4px; }
  .amount { text-align: right; }
  .qty { text-align: center; }
  .total-row { font-weight: bold; font-size: 13px; }
  .thankyou { text-align: center; margin-top: 10px; font-size: 11px; }
  @media print { body { padding: 5px; } }
</style></head><body>
<div class="receipt">
  <div class="center"><strong>HOUSE OF FRIES</strong><br><small>Tagoloan Branch</small><br>${escapeHtml(dateStr)} ${escapeHtml(timeStr)}<br>${refNumber ? '#' + escapeHtml(String(refNumber)) : ''}</div>
  <div class="line"></div>
  ${customerName ? '<p><strong>CUSTOMER:</strong> ' + escapeHtml(customerName.toUpperCase()) + '</p>' : ''}
  ${cashierName ? '<p><strong>CASHIER:</strong> ' + escapeHtml(cashierName) + '</p>' : ''}
  <div class="line"></div>
  <table><thead><tr><th>Item</th><th class="qty">Qty</th><th class="amount">Price</th><th class="amount">Sub</th></tr></thead><tbody>${itemsRows}</tbody></table>
  <div class="line"></div>
  <p style="display:flex;justify-content:space-between;"><span>SUBTOTAL:</span><span>₱${(subtotal != null ? subtotal : total).toFixed(2)}</span></p>
  ${discount != null && discount > 0 ? '<p style="display:flex;justify-content:space-between;"><span>DISCOUNT:</span><span>-₱' + discount.toFixed(2) + '</span></p>' : ''}
  <p style="display:flex;justify-content:space-between;"><span>TOTAL:</span><span>₱${total.toFixed(2)}</span></p>
  <p style="display:flex;justify-content:space-between;"><span>CASH:</span><span>₱${round2(cash).toFixed(2)}</span></p>
  <p class="total-row" style="display:flex;justify-content:space-between;"><span>CHANGE:</span><span>₱${change.toFixed(2)}</span></p>
  <div class="line"></div>
  <div class="thankyou">Thank you for your purchase!</div>
</div>
<script>window.onload = function() { window.print(); window.close(); }</script>
</body></html>
`);
    win.document.close();
}

let paymentInFlight = false;

function processPayment(orderId, cash, expectedTotal) {
    if (paymentInFlight) return;   // prevent double submission
    paymentInFlight = true;

    Swal.showLoading();

    fetch('/backend/cashier/process_payment.php', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + (localStorage.getItem('hof_token') || '')
        },
        body: JSON.stringify({
            order_id: orderId,
            cash_received: cash,
            // The backend compares this against the live DB total and refuses
            // the payment if the order changed in the meantime.
            expected_total: round2(expectedTotal)
        })
    })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                // Clear the selection ONLY after the DB confirms the payment.
                activeOrderId = null;
                isAmountConfirmed = false;
                confirmedCash = 0;
                confirmedUiTotal = 0;
                resetOrderSummaryUI();
                loadPendingOrders();
                Swal.fire({
                    icon: 'success',
                    title: 'Payment processed!',
                    html: `Change due: <b>₱${round2(data.change || 0).toFixed(2)}</b>`,
                    confirmButtonColor: '#28a745'
                });
            } else {
                // Keep the cashier's context so they can retry — the order
                // selection and entered amount are intentionally preserved.
                Swal.fire('Payment not completed', data.message || 'The payment could not be processed.', 'error');
                loadPendingOrders();
            }
        })
        .catch(err => {
            console.error("Payment error:", err);
            Swal.fire('Connection Error', 'Could not process the payment. Please check the network and try again.', 'error');
        })
        .finally(() => {
            paymentInFlight = false;
        });
}

function loadActiveTablesFilter() {
    const filterSelect = document.getElementById('filter-table-select');
    if (!filterSelect) return;

    fetch('/backend/cashier/get_active_tables.php')
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                filterSelect.innerHTML = `
                    <option value="all">ALL TABLES</option>
                    <option value="otc">OTC / TAKE-OUT</option>
                `;
                data.tables.forEach(table => {
                    filterSelect.innerHTML += `<option value="${table.table_number}">TABLE ${table.table_number}</option>`;
                });
            }
        })
        .catch(err => console.error("Error fetching restaurant tables:", err));
}

function createNewOtcTicket() {
    fetch('/backend/cashier/get_active_tables.php')
        .then(res => res.json())
        .then(tableData => {
            let tableOptionsHtml = '<option value="">-- SELECT A TABLE --</option>';
            if (tableData.success && tableData.tables) {
                tableData.tables.forEach(table => {
                    tableOptionsHtml += `<option value="${table.table_id}">Table ${table.table_number}</option>`;
                });
            }

            Swal.fire({
                title: 'New OTC Order Options',
                html: `
                    <div class="text-start px-2">
                        <div class="mb-3">
                            <label for="swal-customer-name" class="fw-bold form-label mb-2">Customer Name (Optional):</label>
                            <input type="text" id="swal-customer-name" class="form-control border-secondary" placeholder="e.g., John Doe">
                        </div>
                        <div class="mb-3">
                            <label class="fw-bold form-label d-block mb-2">Order Type:</label>
                            <div class="form-check form-check-inline me-4">
                                <input class="form-check-input text-warning" type="radio" name="swal-order-type" id="type-takeout" value="TAKE_OUT" checked>
                                <label class="form-check-label fw-semibold" for="type-takeout">Take-Out</label>
                            </div>
                            <div class="form-check form-check-inline">
                                <input class="form-check-input text-warning" type="radio" name="swal-order-type" id="type-dinein" value="DINE_IN">
                                <label class="form-check-label fw-semibold" for="type-dinein">Dine-In</label>
                            </div>
                        </div>
                        <div id="swal-table-wrapper" style="display: none;" class="mb-2">
                            <label for="swal-table-select" class="fw-bold form-label mb-2">Assign Table:</label>
                            <select id="swal-table-select" class="form-select border-secondary">
                                ${tableOptionsHtml}
                            </select>
                        </div>
                    </div>
                `,
                showCancelButton: true,
                confirmButtonText: 'CREATE TICKET',
                confirmButtonColor: '#ffc107',
                cancelButtonColor: '#6c757d',
                customClass: {
                    confirmButton: 'text-dark fw-bold px-4'
                },
                didOpen: () => {
                    const takeoutRadio = document.getElementById('type-takeout');
                    const dineinRadio = document.getElementById('type-dinein');
                    const tableWrapper = document.getElementById('swal-table-wrapper');

                    takeoutRadio.addEventListener('change', () => { tableWrapper.style.display = 'none'; });
                    dineinRadio.addEventListener('change', () => { tableWrapper.style.display = 'block'; });
                },
                preConfirm: () => {
                    const customerName = document.getElementById('swal-customer-name').value.trim();
                    const orderType = document.querySelector('input[name="swal-order-type"]:checked').value;
                    const tableId = document.getElementById('swal-table-select').value;

                    if (orderType === 'DINE_IN' && !tableId) {
                        Swal.showValidationMessage('Please select a table for Dine-In orders!');
                        return false;
                    }

                    if (orderType === 'TAKE_OUT' && !customerName) {
                        Swal.showValidationMessage('Customer name required for takeout orders.');
                        return false;
                    }

                    return {
                        customer_name: customerName || null,
                        order_type: orderType,
                        table_id: orderType === 'DINE_IN' ? tableId : null
                    };
                }
            }).then((result) => {
                if (result.isConfirmed) {
                    fetch('/backend/cashier/create_otc_order.php', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(result.value)
                    })
                        .then(res => res.json())
                        .then(data => {
                            if (data.success) {
                                activeOrderId = data.order_id;
                                isAmountConfirmed = false;
                                confirmedCash = 0;
                                currentInput = "";

                                const displayEl = document.querySelector('.input-display');
                                if (displayEl) displayEl.innerText = "₱0.00";

                                const orderIdEl = document.getElementById('current-order-id');
                                if (orderIdEl) orderIdEl.innerText = '#' + data.reference_number;

                                document.getElementById('order-items-container').innerHTML = `
                                    <tr><td colspan="4" class="text-center text-muted py-5">Empty Ticket. Click menu items to add to this OTC order.</td></tr>
                                `;
                                document.getElementById('summary-subtotal').innerText = '₱0.00';
                                document.getElementById('summary-total').innerText = '₱0.00';

                                loadPendingOrders();
                            } else {
                                Swal.fire('Error', data.message, 'error');
                            }
                        });
                }
            });
        })
        .catch(err => {
            console.error("Error setting up dynamic OTC ticket fields:", err);
            Swal.fire('Error', 'Failed to retrieve restaurant layout data.', 'error');
        });
}


// --- DOM INITIALIZATION (Runs safely after functions are registered) ---

document.addEventListener('DOMContentLoaded', function () {
    loadPendingOrders();
    loadCategories();
    loadItems();
    loadActiveTablesFilter();

    // Hook up OTC Order Button Event
    const otcBtn = document.getElementById('btn-create-otc');
    if (otcBtn) {
        otcBtn.addEventListener('click', function () {
            createNewOtcTicket();
        });
    }

    // ── OTC OPERATIONAL SEARCH (#45) ──
    // Re-filters the pending list as the cashier types (debounced), so
    // "order ID?", "what table?" or "your name?" resolves immediately.
    const otcSearch = document.getElementById('otcOrderSearch');
    if (otcSearch) {
        let otcDebounce = null;
        otcSearch.addEventListener('input', function () {
            clearTimeout(otcDebounce);
            otcDebounce = setTimeout(loadPendingOrders, 200);
        });
    }

    // Dropdown Selection Filter Change Event & Clear Summary
    const filterSelect = document.getElementById('filter-table-select');
    if (filterSelect) {
        filterSelect.addEventListener('change', function (e) {
            currentTableFilter = e.target.value;
            activeOrderId = null;
            resetOrderSummaryUI();
            loadPendingOrders();
        });
    }

    // 1. ORDER SELECTION (Event Delegation)
    document.addEventListener('click', function (e) {
        const card = e.target.closest('.order-card');
        if (card) {
            activeOrderId = card.getAttribute('data-id');
            const status = card.getAttribute('data-status');
            updateActiveCardUI();
            fetchOrderDetails(activeOrderId);

            // Show QRPh button only when PENDING order selected
            const qrBtn = document.getElementById('cashierQRPhBtn');
            if (qrBtn) {
                qrBtn.style.display = (status === 'PENDING') ? 'block' : 'none';
            }
        }
    });

    // 2. NUMPAD & QUICK AMOUNTS
    document.querySelectorAll('.num-btn, .quick-amt-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const val = btn.innerText.replace('₱', '').trim();
            if (btn.classList.contains('quick-amt-btn')) {
                currentInput = val;
            } else if (!isNaN(val)) {
                currentInput += val;
            }
            updateDisplay();
        });
    });

    const backspaceBtn = document.querySelector('.backspace-btn');
    if (backspaceBtn) {
        backspaceBtn.addEventListener('click', () => {
            currentInput = currentInput.slice(0, -1);
            updateDisplay();
        });
    }

    // GLOBAL KEYBOARD LISTENER (Top row numbers, Numpad, Backspace, & Enter)
    document.addEventListener('keydown', function (e) {
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
            return;
        }

        const isTopRowNumber = e.key >= '0' && e.key <= '9' && !e.location;
        const isNumpadNumber = e.code && e.code.startsWith('Numpad') && !isNaN(e.key);

        if (isTopRowNumber || isNumpadNumber || (e.key >= '0' && e.key <= '9')) {
            currentInput += e.key;
            updateDisplay();
            e.preventDefault();
        } 
        else if (e.key === 'Backspace') {
            currentInput = currentInput.slice(0, -1);
            updateDisplay();
            e.preventDefault();
        } 
        else if (e.key === 'Enter') {
            handleEnter();
            e.preventDefault();
        }
    });

    // 3. CATEGORY & ITEM GRID LOGIC
    const catSelect = document.querySelector('.cat-select');
    if (catSelect) {
        catSelect.addEventListener('change', (e) => loadItems(e.target.value));
    }
});

/* ============================================================
   GCASH REDIRECT PAYMENT MODAL (Sandbox)
   ============================================================ */
let gcashQRModal = null;
let gcashQROrderId = null;
let gcashQRPollInterval = null;

// Initialize modal after Bootstrap loads
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
            gcashQRModal = new bootstrap.Modal(document.getElementById('gcashQRModal'), {
                backdrop: 'static',
                keyboard: false
            });
        }
    }, 100);
});

function openGcashQR(orderId) {
    if (!orderId) {
        Swal.fire('Error', 'Please select an order first.', 'error');
        return;
    }

    // Get order details from the active card
    const card = document.querySelector(`.order-card[data-id="${orderId}"]`);
    if (!card) {
        Swal.fire('Error', 'Order not found in list.', 'error');
        return;
    }

    // Extract ref number and total from card
    const refMatch = card.querySelector('h3')?.textContent?.match(/HOF\d+/);
    const totalMatch = card.querySelector('small.fw-bold')?.textContent?.match(/₱([\d.]+)/);

    const refNumber = refMatch ? refMatch[0] : '---';
    const total = totalMatch ? parseFloat(totalMatch[1]) : 0;

    showGcashQR(orderId, refNumber, total);
}

function showGcashQR(orderId, refNumber, total) {
    gcashQROrderId = orderId;

    // ── NULL-SAFE DOM HELPERS (P0 BUG FIX) ──
    // This modal lives in public/cashier/cashier_dashboard.html. It previously
    // also referenced #stickyDownload / #btnDownload / #btnPayApp, which only
    // exist in customer/qr_payment.html — so on the cashier page
    // document.getElementById('stickyDownload') was null and
    // `null.classList.remove(...)` threw "Cannot read properties of null
    // (reading 'classList')", which the .catch() then reported as
    // "Failed to create GCash payment". Every access is now guarded.
    const el = (id) => document.getElementById(id);

    const setText = (id, text) => { const n = el(id); if (n) n.textContent = text; };
    const show = (id, display) => { const n = el(id); if (n) n.style.display = display; };
    const classOp = (id, op, ...cls) => { const n = el(id); if (n) n.classList[op](...cls); };

    // Reset modal state
    setText('modalRefNumber', refNumber);
    setText('modalTotalAmount', '₱' + Number(total || 0).toFixed(2));
    classOp('modalStatusIndicator', 'remove', 'paid', 'failed');
    classOp('modalStatusIndicator', 'add', 'loading');
    setText('modalStatusText', 'Creating QRPh payment...');
    show('modalErrorBox', 'none');
    show('modalQrDisplay', 'none');
    const qrImgEl = el('modalQrImage');
    if (qrImgEl) { qrImgEl.src = ''; qrImgEl.style.display = 'none'; }

    // Show modal
    if (gcashQRModal) gcashQRModal.show();

    // Render a redirect-only response (no QR image). Cashier page has no
    // download / "open app" controls, so we only update text + poll.
    const handleRedirectOnly = (message) => {
        show('modalQrDisplay', 'none');
        setText('modalStatusText', message);
        startGcashQRPolling(orderId);
    };

    // Create GCash payment (QRPh)
    const cashierToken = localStorage.getItem('hof_token') || '';
    const headers = { 'Content-Type': 'application/json' };
    if (cashierToken) headers['Authorization'] = 'Bearer ' + cashierToken;

    fetch('/backend/payments/create-qrph-payment.php', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
            order_id: orderId,
            amount: total,
            reference_number: refNumber
        })
    })
    .then(r => r.json())
    .then(data => {
        if (!data.success) {
            if (!data.qr_code_src && data.redirect_url) {
                handleRedirectOnly('Opening GCash...');
                return;
            }
            throw new Error(data.message || 'Failed to create GCash payment');
        }

        if (data.qr_code_src) {
            if (qrImgEl) {
                qrImgEl.src = data.qr_code_src;
                qrImgEl.style.display = 'block';
            }
            show('modalQrDisplay', 'block');
            setText('modalStatusText', 'QR Code ready — scan with GCash app');
            window._modalPaymentIntentId = data.payment_intent_id;
            startGcashQRPolling(orderId);
        } else if (data.redirect_url) {
            window._modalPaymentIntentId = data.payment_intent_id;
            handleRedirectOnly('Opening GCash...');
        } else {
            throw new Error('No payment method available — QR code or redirect URL required');
        }
    })
    .catch(err => {
        console.error('GCash creation error:', err);
        show('modalErrorBox', 'block');
        setText('modalErrorText', err.message || 'Could not create GCash payment.');
        classOp('modalStatusIndicator', 'remove', 'loading');
        classOp('modalStatusIndicator', 'add', 'failed');
        setText('modalStatusText', 'Failed to create GCash payment');
    });
}

function startGcashQRPolling(orderId) {
    if (gcashQRPollInterval) clearInterval(gcashQRPollInterval);
    const token = localStorage.getItem('hof_token') || '';

    gcashQRPollInterval = setInterval(async () => {
        if (!gcashQROrderId || gcashQROrderId !== orderId) {
            clearInterval(gcashQRPollInterval);
            return;
        }

        try {
            const response = await fetch(
                `/backend/payments/check-payment-status.php?order_id=${orderId}`,
                { headers: token ? { 'Authorization': 'Bearer ' + token } : {} }
            );
            const data = await response.json();

            if (data.success && data.paid) {
                clearInterval(gcashQRPollInterval);
                paymentConfirmed();
            } else if (data.status === 'FAILED') {
                clearInterval(gcashQRPollInterval);
                paymentFailed();
            }
        } catch (err) {
            // Silent - network hiccup
        }
    }, 3000);
}

function paymentConfirmed() {
    // Update modal
    document.getElementById('modalStatusIndicator').classList.remove('loading', 'failed');
    document.getElementById('modalStatusIndicator').classList.add('paid');
    document.getElementById('modalStatusText').innerHTML = '<i class="fa-solid fa-circle-check me-2"></i>Payment Confirmed! ✓';

    Swal.fire({
        icon: 'success',
        title: 'Payment Confirmed!',
        text: 'Customer has paid via GCash. Order sent to kitchen.',
        confirmButtonColor: '#28a745',
        timer: 2000,
        timerProgressBar: true
    });

    if (gcashQRModal) gcashQRModal.hide();
    loadPendingOrders();
}

function paymentFailed() {
    document.getElementById('modalStatusIndicator').classList.remove('loading');
    document.getElementById('modalStatusIndicator').classList.add('failed');
    document.getElementById('modalStatusText').textContent = 'Payment Failed';
    document.getElementById('modalErrorBox').style.display = 'block';
    document.getElementById('modalErrorText').textContent = 'Payment was not completed. Please try again.';
}

window.retryModalQR = function() {
    document.getElementById('modalErrorBox').style.display = 'none';
    document.getElementById('modalQrDisplay').style.display = 'none';
    document.getElementById('modalQrImage').src = '';
    document.getElementById('modalQrImage').style.display = 'none';
    if (gcashQROrderId) {
        showGcashQR(
            gcashQROrderId,
            document.getElementById('modalRefNumber').textContent,
            parseFloat(document.getElementById('modalTotalAmount').textContent.replace('₱', ''))
        );
    }
};

// Also add the GCash QR button to order cards in loadPendingOrders
// (The button is injected in the card HTML generation - will add it below)