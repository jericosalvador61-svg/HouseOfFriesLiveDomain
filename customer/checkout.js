document.addEventListener('DOMContentLoaded', () => {
    renderReceipt();

    const urlParams = new URLSearchParams(window.location.search);
    const orderId = urlParams.get('order_id');
    const returnSig = urlParams.get('sig');
    if (orderId) {
        verifyGcashPayment(orderId, returnSig);
    }
});

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
    if (editBtn) editBtn.style.display = 'none';
    if (payBtn) payBtn.style.display = 'none';
    if (orderAgainBtn) orderAgainBtn.style.display = 'flex';
    if (goTrackBtn) goTrackBtn.style.display = 'flex';

    // Update device registry
    const orderId = localStorage.getItem('lastOrderID');
    if (orderId && window.HOFDevice) {
        HOFDevice.updateStatus(orderId, 'IN-PROGRESS', true);
    }

    Swal.fire({
        icon: 'success',
        title: 'Payment Successful!',
        text: 'Your GCash payment was received. Your order is now being prepared in the kitchen.',
        confirmButtonColor: '#FFB800'
    });
}

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
    });
}

function renderReceipt() {
    // 1. Get the real data from localStorage
    const cart = JSON.parse(localStorage.getItem('cart')) || [];
    const refNumber = localStorage.getItem('lastRefNumber');

    // MATCHED KEY FIX: Pulling the table ID saved by customer.js
    const tableNumber = localStorage.getItem('currentTableId') || '--';

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

    // 3. Group items to accurately calculate the grand total price.
    //    REQ-040 lines carry their own `quantity`; legacy lines default to 1.
    //    Keyed by a config signature so two configurations of one item each
    //    keep their own (different) line price.
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
        const itemTotal = item.quantity * parseFloat(item.price);
        grandTotal += itemTotal;
    });

    totalAmount.textContent = `₱ ${grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
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

    fetch('/backend/payments/get-payment-link.php', {
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

    html2canvas(receipt, { scale: 2 }).then(canvas => {
        const link = document.createElement('a');
        link.download = `HOF-Token-${localStorage.getItem('lastRefNumber') || 'Order'}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
    });
};

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
    }
    window.location.href = 'customer.html';
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
window.choosePayment = function(method) {
    document.getElementById('paymentChoiceSection').style.display = 'none';
    if (method === 'cash') {
        document.getElementById('cashInstructionCard').style.display = 'flex';
    } else {
        document.getElementById('gcashSection').style.display = 'flex';
    }
};

window.switchToGCash = function() {
    document.getElementById('cashInstructionCard').style.display = 'none';
    document.getElementById('gcashSection').style.display = 'flex';
};

window.switchToCash = function() {
    document.getElementById('gcashSection').style.display = 'none';
    document.getElementById('cashInstructionCard').style.display = 'flex';
};