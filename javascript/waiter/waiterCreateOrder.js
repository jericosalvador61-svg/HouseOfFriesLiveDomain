document.addEventListener('DOMContentLoaded', () => {
    // State variables
    let cart = JSON.parse(localStorage.getItem('waiter_cart') || '[]');
    let selectedOrderType = 'Dine In';

    // Resolve API URLs relative to this page so the app works both at the
    // domain root and under a sub-folder deployment (e.g. /HOF1/).
    const API_ROOT = '../../backend/waiter/';

    // Local escape helper - menu item names are rendered into HTML.
    function esc(text) {
        if (text === null || text === undefined) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // Attach the JWT to every API call (auth_middleware also accepts the
    // hof_token cookie, but the header is the primary, explicit path).
    function apiFetch(endpoint, options = {}) {
        const token = localStorage.getItem('hof_token') || '';
        return fetch(API_ROOT + endpoint, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
                ...(options.headers || {})
            }
        });
    }

    // DOM Elements
    const tableSelect = document.getElementById('tableSelect');
    const menuItemsContainer = document.getElementById('menuItemsContainer');
    const floatingCartBar = document.getElementById('floatingCartBar');
    const cartSummaryText = document.getElementById('cartSummaryText');
    const cartSummaryTotal = document.getElementById('cartSummaryTotal');
    const btnDineIn = document.getElementById('btnDineIn');
    const btnTakeOut = document.getElementById('btnTakeOut');
    const viewCartBtn = document.getElementById('viewCartBtn');
    
    // Bootstrap Modal Instance for Order Summary
    const orderSummaryModal = new bootstrap.Modal(document.getElementById('orderSummaryModal'));
    const confirmSubmitOrderBtn = document.getElementById('confirmSubmitOrderBtn');

    // Read ?table_id= from URL for pre-selection
    const urlParams = new URLSearchParams(window.location.search);
    const preselectedTableId = urlParams.get('table_id');

    // 1. Fetch dine-in tables (takeout rows are excluded server-side)
    async function fetchTables() {
        try {
            const response = await apiFetch('get_tables.php?table_type=DINE_IN');
            const result = await response.json();

            if (result.success || result.status === 'success') {
                tableSelect.innerHTML = '<option value="" selected disabled>Choose available table...</option>';
                const tablesList = result.tables || [];
                let selectable = 0;

                tablesList.forEach(table => {
                    const option = document.createElement('option');

                    // Set the value as the database primary key ID for backend submission
                    option.value = table.id;

                    // Save the readable label (e.g. "Table 1") in the dataset for display
                    option.dataset.tableNumberText = `Table ${table.table_number}`;

                    option.textContent = `Table ${table.table_number} - ${table.status}`;

                    // Only AVAILABLE dine-in tables can accept a new order.
                    // (The backend re-validates this; never trust the UI alone.)
                    if (String(table.status).toUpperCase() !== 'AVAILABLE') {
                        option.disabled = true;
                        option.textContent += ' (Occupied)';
                    } else {
                        selectable++;
                    }
                    tableSelect.appendChild(option);

                    // Auto-select only if the URL table_id points at an
                    // AVAILABLE (non-disabled) option. A disabled option is
                    // occupied — selecting it would fail server-side review.
                    if (preselectedTableId && String(table.id) === preselectedTableId && !option.disabled) {
                        tableSelect.value = table.id;
                    }
                });

                if (selectable === 0) {
                    tableSelect.innerHTML = '<option value="" selected disabled>No available tables right now</option>';
                }
            } else {
                tableSelect.innerHTML = '<option value="" selected disabled>Failed to load tables</option>';
            }
        } catch (error) {
            console.error('Error fetching tables:', error);
            tableSelect.innerHTML = '<option value="" selected disabled>Error loading tables</option>';
        }
    }

    // 2. Fetch menu items from menu_items table (Available only, server-side)
    async function fetchMenuItems() {
        try {
            const response = await apiFetch('get_menu_items.php');
            const result = await response.json();

            if (result.success && result.menu && result.menu.length > 0) {
                menuItemsContainer.innerHTML = '';
                result.menu.forEach(item => {
                    const col = document.createElement('div');
                    col.className = 'col-md-4 col-sm-6';

                    // Use only the filename from the normalised path, then rebuild
                    // it relative to this page so both root and sub-folder
                    // deployments resolve correctly. REQ-057: prefer the BLOB
                    // (data URI) over the legacy URL column.
                    let imageName = item.image;
                    if (item.image_blob) {
                        imageName = item.image_blob;
                    } else if (imageName) {
                        const parts = String(imageName).split('/');
                        imageName = parts[parts.length - 1];
                    } else {
                        imageName = 'default.jpg';
                    }
                    const finalImagePath = /^data:image\//i.test(imageName)
                        ? imageName
                        : `../../images/menu/${encodeURIComponent(imageName)}`;

                    const safeName = esc(item.name);
                    const safeDesc = esc(item.description || '');

                    col.innerHTML = `
                        <div class="card h-100 border-0 shadow-sm rounded-4 overflow-hidden">
                            <img src="${finalImagePath}" class="card-img-top" alt="${safeName}" style="height: 140px; object-fit: cover;" onerror="this.onerror=null; this.src='../../images/placeholder.png';">
                            <div class="card-body d-flex flex-column justify-content-between p-3">
                                <div>
                                    <h6 class="fw-bold mb-1">${safeName}</h6>
                                    <p class="text-muted small mb-2 text-truncate">${safeDesc}</p>
                                </div>
                                <div class="d-flex align-items-center justify-content-between mt-2">
                                    <span class="text-warning fw-bold">&#8369;${parseFloat(item.price).toFixed(2)}</span>
                                    <button class="btn btn-sm btn-dark px-3 rounded-pill add-to-cart-btn"
                                        data-id="${esc(item.id)}"
                                        data-name="${safeName}"
                                        data-price="${esc(item.price)}">
                                        <i class="bi bi-plus-lg me-1"></i> Add
                                    </button>
                                </div>
                            </div>
                        </div>
                    `;
                    menuItemsContainer.appendChild(col);
                });

                // Attach event listeners to the generated add buttons
                document.querySelectorAll('.add-to-cart-btn').forEach(button => {
                    button.addEventListener('click', (e) => {
                        // The fetched item already carries choices/addons — pass the
                        // whole item so staff see the SAME popup as the customer.
                        const id = e.currentTarget.getAttribute('data-id');
                        const item = result.menu.find(m => String(m.id) === String(id));
                        if (item) {
                            openChoicePopup(item);
                        } else {
                            // Fallback (should not happen): base price, no options.
                            const name = e.currentTarget.getAttribute('data-name');
                            const price = parseFloat(e.currentTarget.getAttribute('data-price'));
                            addConfiguredLine({ menu_item_id: id, price, quantity: 1, choices: [], addons: [] }, name, id);
                        }
                    });
                });
            } else {
                menuItemsContainer.innerHTML = '<div class="col-12 text-muted">No menu items available.</div>';
            }
        } catch (error) {
            console.error('Error fetching menu items:', error);
            menuItemsContainer.innerHTML = '<div class="col-12 text-danger">Error loading menu items.</div>';
        }
    }

    // 3. Cart Management Logic

    // Open the shared choice/add-on popup (REQ-040). The waiter sees the same
    // flow as the customer: choices + add-ons + special instructions + qty.
    function openChoicePopup(item) {
        if (typeof window.HOFChoicePopup === 'undefined') {
            Swal.fire('Missing Component', 'The choice popup is not loaded on this page.', 'error');
            return;
        }
        window.HOFChoicePopup.open({
            item: {
                menu_item_id: item.id,
                item_name: item.name,
                description: item.description,
                price: item.price,
                choices: item.choices || [],
                addons: item.addons || []
            },
            onConfirm: (line) => {
                addConfiguredLine(line, item.name, item.id);
            }
        });
    }

    // Config signature so two lines of the SAME base item with different flavors /
    // add-ons stay separate lines (mirrors customer/cart.js lineSignature).
    function lineSignature(line) {
        const choices = (line.choices || []).map(c => String(c)).slice().sort();
        const addons = (line.addons || []).slice().sort((a, b) => String(a.menu_addon_id).localeCompare(String(b.menu_addon_id)))
            .map(a => a.menu_addon_id + 'x' + (parseInt(a.quantity, 10) || 1));
        return line.menu_item_id + '|' + choices.join(',') + '|' + addons.join(',');
    }

    // Attach/refresh line_key on a line so summary rows can target one config.
    function withLineKey(line) {
        const clone = Object.assign({}, line);
        clone.line_key = lineSignature(clone);
        return clone;
    }

    // Add a configured line to the cart. Lines with the same item AND the same
    // configuration (choices / add-ons / instructions) are merged by quantity.
    function addConfiguredLine(line, name, id) {
        const safeLine = withLineKey({
            id: id !== undefined ? id : line.menu_item_id,
            menu_item_id: Number(line.menu_item_id) || (id !== undefined ? Number(id) : Number(line.menu_item_id)),
            name: name,
            price: Number(line.price) || 0,
            quantity: Number(line.quantity) || 1,
            special_instructions: line.special_instructions || '',
            composed_instructions: line.composed_instructions || '',
            choices: Array.isArray(line.choices) ? line.choices : [],
            addons: Array.isArray(line.addons) ? line.addons : [],
            configured: false,
            order_item_id: 0
        });

        const existingItem = cart.find(item =>
            String(item.line_key) === safeLine.line_key
        );

        if (existingItem) {
            existingItem.quantity += safeLine.quantity;
        } else {
            cart.push(safeLine);
        }
        updateCartUI();
    }

    function updateCartUI() {
        const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
        const totalPrice = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        localStorage.setItem('waiter_cart', JSON.stringify(cart));

        if (totalItems > 0) {
            floatingCartBar.style.display = 'flex';
            cartSummaryText.textContent = `${totalItems} item${totalItems > 1 ? 's' : ''} selected`;
            cartSummaryTotal.textContent = `₱${totalPrice.toFixed(2)}`;
        } else {
            floatingCartBar.style.display = 'none';
        }
    }

    // Order Type Button Handlers
    const tableSelectionContainer = document.getElementById('tableSelectionContainer');

    function selectOrderType(type) {
        selectedOrderType = type;
        btnDineIn.classList.toggle('active', type === 'Dine In');
        btnTakeOut.classList.toggle('active', type === 'Take Out');

        // The table picker only applies to dine-in.
        if (tableSelectionContainer) {
            tableSelectionContainer.style.display = type === 'Dine In' ? 'block' : 'none';
        }

        if (type === 'Take Out') {
            apiFetch('get_takeout_table.php')
                .then(r => r.json())
                .then(data => {
                    if (data.success && data.table_id) {
                        window.takeoutTableId = data.table_id;
                    } else {
                        window.takeoutTableId = null;
                        Swal.fire('Take Out Unavailable', data.message || 'No available takeout table is configured.', 'warning');
                    }
                })
                .catch(() => { window.takeoutTableId = null; });
        }
    }

    btnDineIn.addEventListener('click', () => selectOrderType('Dine In'));
    btnTakeOut.addEventListener('click', () => selectOrderType('Take Out'));

    // 4. View Order Summary (Triggers Modal instead of Redirect)
    viewCartBtn.addEventListener('click', () => {
        const customerName = document.getElementById('customerName').value.trim();
        const tableId = tableSelect.value;
        const selectedOption = tableSelect.options[tableSelect.selectedIndex];
        
        const tableNumberText = selectedOption ? selectedOption.dataset.tableNumberText : '';

        // Only Take Out requires customer name; Dine In defaults to 'Walk-in'
        if (selectedOrderType === 'Take Out' && !customerName) {
            Swal.fire('Missing Field', 'Please enter the customer name for take-out orders.', 'warning');
            return;
        }

        if (selectedOrderType === 'Dine In' && !tableId) {
            Swal.fire('Missing Field', 'Please select an available table for Dine In.', 'warning');
            return;
        }

        if (cart.length === 0) {
            Swal.fire('Empty Cart', 'Please select at least one menu item.', 'warning');
            return;
        }

        // Take-out also needs a resolved takeout anchor table.
        if (selectedOrderType === 'Take Out' && !window.takeoutTableId) {
            Swal.fire('Take Out Unavailable', 'No available takeout table is configured. Please ask an administrator.', 'warning');
            return;
        }

        // Populate Modal Fields
        document.getElementById('modalOrderType').textContent = selectedOrderType;
        document.getElementById('modalCustomerName').textContent = customerName || 'Walk-in';

        const modalTableWrap = document.getElementById('modalTableContainer');
        if (selectedOrderType === 'Dine In') {
            modalTableWrap.style.display = 'block';
            document.getElementById('modalTableNumber').textContent = tableNumberText || 'Table --';
        } else {
            modalTableWrap.style.display = 'none';
        }

        // Populate Cart Items in Modal Table
        const cartItemsList = document.getElementById('modalCartItemsList');
        cartItemsList.innerHTML = '';

        renderSummaryRows(cartItemsList);

        document.getElementById('modalGrandTotal').textContent = `₱${Number(grandTotal()).toFixed(2)}`;

        // Open Modal
        orderSummaryModal.show();
    });

    // Grand total helper shared by the initial render and every in-summary edit.
    function grandTotal() {
        return cart.reduce((sum, item) => sum + (Number(item.price) * Number(item.quantity)), 0);
    }

    // Render each cart line as a summary row with qty steppers, remove, and edit
    // buttons (mirrors customer/cart.js changeQty/removeItem/editCartLine).
    function renderSummaryRows(cartItemsList) {
        cartItemsList.innerHTML = '';

        cart.forEach((rawItem, index) => {
            const item = withLineKey(rawItem);
            // Keep the stored line's line_key in sync so edits below always
            // find the same configuration.
            cart[index] = item;
            const subtotal = Number(item.price) * Number(item.quantity);
            const lineKey = item.line_key;

            const row = document.createElement('tr');
            row.dataset.lineKey = lineKey;

            row.innerHTML = `
                <td class="ps-3 fw-semibold text-dark">
                    ${esc(item.name)}
                    ${((item.composed_instructions || item.special_instructions) || '') ? `<div class="small text-muted fw-normal">${esc(item.composed_instructions || item.special_instructions)}</div>` : ''}
                </td>
                <td class="text-center text-muted">&#8369;${Number(item.price).toFixed(2)}</td>
                <td class="text-center">
                    <div class="d-inline-flex align-items-center gap-1">
                        <button type="button" class="btn btn-sm btn-outline-secondary rounded-pill summary-qty-btn" data-action="minus" data-line-key="${esc(lineKey)}" title="Decrease quantity"><i class="bi bi-dash"></i></button>
                        <span class="fw-bold mx-1">${Number(item.quantity)}</span>
                        <button type="button" class="btn btn-sm btn-outline-secondary rounded-pill summary-qty-btn" data-action="plus" data-line-key="${esc(lineKey)}" title="Increase quantity"><i class="bi bi-plus"></i></button>
                    </div>
                </td>
                <td class="text-end pe-3 fw-bold text-dark">&#8369;${Number(subtotal).toFixed(2)}</td>
                <td class="text-center">
                    <div class="d-inline-flex gap-1">
                        <button type="button" class="btn btn-sm btn-outline-primary rounded-pill summary-edit-btn" data-line-key="${esc(lineKey)}" title="Edit item"><i class="bi bi-pencil"></i></button>
                        <button type="button" class="btn btn-sm btn-outline-danger rounded-pill summary-remove-btn" data-line-key="${esc(lineKey)}" title="Remove item"><i class="bi bi-trash"></i></button>
                    </div>
                </td>
            `;

            cartItemsList.appendChild(row);
        });
    }

    // Delegate in-summary row actions (qty +/-/remove/edit) once.
    document.getElementById('modalCartItemsList').addEventListener('click', (e) => {
        const qtyBtn = e.target.closest('.summary-qty-btn');
        const editBtn = e.target.closest('.summary-edit-btn');
        const removeBtn = e.target.closest('.summary-remove-btn');
        if (!qtyBtn && !editBtn && !removeBtn) return;

        const lineKey = (qtyBtn || editBtn || removeBtn).dataset.lineKey;

        if (qtyBtn) {
            changeSummaryQty(lineKey, qtyBtn.dataset.action === 'plus' ? 1 : -1);
        } else if (removeBtn) {
            removeSummaryLine(lineKey);
        } else if (editBtn) {
            editSummaryLine(lineKey);
        }
    });

    // Increase/decrease a line's quantity; dropping below 1 removes the line
    // (mirrors customer/cart.js changeQty).
    function changeSummaryQty(lineKey, delta) {
        const index = cart.findIndex(item => withLineKey(item).line_key === lineKey);
        if (index === -1) return;

        const qty = Number(cart[index].quantity) || 1;
        if (delta === 1) {
            cart[index].quantity = qty + 1;
        } else if (qty > 1) {
            cart[index].quantity = qty - 1;
        } else {
            cart.splice(index, 1);
        }
        updateCartUI();
        refreshSummary();
    }

    function removeSummaryLine(lineKey) {
        const index = cart.findIndex(item => withLineKey(item).line_key === lineKey);
        if (index === -1) return;
        cart.splice(index, 1);
        updateCartUI();
        refreshSummary();
    }

    // Reopen the choice popup for one line, pre-filled with its current
    // configuration. On confirm the line is replaced in place (preserving the
    // other lines) — mirrors customer/cart.js editCartLine.
    async function editSummaryLine(lineKey) {
        const index = cart.findIndex(item => withLineKey(item).line_key === lineKey);
        if (index === -1) return;

        const initial = cart[index];
        const menuItemId = initial.menu_item_id || initial.id;

        let item = null;
        try {
            const response = await apiFetch('get_menu_items.php');
            const result = await response.json();
            if (result.success && result.menu) {
                item = result.menu.find(m => String(m.id) === String(menuItemId)) || null;
            }
        } catch (error) {
            console.error('Error fetching menu for edit:', error);
        }

        if (!item) {
            Swal.fire('Item Unavailable', 'This item is no longer on the menu. Remove it from the cart.', 'warning');
            return;
        }

        window.HOFChoicePopup.open({
            item: {
                menu_item_id: item.id,
                item_name: item.name,
                description: item.description,
                price: item.price,
                choices: item.choices || [],
                addons: item.addons || []
            },
            initial: initial,
            onConfirm: (line) => {
                const replacement = withLineKey({
                    id: initial.id,
                    menu_item_id: Number(line.menu_item_id) || Number(initial.menu_item_id) || Number(initial.id),
                    name: initial.name,
                    price: Number(line.price) || Number(initial.price),
                    quantity: Number(line.quantity) || Number(initial.quantity),
                    special_instructions: line.special_instructions || '',
                    composed_instructions: line.composed_instructions || '',
                    choices: Array.isArray(line.choices) ? line.choices : [],
                    addons: Array.isArray(line.addons) ? line.addons : [],
                    configured: !!initial.configured,
                    order_item_id: initial.order_item_id || 0
                });
                const idx = cart.findIndex(i => withLineKey(i).line_key === lineKey);
                if (idx !== -1) cart.splice(idx, 1, replacement);
                updateCartUI();
                refreshSummary();
            }
        });
    }

    // Re-render the summary rows and grand total while the modal is open.
    function refreshSummary() {
        const cartItemsList = document.getElementById('modalCartItemsList');
        if (!cartItemsList) return;
        renderSummaryRows(cartItemsList);
        document.getElementById('modalGrandTotal').textContent = `₱${Number(grandTotal()).toFixed(2)}`;
    }

    // 5. Confirm & Submit Order via Modal
    confirmSubmitOrderBtn.addEventListener('click', () => {
        const customerName = document.getElementById('customerName').value.trim() || 'Walk-in';
        const tableId = tableSelect.value;
        const token = localStorage.getItem("hof_token");

        const finalOrderPayload = {
            token: token,
            orderType: selectedOrderType,
            tableId: selectedOrderType === 'Dine In' ? tableId : (window.takeoutTableId ?? null),
            customerName: customerName,
            items: cart.map(item => ({
                id: item.id,
                quantity: item.quantity,
                special_instructions: item.special_instructions || '',
                choices: item.choices || [],
                addons: item.addons || []
            }))
        };

        // Disable button to prevent multi-clicks
        confirmSubmitOrderBtn.disabled = true;
        confirmSubmitOrderBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span> Submitting...`;

        // Relative path so this works at the domain root AND under a sub-folder.
        // NOTE: the server ignores the client-sent price/name and re-prices
        // every line from the menu_items table.
        apiFetch('submit_order.php', {
            method: 'POST',
            body: JSON.stringify(finalOrderPayload)
        })
        .then(async response => {
            let data = {};
            try { data = await response.json(); } catch (_) { /* non-JSON error page */ }
            if (!response.ok && !data.message) {
                data.message = response.status === 429
                    ? 'Too many orders submitted too quickly. Please wait a moment.'
                    : `Request failed (HTTP ${response.status}).`;
            }
            return data;
        })
        .then(data => {
            confirmSubmitOrderBtn.disabled = false;
            confirmSubmitOrderBtn.innerHTML = `<i class="bi bi-check-circle-fill me-1"></i> Confirm & Submit Order`;

            if (data.success) {
                orderSummaryModal.hide();
                Swal.fire({
                    icon: 'success',
                    title: 'Order Placed!',
                    text: `Order ${data.reference_number || ''} has been sent to the kitchen.`.trim(),
                    confirmButtonColor: '#ffc107'
                }).then(() => {
                    // Reset application state
                    cart = [];
                    localStorage.removeItem('waiter_cart');
                    document.getElementById('customerName').value = '';
                    tableSelect.selectedIndex = 0;
                    // The takeout anchor is now OCCUPIED until the order is
                    // served — reset so the next Take Out re-queries for a
                    // free anchor (see selectOrderType).
                    window.takeoutTableId = null;
                    updateCartUI();
                    fetchTables(); // Refresh table statuses
                });
            } else {
                Swal.fire('Order Not Placed', data.message || 'Failed to submit order.', 'error');
                // The server rejected the table (e.g. just taken) -> resync.
                fetchTables();
            }
        })
        .catch(error => {
            confirmSubmitOrderBtn.disabled = false;
            confirmSubmitOrderBtn.innerHTML = `<i class="bi bi-check-circle-fill me-1"></i> Confirm & Submit Order`;
            console.error('Error:', error);
            Swal.fire('Error', 'A network error occurred while submitting the order.', 'error');
        });
    });

    // Initialize initial data fetches
    selectOrderType('Dine In');
    updateCartUI();
    fetchTables();
    fetchMenuItems();
});