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
                    // deployments resolve correctly.
                    let imageName = item.image;
                    if (imageName) {
                        const parts = String(imageName).split('/');
                        imageName = parts[parts.length - 1];
                    } else {
                        imageName = 'default.jpg';
                    }
                    const finalImagePath = `../../images/menu/${encodeURIComponent(imageName)}`;

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

    // Add a configured line to the cart. Lines with the same item AND the same
    // configuration (choices / add-ons / instructions) are merged by quantity.
    function addConfiguredLine(line, name, id) {
        const safeLine = {
            id: id !== undefined ? id : line.menu_item_id,
            name: name,
            price: Number(line.price) || 0,
            quantity: Number(line.quantity) || 1,
            special_instructions: line.special_instructions || '',
            composed_instructions: line.composed_instructions || '',
            choices: Array.isArray(line.choices) ? line.choices : [],
            addons: Array.isArray(line.addons) ? line.addons : []
        };

        const existingItem = cart.find(item => {
            if (String(item.id) !== String(safeLine.id)) return false;
            if ((item.special_instructions || '') !== safeLine.special_instructions) return false;
            if (JSON.stringify(item.choices || []) !== JSON.stringify(safeLine.choices)) return false;
            return JSON.stringify(item.addons || []) === JSON.stringify(safeLine.addons);
        });

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

        let grandTotal = 0;
        cart.forEach(item => {
            const subtotal = Number(item.price) * Number(item.quantity);
            grandTotal += subtotal;

            cartItemsList.innerHTML += `
                <tr>
                    <td class="ps-3 fw-semibold text-dark">
                        ${esc(item.name)}
                        ${((item.composed_instructions || item.special_instructions) || '') ? `<div class="small text-muted fw-normal">${esc(item.composed_instructions || item.special_instructions)}</div>` : ''}
                    </td>
                    <td class="text-center text-muted">&#8369;${Number(item.price).toFixed(2)}</td>
                    <td class="text-center">${Number(item.quantity)}</td>
                    <td class="text-end pe-3 fw-bold text-dark">&#8369;${Number(subtotal).toFixed(2)}</td>
                </tr>
            `;
        });

        document.getElementById('modalGrandTotal').textContent = `₱${Number(grandTotal).toFixed(2)}`;

        // Open Modal
        orderSummaryModal.show();
    });

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