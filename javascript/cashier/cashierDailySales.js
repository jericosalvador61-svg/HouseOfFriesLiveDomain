document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialize data fetching loops
    loadUserShiftSession();
    loadDailySalesData();
    loadStockInventoryAlerts();
    setupDailySalesControls();

    // 2. Set an interval loop to fetch real-time stock alerts every 30 seconds
    setInterval(loadStockInventoryAlerts, 30000);
});

/* ===================== USER SHIFT SESSION LAYER ===================== */
function loadUserShiftSession() {
    // Read cached login profile state variables populated by check_session.js
    const userName = localStorage.getItem('userName') || 'Cashier Shift';
    const userRole = localStorage.getItem('userRole') || 'Cashier';

    const nameElements = document.querySelectorAll('.user-name');
    const roleElements = document.querySelectorAll('.user-role');
    const avatarElement = document.querySelector('.user-avatar');

    nameElements.forEach(el => el.textContent = userName);
    roleElements.forEach(el => el.textContent = userRole);

    if (avatarElement && userName) {
        avatarElement.textContent = userName.charAt(0).toUpperCase();
    }
}

/* ===================== FETCH DAILY SALES & METRICS ===================== */
async function loadDailySalesData() {
    const tblGrid = document.getElementById('tblDailyTransactionsGrid');
    const rankingsList = document.getElementById('topItemsRankingsList');

    try {
        // Retrieve the secure cryptographic string token stored upon login
        const token = localStorage.getItem('hof_token');

        // Fetch specific sales datasets generated only on the current date for the active cashier session
        const response = await fetch('/backend/cashier/get_cashier_daily_sales.php', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        if (!response.ok) throw new Error('Network issue while fetching shift metrics');

        const data = await response.json();

        // --- EXTRA SAFETY SHIELD LAYER ---
        if (data.status === 'ERROR' || data.success === false) {
            throw new Error(data.message || data.error || 'Backend calculation failure');
        }

        // Set clean fallback properties so the properties don't read as undefined
        const summary = data.summary || { gross_revenue: 0, total_orders: 0, order_handled: 0, cash_revenue: 0, gcash_revenue: 0 };
        const transactions = data.transactions || [];
        const top_items = data.top_items || [];

        // --- 1. POPULATE METRICS CARD SUMMARY COUNTERS ---
        const gross = parseFloat(summary.gross_revenue) || 0;
        const cashRev = parseFloat(summary.cash_revenue) || 0;
        const gcashRev = parseFloat(summary.gcash_revenue) || 0;
        const orderHandled = parseInt(summary.order_handled) || 0;

        const peso = (n) => '₱' + (parseFloat(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        const grossEl = document.getElementById('txtCashierGross');
        const cashEl = document.getElementById('txtCashierCash');
        const gcashEl = document.getElementById('txtCashierGcash');
        const ordersHandledEl = document.getElementById('txtCashierOrdersHandled');
        if (grossEl) grossEl.textContent = peso(gross);
        if (cashEl) cashEl.textContent = peso(cashRev);
        if (gcashEl) gcashEl.textContent = peso(gcashRev);
        if (ordersHandledEl) ordersHandledEl.textContent = orderHandled;

        // --- 2. POPULATE TRANSACTION DETAILS GRID TABLE (paginated) ---
        allTransactions = transactions.slice();
        currentPage = 1;
        renderTransactionsPage();

        // --- 3. POPULATE TOP ITEMS SOLD RANKINGS LIST (compact, P1 #44) ---
        rankingsList.innerHTML = '';
        if (top_items.length === 0) {
            rankingsList.innerHTML = `<div class="text-center py-4 text-muted small">No items tracked for today.</div>`;
        } else {
            // Compact rows: "rank  name - N sold" on one line so the list
            // never eats vertical space on a phone.
            top_items.forEach((item, index) => {
                const rank = index + 1;
                const rankClass = rank <= 3 ? ' rank-top' : '';
                rankingsList.innerHTML += `
                    <div class="d-flex align-items-center justify-content-between item-row py-1">
                        <div class="d-flex align-items-center min-w-0">
                            <div class="rank-circle rank-sm me-2${rankClass}">${rank}</div>
                            <span class="text-dark fw-semibold small text-truncate">${escapeTxn(item.item_name)}</span>
                        </div>
                        <span class="badge bg-dark rounded-pill px-2 py-1 ms-2 flex-shrink-0">${item.total_qty_sold} sold</span>
                    </div>
                `;
            });
        }

    } catch (error) {
        console.error("Dashboard calculation error:", error);
        tblGrid.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-danger"><i class="bi bi-exclamation-triangle-fill me-2"></i> ${error.message || 'Failed to compute shift summaries.'}</td></tr>`;
    }
}

/* ===================== TRANSACTION PAGINATION + FILTER/SEARCH ===================== */
const TXN_PAGE_SIZE = 10;
let allTransactions = [];
let currentPage = 1;
let paymentFilter = "ALL";
let txnSearchTerm = "";

function formatPHTime(epoch) {
    if (!epoch) return '--';
    return new Date(epoch * 1000).toLocaleString('en-PH', {
        timeZone: 'Asia/Manila',
        hour: '2-digit', minute: '2-digit',
        month: 'short', day: 'numeric'
    });
}

function escapeTxn(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function getFilteredTransactions() {
    const q = txnSearchTerm.trim().toLowerCase();
    return allTransactions.filter(tx => {
        if (paymentFilter === "CASH" && (tx.payment_method || "").toUpperCase() !== "CASH") return false;
        if (paymentFilter === "GCASH" && (tx.payment_method || "").toUpperCase() === "CASH") return false;
        if (!q) return true;
        const ref = String(tx.reference_number || tx.order_id || "").toLowerCase();
        const cust = String(tx.customer_name || "").toLowerCase();
        return ref.includes(q) || cust.includes(q);
    });
}

function renderTransactionsPage() {
    const tblGrid = document.getElementById("tblDailyTransactionsGrid");
    const pager = document.getElementById("dailyTxnPager");
    const countEl = document.getElementById("dailyTxnCount");
    if (!tblGrid) return;

    const list = getFilteredTransactions();
    const totalPages = Math.max(1, Math.ceil(list.length / TXN_PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    const start = (currentPage - 1) * TXN_PAGE_SIZE;
    const pageItems = list.slice(start, start + TXN_PAGE_SIZE);

    tblGrid.innerHTML = "";
    if (list.length === 0) {
        tblGrid.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted">No transactions match your filter yet today.</td></tr>`;
    } else {
        pageItems.forEach(tx => {
            const totalPaid = parseFloat(tx.total_amount) || 0;
            const customerName = (tx.customer_name && tx.customer_name !== "null") ? tx.customer_name : "--";

            let typeBadgeColor = "bg-secondary";
            if (tx.order_type === "Dine In" || tx.order_type === "DINE_IN") typeBadgeColor = "bg-warning text-dark";
            if (tx.order_type === "Take Out" || tx.order_type === "TAKE_OUT") typeBadgeColor = "bg-info text-dark";

            const method = (tx.payment_method || "").toUpperCase();
            const methodBadge = method
                ? (method === "CASH"
                    ? '<span class="badge bg-success-subtle text-success fw-semibold" style="font-size:.65rem;"><i class="bi bi-cash-coin me-1"></i>CASH</span>'
                    : `<span class="badge bg-primary-subtle text-primary fw-semibold" style="font-size:.65rem;"><i class="bi bi-phone me-1"></i>${method}</span>`)
                : "";

            const kitchenHint = ["PENDING", "IN-PROGRESS", "COOKING"].includes((tx.kitchen_status || "").toUpperCase())
                ? ' <span class="badge bg-warning-subtle text-warning-emphasis" style="font-size:.6rem;">PREPARING</span>'
                : "";

            tblGrid.innerHTML += `
        <tr>
            <td class="fw-bold text-dark">#${escapeTxn(tx.reference_number)}</td>
            <td class="text-muted">${formatPHTime(tx.paid_at_epoch)}</td>
            <td><span class="badge ${typeBadgeColor} fw-semibold">${escapeTxn(tx.order_type)}</span></td>
            <td>${methodBadge}${kitchenHint}</td>
            <td class="fw-bold text-success">₱${totalPaid.toFixed(2)}</td>
            <td class="text-muted small text-capitalize">${escapeTxn(customerName)}</td>
            <td class="text-center">
                <button class="btn btn-sm btn-light border px-2 py-1" onclick="viewOrderReceiptDetails(${tx.order_id})">
                    <i class="bi bi-eye"></i> View
                </button>
            </td>
        </tr>
    `;
        });
    }

    if (countEl) {
        const from = list.length === 0 ? 0 : start + 1;
        const to = Math.min(start + TXN_PAGE_SIZE, list.length);
        countEl.textContent = `${from}-${to} of ${list.length} transactions`;
    }

    if (pager) renderTxnPager(pager, totalPages);
}



function renderTxnPager(pager, totalPages) {
    let html = "";
    html += `<li class="page-item ${currentPage === 1 ? "disabled" : ""}">` +
        `<a class="page-link" href="#" data-page="${currentPage - 1}" aria-label="Previous">&laquo;</a></li>`;

    // Keep the pager short: a small window of page numbers.
    const windowSize = 5;
    let from = Math.max(1, currentPage - Math.floor(windowSize / 2));
    let to = Math.min(totalPages, from + windowSize - 1);
    from = Math.max(1, to - windowSize + 1);

    for (let p = from; p <= to; p++) {
        html += `<li class="page-item ${p === currentPage ? "active" : ""}">` +
            `<a class="page-link" href="#" data-page="${p}">${p}</a></li>`;
    }

    html += `<li class="page-item ${currentPage === totalPages ? "disabled" : ""}">` +
        `<a class="page-link" href="#" data-page="${currentPage + 1}" aria-label="Next">&raquo;</a></li>`;

    pager.innerHTML = html;

    pager.querySelectorAll("a.page-link").forEach(a => {
        a.addEventListener("click", (ev) => {
            ev.preventDefault();
            const target = parseInt(a.dataset.page, 10);
            const totalSafe = Math.max(1, Math.ceil(getFilteredTransactions().length / TXN_PAGE_SIZE));
            if (!isNaN(target) && target >= 1 && target <= totalSafe) {
                currentPage = target;
                renderTransactionsPage();
            }
        });
    });
}

function setupDailySalesControls() {
    const filterSel = document.getElementById("dailyPaymentFilter");
    const searchInput = document.getElementById("dailyTxnSearch");
    if (filterSel) {
        filterSel.addEventListener("change", () => {
            paymentFilter = filterSel.value || "ALL";
            currentPage = 1;
            renderTransactionsPage();
        });
    }
    if (searchInput) {
        let debounce = null;
        searchInput.addEventListener("input", () => {
            clearTimeout(debounce);
            debounce = setTimeout(() => {
                txnSearchTerm = searchInput.value;
                currentPage = 1;
                renderTransactionsPage();
            }, 250);
        });
    }
}
/* ===================== NOTIFICATION LIVE ALERTS ===================== */
async function loadStockInventoryAlerts() {
    try {
        const token = localStorage.getItem('hof_token');

        // Fetch raw material values directly from your centralized inventory manager tracking script
        const response = await fetch('/backend/cashier/get_materials.php', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        if (!response.ok) throw new Error("Could not pull warehouse stocks");

        const materialsList = await response.json();
        checkStockAlerts(materialsList);
    } catch (error) {
        console.error("Stock monitoring loop error:", error);
    }
}

function checkStockAlerts(materialsList) {
    const badge = document.getElementById('notificationBadge');
    const menu = document.getElementById('notificationMenu');
    if (!menu || !badge || !Array.isArray(materialsList)) return;

    let activeAlerts = [];

    materialsList.forEach(material => {
        const qty = parseFloat(material.current_quantity) || 0;
        const reorderLevel = parseFloat(material.reorder_level) || 0;

        let alertText = "";
        let isCritical = false;

        if (qty <= 0) {
            alertText = `⚠️ <strong>${material.raw_material_name}</strong> is completely out of stock! Restock immediately.`;
            isCritical = true;
        } else if (qty <= reorderLevel) {
            alertText = `⚠️ <strong>${material.raw_material_name}</strong> is low on stock (${qty} ${material.unit} left). Restock soon!`;
            isCritical = false;
        }

        if (alertText) {
            activeAlerts.push({
                text: alertText,
                isCritical: isCritical,
                updatedAt: material.updated_at ? new Date(material.updated_at).getTime() : 0
            });
        }
    });

    // Reset dropdown menu structure
    menu.innerHTML = '<li class="dropdown-header border-bottom fw-bold text-dark py-2">Stock Alerts</li>';

    if (activeAlerts.length > 0) {
        // Facebook Style: Sort strictly by modification date timestamps (latest on top)
        activeAlerts.sort((a, b) => b.updatedAt - a.updatedAt);

        activeAlerts.forEach(alert => {
            menu.innerHTML += `
                <li>
                    <a class="dropdown-item py-2 border-bottom text-wrap" href="manage_inventory.html" style="font-size: 0.9rem;">
                        <div style="color: ${alert.isCritical ? '#dc3545' : '#b57d00'};">
                            ${alert.text}
                        </div>
                    </a>
                </li>`;
        });

        // Set the badge count and keep it permanently visible
        badge.textContent = activeAlerts.length;
        badge.classList.remove('d-none');

    } else {
        // Hide badge only if there are absolutely zero alerts active in the system
        badge.classList.add('d-none');
        menu.innerHTML += `<li><span class="dropdown-item text-muted text-center py-3">✅ All inventory levels are normal.</span></li>`;
    }
}

/* ===================== VIEW DETAILED SHIFT RECEIPT ===================== */
function viewOrderReceiptDetails(orderId) {
    // Premium modal callback to query complete layout lists inside dashboard boundaries
    Swal.fire({
        title: `Order Summary #${orderId}`,
        text: 'Loading detailed itemizations...',
        allowOutsideClick: true,
        background: '#1e1e1e',
        color: '#ffffff',
        confirmButtonColor: '#fac12b',
        didOpen: async () => {
            Swal.showLoading();
            try {
                const token = localStorage.getItem('hof_token');

                // Fetch using your absolute root directory mapping path
                const response = await fetch('/backend/cashier/get_order_details.php?order_id=' + orderId, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                });
                const data = await response.json();

                // Safety check matching your script's response structure
                if (!data.success) {
                    throw new Error(data.error || 'Failed to pull order data');
                }

                // Map variables to match your existing backend structure ('order_info')
                const info = data.order_info;
                const paymentMethod = info.reference_number ? `GCash (${info.reference_number})` : 'OTC Cash';
                const customer = info.customer_name ? info.customer_name : 'Walk-in Customer';

                let itemSummaryHtml = '<div class="text-start mt-3" style="max-height: 250px; overflow-y: auto;">';
                data.items.forEach(el => {
                    itemSummaryHtml += `
                        <div class="d-flex justify-content-between border-bottom border-secondary py-2 small">
                            <span>${el.item_name} <strong class="text-warning">x${el.quantity}</strong></span>
                            <span class="fw-bold">₱${(parseFloat(el.price) * el.quantity).toFixed(2)}</span>
                        </div>`;
                });
                itemSummaryHtml += '</div>';

                Swal.hideLoading();
                Swal.update({
                    title: `Receipt Details #${orderId}`,
                    html: `
                        <div class="small text-muted text-start mb-1">Customer: <strong class="text-white">${customer}</strong></div>
                        <div class="small text-muted text-start mb-2">Payment Mode: <strong>${paymentMethod}</strong></div>
                        ${itemSummaryHtml}
                        <div class="d-flex justify-content-between mt-3 fw-bold fs-5 text-warning">
                            <span>Grand Total:</span>
                            <span>₱${parseFloat(info.total_amount).toFixed(2)}</span>
                        </div>
                    `
                });
            } catch (err) {
                Swal.fire({
                    icon: 'error',
                    title: 'Fetch Error',
                    text: err.message || 'Could not fetch order data metrics lines.',
                    background: '#1e1e1e',
                    color: '#ffffff'
                });
            }
        }
    });
}
