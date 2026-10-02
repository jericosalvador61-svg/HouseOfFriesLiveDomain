const APP_ROOT = (() => {
    const m = window.location.pathname.match(/^(.*?)(?:\/public|\/customer|\/backend|\/admin|\/cashier|\/inventoryStaff|\/kitchenStaff|\/waiter|\/supervisor)(?:\/|$)/i);
    return m && m[1] ? m[1] : '';
})();

document.addEventListener('DOMContentLoaded', () => {
    renderReceipt();
    initCheckoutPaymentSection();
    initPusher();

    const urlParams = new URLSearchParams(window.location.search);
    const orderId = urlParams.get('order_id');
    const returnSig = urlParams.get('sig');
    if (orderId) {
        verifyGcashPayment(orderId, returnSig);
    }
});

// REQ-054 B1: clear the cart + cart badge once payment succeeds. Keeps
// lastOrderID / lastRefNumber intact — the tracker still needs them.
function clearCartAndBadge() {
    localStorage.removeItem('cart');
    if (typeof window.updateBadge === 'function') {
        try { window.updateBadge(); } catch (e) {}
    }
    const badge = document.getElementById('cartBadgeCount');
    if (badge) badge.textContent = '0';
}
window.clearCartAndBadge = clearCartAndBadge;

// REQ-054 B4-B: the payment method is chosen on the CART page, not here.
// Read the persisted selection and render the correct single CTA.
function initCheckoutPaymentSection() {
    const method = (localStorage.getItem('payment_method') || '').toUpperCase();
    const banner = document.getElementById('methodBanner');
    const bannerText = document.getElementById('methodBannerText');
    const cashCard = document.getElementById('cashInstructionCard');
    const gcashSection = document.getElementById('gcashSection');

    if (method === 'GCASH') {
        if (banner) banner.style.display = 'flex';
        if (bannerText) bannerText.textContent = 'Paying with GCash';
        if (cashCard) cashCard.style.display = 'none';
        if (gcashSection) gcashSection.style.display = 'flex';
    } else {
        // Cash is the default when nothing (or an unknown value) was persisted.
        if (banner) banner.style.display = 'flex';
        if (bannerText) bannerText.textContent = 'Pay at Counter';
        if (cashCard) cashCard.style.display = 'flex';
        if (gcashSection) gcashSection.style.display = 'none';
    }
}

async function verifyGcashPayment(orderId, returnSig) {
    let attempt = 0;
    const MAX_ATTEMPTS = 6;

    while (attempt < MAX_ATTEMPTS) {
        attempt++;
        try {
            let url = '../backend/payments/check-payment-status.php?order_id=' + encodeURIComponent(orderId);
            if (returnSig) {
                url += '&sig=' + encodeURIComponent(returnSig);
            }
            const response = await fetch(url);
            const data = await response.json();

            if (data.success && data.paid) {
                markPaymentConfirmed(data);
                return;
            }
            if (data.status === 'FAILED') {
                markPaymentFailed();
                return;
            }
        } catch (err) {
            console.error('Payment verification error:', err);
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Still pending after all attempts — don't block the customer.
    if (!returnSig) {
        document.getElementById('paymentInstructionTitle').textContent = 'Payment Confirming...';
        document.getElementById('paymentInstructionDesc').innerHTML = 'We are still confirming your GCash payment. <a href="orderTracker.html" style="color:#0056E3;font-weight:700;">Check order status</a> or <a href="checkout.html" style="color:#0056E3;font-weight:700;">return to checkout</a>.';
    } else {
        Swal.fire({
            icon: 'info',
            title: 'Payment Confirming...',
            text: 'We are still confirming your GCash payment. If you already paid, your order is on its way to the kitchen.',
            confirmButtonColor: '#FFB800'
        });
    }
}

function markPaymentConfirmed(data) {
    const title = document.getElementById('paymentInstructionTitle');
    const desc = document.getElementById('paymentInstructionDesc');
    if (title) title.textContent = 'Payment Confirmed ✓';
    if (desc) desc.textContent = 'Your GCash payment was received. Your order is now being prepared in the kitchen.';

    // Flip the page to the paid state
    const h2 = document.querySelector('h2');
    if (h2) h2.textContent = 'Payment Successful';
    const wrap = document.querySelector('.success-icon-wrap');
    if (wrap) wrap.style.background = '#E8F8EE';
    const icon = document.querySelector('.success-icon-wrap i');
    if (icon) {
        icon.className = 'fa-solid fa-circle-check';
        icon.style.color = '#34C759';
    }

    // Hide Edit and Pay buttons, show paid state
    const editBtn = document.getElementById('editOrderBtn');
    const payBtn = document.getElementById('payGcashBtn');
    const orderAgainBtn = document.getElementById('orderAgainBtn');
    const goTrackBtn = document.getElementById('goTrackBtn');
    const printReceiptBtn = document.getElementById('printReceiptBtn');
    if (editBtn) editBtn.style.display = 'none';
    if (payBtn) payBtn.style.display = 'none';
    if (orderAgainBtn) orderAgainBtn.style.display = 'flex';
    if (goTrackBtn) goTrackBtn.style.display = 'flex';
    // REQ-054 B4-E: show the Print Receipt button once payment is confirmed.
    if (printReceiptBtn) printReceiptBtn.style.display = 'flex';

    // REQ-054 B4-A: clear the stale cart so the badge never shows a paid order
    // as still pending (item #14).
    localStorage.removeItem('cart');
    if (window.updateBadge) window.updateBadge();

    // Update device registry
    const orderId = localStorage.getItem('lastOrderID');
    if (orderId && window.HOFDevice) {
        HOFDevice.updateStatus(orderId, 'IN-PROGRESS', true);
    }

    // REQ-054 B1: payment confirmed — the cart is spent, clear it + badge.
    // Do NOT touch lastOrderID/lastRefNumber; the tracker still needs them.
    clearCartAndBadge();

    Swal.fire({
        icon: 'success',
        title: 'Payment Successful!',
        text: 'Your GCash payment was received. Your order is now being prepared in the kitchen.',
        confirmButtonColor: '#FFB800',
        timer: 2500,
        timerProgressBar: true,
        showConfirmButton: false
    }).then(() => {
        // REQ-054 B4-A (#12): GCash success auto-redirects to the order tracker.
        if (orderId) {
            window.location.href = 'orderTracker.html?order_id=' + orderId;
        } else {
            window.location.href = 'orderTracker.html';
        }
    });
}

// REQ-054 B4-A (#13): GCash cancel → customer returns to checkout and can
// cleanly switch to the cash path (the stale intent was cleared server-side
// by check-payment-status.php).
function markPaymentFailed() {
    const title = document.getElementById('paymentInstructionTitle');
    const desc = document.getElementById('paymentInstructionDesc');
    if (title) title.textContent = 'Payment Failed';
    if (desc) desc.textContent = 'Your GCash payment was not completed. Please try again or pay at the counter.';

    Swal.fire({
        icon: 'error',
        title: 'Payment Failed',
        text: 'Your GCash payment was not completed. Please try again or pay at the counter.',
        confirmButtonColor: '#dc3545'
    }).then(() => {
        // Drop the intent marker so a fresh GCash attempt or the cash path
        // is not blocked by a stale "processing" guard.
        localStorage.removeItem('hof_gcash_created');
        // Show the cash option so the customer can pay at the counter instead.
        const bannerText = document.getElementById('methodBannerText');
        if (bannerText) bannerText.textContent = 'Pay at Counter';
        const cashCard = document.getElementById('cashInstructionCard');
        const gcashSection = document.getElementById('gcashSection');
        if (cashCard) cashCard.style.display = 'flex';
        if (gcashSection) gcashSection.style.display = 'none';
    });
}

function renderReceipt() {
    // 1. Get the real data from localStorage
    const cart = JSON.parse(localStorage.getItem('cart')) || [];
    const refNumber = localStorage.getItem('lastRefNumber');

    // H3: display the table NUMBER (label), not the DB table_id.
    const tableNumber = localStorage.getItem('currentTableNumber')
        || (JSON.parse(localStorage.getItem('hof_order_session') || '{}').table_number || '--');

    // Redirect if someone tries to access checkout.html without an active order
    if (!refNumber) {
        window.location.href = 'customer.html';
        return;
    }

    const orderID = document.getElementById('displayOrderID');
    const totalAmount = document.getElementById('receiptTotalAmount');
    const orderTime = document.getElementById('orderTime');
    const tableDisplay = document.getElementById('tableDisplay');

    // 2. Display the Real Order Info
    orderID.textContent = refNumber;

    // --- TIMEZONE-SAFE TIMESTAMP DISPLAY ---
    const rawEpoch = localStorage.getItem('lastOrderEpoch');
    if (rawEpoch) {
        orderTime.textContent = new Date(parseInt(rawEpoch) * 1000).toLocaleString('en-PH', {
            timeZone: 'Asia/Manila',
            hour: '2-digit', minute: '2-digit',
            month: 'short', day: 'numeric'
        });
    } else {
        orderTime.textContent = new Date().toLocaleString('en-PH', {
            timeZone: 'Asia/Manila',
            hour: '2-digit', minute: '2-digit',
            month: 'short', day: 'numeric'
        });
    }

    // Update the display text seamlessly
    if (tableDisplay) {
        tableDisplay.textContent = `Table: ${tableNumber}`;
    }

    // 3. Show a local estimate immediately, then correct to the server total
    //    once the signed order-items fetch returns (H3: never trust localStorage).
    function renderLocalTotal() {
        function lineSig(l) {
            const choices = (l.choices || []).map(c => String(c)).slice().sort();
            const addons = (l.addons || []).slice().sort((a, b) => String(a.menu_addon_id).localeCompare(String(b.menu_addon_id)))
                .map(a => a.menu_addon_id + 'x' + (parseInt(a.quantity, 10) || 1));
            return String(l.menu_item_id) + '|' + choices.join(',') + '|' + addons.join(',');
        }
        const grouped = cart.reduce((acc, item) => {
            const key = lineSig(item);
            const lineQty = parseInt(item.quantity, 10);
            const qty = isNaN(lineQty) || lineQty < 1 ? 1 : lineQty;
            if (!acc[key]) {
                acc[key] = { ...item, quantity: qty };
            } else {
                acc[key].quantity += qty;
            }
            return acc;
        }, {});

        let grandTotal = 0;
        Object.values(grouped).forEach(item => {
            const itemTotal = (parseFloat(item.price) || 0) * item.quantity;
            grandTotal += itemTotal;
        });

        totalAmount.textContent = `₱ ${isFinite(grandTotal) ? grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '0.00'}`;
    }
    renderLocalTotal();

    // H3: server-side total — fetch the signed order items (authoritative) and
    // use the server's line prices / total. Falls back to the local estimate.
    const orderId = localStorage.getItem('lastOrderID');
    if (orderId) {
        (async () => {
            try {
                const deviceId = (window.HOFDevice ? HOFDevice.id() : '');
                const itemsUrl = `${APP_ROOT}/backend/payments/get-payment-link.php`;
                const linkResp = await fetch(itemsUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ order_id: parseInt(orderId), ref: refNumber, purpose: 'items', device_id: deviceId })
                });
                const linkData = await linkResp.json();
                if (!(linkData.success && linkData.sig)) return;

                const itemsResp = await fetch('get_order_items.php?order_id=' + encodeURIComponent(orderId)
                    + '&ref=' + encodeURIComponent(refNumber) + '&sig=' + encodeURIComponent(linkData.sig));
                const itemsData = await itemsResp.json();
                if (!itemsData.success || !itemsData.items) return;

                let serverTotal = 0;
                itemsData.items.forEach(function (it) {
                    serverTotal += (parseFloat(it.price) || 0) * (parseInt(it.quantity, 10) || 0);
                });
                totalAmount.textContent = `₱ ${isFinite(serverTotal) ? serverTotal.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '0.00'}`;
            } catch (e) {
                // Keep the local estimate — the server re-prices at submit anyway.
            }
        })();
    }
}

// NEW: Pay with GCash QR (signed URL)
window.payWithGCashQR = function() {
    const orderId = localStorage.getItem('lastOrderID');
    const refNumber = localStorage.getItem('lastRefNumber');

    if (!orderId || !refNumber) {
        Swal.fire({ title: 'No Order', text: 'Please place an order first.', icon: 'warning', confirmButtonColor: '#FFB800' });
        return;
    }

    const deviceId = (window.HOFDevice ? HOFDevice.id() : '');

    fetch(`${APP_ROOT}/backend/payments/get-payment-link.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: parseInt(orderId), ref: refNumber, purpose: 'pay', device_id: deviceId })
    })
    .then(r => r.json())
    .then(data => {
        if (data.success && data.signed_url) {
            window.location.href = data.signed_url;
        } else {
            window.location.href = 'qr_payment.html?order_id=' + orderId + '&ref=' + refNumber;
        }
    })
    .catch(() => {
        window.location.href = 'qr_payment.html?order_id=' + orderId + '&ref=' + refNumber;
    });
};

window.downloadReceipt = function () {
    const receipt = document.querySelector('.status-container');
    if (!receipt || typeof html2canvas === 'undefined') {
        window.print();
        return;
    }

    // REQ-054 B4-E: downloadable image/PDF reusing the html2canvas pattern.
    html2canvas(receipt, { scale: 2, backgroundColor: '#FFFFFF' }).then(canvas => {
        const link = document.createElement('a');
        link.download = `HOF-Token-${localStorage.getItem('lastRefNumber') || 'Order'}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
    });
};

// REQ-054 B4-E: match the cashier receipt UI — a print window (80mm thermal).
window.printReceipt = function () {
    const receipt = document.querySelector('.status-container');
    if (!receipt) return;
    const win = window.open('', '_blank', 'width=400,height=600');
    if (!win) { Swal.fire('Print Error', 'Please allow pop-ups to print the receipt.', 'warning'); return; }
    win.document.write(`
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Receipt</title>
<style>
  @page { margin: 0; size: 80mm auto; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Courier New', monospace; font-size: 12px; color: #000; width: 80mm; padding: 10px; }
  .center { text-align: center; }
  .line { border-top: 1px dashed #000; margin: 6px 0; }
  .row { display: flex; justify-content: space-between; margin: 3px 0; }
</style></head><body>
<div class="center"><strong>HOUSE OF FRIES</strong><br><small>Tagoloan Branch</small></div>
<div class="line"></div>
`);
    win.document.write(receipt.innerHTML);
    win.document.write(`
<div class="line"></div>
<div class="center">Thank you for dining with us!</div>
<script>window.onload = function () { window.print(); }<` + `/script>
</body></html>`);
    win.document.close();
};

// REQ-054 B4-B: cash path CTA — confirms and sends the customer to the tracker.
window.confirmPayAtCounter = function () {
    const refNumber = localStorage.getItem('lastRefNumber');
    Swal.fire({
        icon: 'info',
        title: 'Proceed to the Cashier',
        text: 'Present Order #' + (refNumber || '') + ' at the counter to complete your payment.',
        confirmButtonText: 'Track My Order',
        confirmButtonColor: '#FFB800'
    }).then(() => {
        goToTracker();
    });
};

// REQ-054 B4-B (#23): "Open GCash" — redirects to the GCash app via the
// PayMongo hosted checkout URL (sandbox fallback to the payment page).
window.openGcashApp = function () {
    const orderId = localStorage.getItem('lastOrderID');
    const refNumber = localStorage.getItem('lastRefNumber');
    if (!orderId || !refNumber) {
        Swal.fire({ title: 'No Order', text: 'Please place an order first.', icon: 'warning', confirmButtonColor: '#FFB800' });
        return;
    }
    payWithGCashQR();
};

// REQ-054 B4-G: Pusher + 30s polling on checkout so a paid/updated order is
// reflected live (e.g. the cashier marking it paid while the customer watches).
function initPusher() {
    if (typeof Pusher === 'undefined') { setTimeout(initPusher, 500); return; }
    try {
        const pusher = new Pusher('a8860aca373dcc3400ce', { cluster: 'ap1' });
        const channel = pusher.subscribe('hof-orders');
        const lastOrderId = localStorage.getItem('lastOrderID');
        channel.bind('order-status-changed', function (data) {
            let payload = typeof data === 'string' ? JSON.parse(data) : data;
            if (typeof payload.data === 'string') payload = JSON.parse(payload.data);
            if (!lastOrderId || String(payload.order_id) !== String(lastOrderId)) return;
            if (payload.status === 'IN-PROGRESS') {
                markPaymentConfirmed({ pusher: true });
            }
        });
    } catch (e) { console.warn('Pusher init error:', e); }
}

// 30s polling fallback — belt-and-suspenders for dropped sockets.
setInterval(function () {
    const orderId = localStorage.getItem('lastOrderID');
    if (!orderId) return;
    fetch('../backend/payments/check-payment-status.php?order_id=' + encodeURIComponent(orderId))
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.success && data.paid) {
                const title = document.getElementById('paymentInstructionTitle');
                if (title && title.textContent !== 'Payment Confirmed ✓') {
                    markPaymentConfirmed(data);
                }
            }
        })
        .catch(function () {});
}, 30000);

// NEW: Single point of redirection into the live tracking portal
window.goToTracker = function () {
    const lastOrderID = localStorage.getItem('lastOrderID');
    if (lastOrderID) {
        window.location.href = 'orderTracker.html?order_id=' + lastOrderID;
    } else {
        window.location.href = 'orderTracker.html';
    }
};

// NEW: Edit Order — go back to customer.html with cart intact + persist as edit target
window.editOrder = function () {
    const lastOrderID = localStorage.getItem('lastOrderID');
    const lastRefNumber = localStorage.getItem('lastRefNumber');
    if (lastOrderID) {
        localStorage.setItem('editOrderId', lastOrderID);
        localStorage.setItem('editRefNumber', lastRefNumber);
        // REQ-050 C1: obtain the signed edit link (bound to this device) so the
        // update_existing_order.php ownership gate can be satisfied.
        const deviceId = (window.HOFDevice ? HOFDevice.id() : '');
        fetch(`${APP_ROOT}/backend/payments/get-payment-link.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order_id: parseInt(lastOrderID), ref: String(lastRefNumber), purpose: 'edit', device_id: deviceId })
        })
        .then(r => r.json())
        .then(data => {
            if (data.success && data.sig) {
                localStorage.setItem('editSig', data.sig);
            }
            window.location.href = 'customer.html';
        })
        .catch(() => {
            window.location.href = 'customer.html';
        });
    } else {
        window.location.href = 'customer.html';
    }
};

// NEW: Order Again — clear cart and go to customer.html
window.orderAgain = function () {
    localStorage.removeItem('cart');
    localStorage.removeItem('lastOrderID');
    localStorage.removeItem('lastRefNumber');
    if (window.clearMyTable) window.clearMyTable(); else { localStorage.removeItem('hof_my_table'); localStorage.removeItem('hof_my_table_verified_at'); }
    window.location.href = 'customer.html';
};

// NEW: Explicit payment choice
// REQ-054 B4-B: the method is now chosen on the cart page, so these helpers
// are removed. Kept as a no-op alias in case any stale inline handler fires.
window.choosePayment = function (method) {
    const cashCard = document.getElementById('cashInstructionCard');
    const gcashSection = document.getElementById('gcashSection');
    if (method === 'cash') {
        if (cashCard) cashCard.style.display = 'flex';
        if (gcashSection) gcashSection.style.display = 'none';
    } else {
        if (cashCard) cashCard.style.display = 'none';
        if (gcashSection) gcashSection.style.display = 'flex';
    }
};