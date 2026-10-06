const APP_ROOT = (() => {
    try {
        const m = window.location.pathname.match(/^(.*?)(?:\/public|\/customer|\/backend|\/admin|\/cashier|\/inventoryStaff|\/kitchenStaff|\/waiter|\/supervisor)(?:\/|$)/i);
        return (m && m[1]) ? m[1].replace(/\/$/, '') : '';
    } catch (_) { return ''; }
})();
document.addEventListener('DOMContentLoaded', () => {
    loadPaymentPage();
});

let pollInterval = null;
let timerInterval = null;
let paymentConfirmed = false;
let orderId = null;
let refNumber = null;
let pageSig = null;
let checkSig = null;
let paymentAmount = 0;
const EXPIRY_SECONDS = 15 * 60;
const POLL_INTERVAL_MS = 30000; // REQ-063 #6: parity with the other customer pages (30s fallback; the QR page also has Pusher).
const MAX_POLL_ATTEMPTS = 100;

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

async function loadPaymentPage() {
    const params = new URLSearchParams(window.location.search);
    orderId = params.get('order_id');
    refNumber = params.get('ref');
    pageSig = params.get('sig');

    if (!orderId || !refNumber || !pageSig) {
        showError('Missing payment information. Redirecting...');
        setTimeout(() => { window.location.href = 'customer.html'; }, 2000);
        return;
    }

    const orderInfo = await fetchOrderInfo(orderId, refNumber, pageSig);
    if (!orderInfo) return;

    if (orderInfo.status === 'CANCELLED') {
        showCancelledState();
        return;
    }

    paymentAmount = parseFloat(orderInfo.total_amount) || 0;

    document.getElementById('displayRef').textContent = refNumber;
    document.getElementById('displayTotal').textContent = '₱' + paymentAmount.toFixed(2);
    document.getElementById('confirmRef').textContent = '#' + refNumber;
    document.getElementById('confirmTotal').textContent = '₱' + paymentAmount.toFixed(2);

    startTimer(EXPIRY_SECONDS);

    const hasExisting = orderInfo.payment_intent_id &&
        ['awaiting_payment_method', 'awaiting_next_action', 'processing'].includes(orderInfo.payment_intent_status);
    const isReturn = localStorage.getItem('hof_gcash_created') === '1';

    if (hasExisting) {
        localStorage.removeItem('hof_gcash_created');
        await resumePayment();
    } else if (isReturn) {
        localStorage.removeItem('hof_gcash_created');
        await resumePayment();
    } else {
        document.getElementById('confirmCard').classList.remove('hidden');
    }
}

async function fetchOrderInfo(id, ref, sig) {
    try {
        const deviceId = (window.HOFDevice ? HOFDevice.id() : '');
        const response = await fetch(
            `/backend/payments/get-payment-info.php?order_id=${id}&ref=${encodeURIComponent(ref)}&sig=${encodeURIComponent(sig)}&device_id=${encodeURIComponent(deviceId)}`
        );
        const data = await response.json();
        if (!data.success) {
            showError(data.message || 'Could not load order info');
            return null;
        }
        return data;
    } catch (err) {
        showError('Connection error. Please try again.');
        return null;
    }
}

async function resumePayment() {
    document.getElementById('confirmCard').classList.add('hidden');
    document.getElementById('qrCard').classList.remove('hidden');
    document.getElementById('statusIndicator').classList.remove('hidden');
    setStatus('Resuming payment session...', 'loading');

    try {
        const deviceId = (window.HOFDevice ? HOFDevice.id() : '');
        const response = await fetch(`${APP_ROOT}/backend/payments/create-qrph-payment.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                order_id: orderId,
                reference_number: refNumber,
                sig: pageSig,
                device_id: deviceId
            })
        });
        const data = await response.json();
        if (!data.success) {
            throw new Error(data.message || 'Failed to resume payment');
        }
        handlePaymentResponse(data);
    } catch (err) {
        console.error('Resume error:', err);
        showError(err.message || 'Could not resume payment. Please try again.');
    }
}

window.handlePayGcash = async function () {
    if (window._gcashProcessing) return;
    window._gcashProcessing = true;
    document.getElementById('confirmCard').classList.add('hidden');
    document.getElementById('qrCard').classList.remove('hidden');
    document.getElementById('statusIndicator').classList.remove('hidden');

    await createGCashPayment();
};

async function createGCashPayment() {
    setStatus('Contacting GCash...', 'loading');
    var btn = document.getElementById('btnPayGcash');
    if (btn) { btn.disabled = true; btn.textContent = 'Processing...'; }

    try {
        const deviceId = (window.HOFDevice ? HOFDevice.id() : '');
        const response = await fetch(`${APP_ROOT}/backend/payments/create-qrph-payment.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                order_id: orderId,
                reference_number: refNumber,
                sig: pageSig,
                device_id: deviceId
            })
        });
        const data = await response.json();
        if (!data.success) {
            throw new Error(data.message || 'Failed to create GCash payment');
        }

        localStorage.setItem('hof_gcash_created', '1');
        handlePaymentResponse(data);
    } catch (err) {
        console.error('GCash payment creation error:', err);
        showError(err.message || 'Could not create GCash payment. Please try again.');
        if (btn) { btn.disabled = false; btn.textContent = 'Pay with GCash'; }
    } finally {
        window._gcashProcessing = false;
    }
}

function handlePaymentResponse(data) {
    window._paymentIntentId = data.payment_intent_id;

    const qrSrc = data.qr_code_src;
    const redirectUrl = data.redirect_url;

    if (qrSrc) {
        showQRCode(qrSrc, redirectUrl);
        setStatus('QR Code ready — scan with GCash app', 'loading');
    } else {
        document.getElementById('qrWrapper').innerHTML =
            '<div class="qr-placeholder"><i class="fa-solid fa-wallet"></i>QR not available — use app button</div>';
        if (redirectUrl) {
            document.getElementById('stickyDownload').classList.remove('hidden');
            document.getElementById('btnPayApp').href = redirectUrl;
            document.getElementById('stickyDownload').querySelector('.btn-download').style.display = 'none';
        }
        setStatus('Opening GCash...', 'loading');
    }

    if (redirectUrl && !qrSrc) {
        window.location.href = redirectUrl;
    }

    obtainCheckSigThenPoll();
}

async function obtainCheckSigThenPoll() {
    try {
        const deviceId = (window.HOFDevice ? HOFDevice.id() : '');
        const resp = await fetch(`${APP_ROOT}/backend/payments/get-payment-link.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order_id: orderId, ref: refNumber, purpose: 'check', device_id: deviceId })
        });
        const data = await resp.json();
        if (data.success && data.sig) {
            checkSig = data.sig;
        } else {
            showError('Could not start payment verification. Please try again.');
            return;
        }
    } catch (err) {
        showError('Could not start payment verification. Please try again.');
        return;
    }
    startPolling();
}

function showQRCode(qrSrc, redirectUrl) {
    const img = document.getElementById('qrImage');
    const placeholder = document.getElementById('qrPlaceholder');
    const sticky = document.getElementById('stickyDownload');
    const btnPay = document.getElementById('btnPayApp');
    const btnDl = document.getElementById('btnDownload');

    img.src = qrSrc;
    img.style.display = 'block';
    img.alt = 'GCash QR Code';
    placeholder.style.display = 'none';

    if (redirectUrl) {
        btnPay.href = redirectUrl;
    } else {
        btnPay.style.display = 'none';
    }

    btnDl.href = qrSrc;
    btnDl.download = 'HOF-' + refNumber + '-qr.png';
    sticky.classList.remove('hidden');
}

function startPolling() {
    if (pollInterval) clearInterval(pollInterval);
    let attempts = 0;

    // REQ-064: single poll body — used by BOTH the 30s interval and the
    // instant Pusher 'new-order' trigger (webhook confirmation).
    const pollOnce = async () => {
        if (paymentConfirmed || attempts >= MAX_POLL_ATTEMPTS) {
            clearInterval(pollInterval);
            if (attempts >= MAX_POLL_ATTEMPTS) {
                showError('Payment verification timed out. Please try again.');
            }
            return;
        }
        attempts++;

        try {
            const deviceId = (window.HOFDevice ? HOFDevice.id() : '');
            let checkUrl = `/backend/payments/check-payment-status.php?order_id=${orderId}&device_id=${encodeURIComponent(deviceId)}`;
            if (checkSig) {
                checkUrl += '&sig=' + encodeURIComponent(checkSig);
            }
            const response = await fetch(checkUrl, { headers: {} });
            const data = await response.json();

            if (data.success && data.paid) {
                paymentConfirmed = true;
                clearInterval(pollInterval);
                clearInterval(timerInterval);
                setStatus('Payment Confirmed! ✓', 'paid');
                showSuccess();
                return;
            }

            if (data.late_payment) {
                clearInterval(pollInterval);
                setStatus('Late payment recorded — see cashier', 'late');
                showError('Payment was received after order expired. Please see the cashier.');
                return;
            }

            if (data.paid === false && data.status === 'FAILED') {
                clearInterval(pollInterval);
                setStatus('Payment Failed', 'failed');
                // REQ-054 B4-A (#13): a cancelled/failed GCash session must NOT
                // block the cash path. The server already cleared the stale
                // intent; here we flip the stored method to cash and offer the
                // customer a clean way to pay at the counter.
                localStorage.setItem('payment_method', 'CASH');
                Swal.fire({
                    icon: 'warning',
                    title: 'GCash Payment Not Completed',
                    text: 'You can try GCash again or pay with cash at the counter.',
                    confirmButtonText: 'Pay at Counter',
                    confirmButtonColor: '#FFB800',
                    showCancelButton: true,
                    cancelButtonText: 'Try GCash Again',
                    cancelButtonColor: '#0056E3',
                    allowOutsideClick: false
                }).then(function (result) {
                    if (result.isConfirmed) {
                        window.location.href = 'checkout.html';
                    } else {
                        window.location.reload();
                    }
                });
                return;
            }

            setStatus('Verifying your payment...', 'loading');
        } catch (err) {
            console.warn('Poll error:', err);
        }
    };

    // Also use Pusher for instant payment confirmation
    try {
        if (typeof Pusher !== 'undefined') {
            const pusher = new Pusher('a8860aca373dcc3400ce', {
                cluster: 'ap1',
                forceTLS: (window.location.protocol === 'https:')
            });
            const channel = pusher.subscribe('hof-orders');
            // REQ-064: the GCash webhook (paymongo-webhook.php) broadcasts only
            // 'new-order' (2-arg, no status) — without this binding the customer
            // waits up to 30s (poll) even though the socket already told us.
            channel.bind('new-order', function(data) {
                if (String(data.order_id) === String(orderId)) {
                    pollOnce();
                }
            });
            channel.bind('order-status-changed', function(data) {
                if (data.order_id == orderId && data.status === 'IN-PROGRESS') {
                    paymentConfirmed = true;
                    clearInterval(pollInterval);
                    clearInterval(timerInterval);
                    setStatus('Payment Confirmed! ✓', 'paid');
                    showSuccess();
                }
            });
        }
    } catch (e) { console.warn('Pusher init error:', e); }

    pollInterval = setInterval(pollOnce, POLL_INTERVAL_MS);
}

function startTimer(seconds) {
    const display = document.getElementById('timerDisplay');
    const section = document.getElementById('timerSection');
    let remaining = seconds;

    timerInterval = setInterval(() => {
        remaining--;
        const mins = Math.floor(remaining / 60);
        const secs = remaining % 60;
        display.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

        if (remaining <= 180) {
            section.classList.add('warning');
        }
        if (remaining <= 0) {
            clearInterval(timerInterval);
            clearInterval(pollInterval);
            display.textContent = '00:00';
            showError('Payment time has expired. Please try again.');
        }
    }, 1000);
}

function setStatus(text, type) {
    const indicator = document.getElementById('statusIndicator');
    const statusText = document.getElementById('statusText');
    if (indicator) {
        indicator.className = 'status-indicator show ' + (type || 'loading');
    }
    if (statusText) {
        statusText.textContent = text;
    }
}

function showError(message) {
    document.getElementById('errorText').textContent = message;
    document.getElementById('errorBox').classList.add('show');
    const si = document.getElementById('statusIndicator');
    if (si) si.classList.remove('show');
}

function showCancelledState() {
    document.getElementById('confirmCard').classList.add('hidden');
    document.getElementById('qrCard').classList.add('hidden');
    document.getElementById('statusIndicator').classList.remove('hidden');
    setStatus('Order expired — please see the cashier', 'cancelled');
    document.getElementById('btnPayGcash').disabled = true;
}

window.goBack = function () {
    clearInterval(pollInterval);
    clearInterval(timerInterval);
    localStorage.removeItem('hof_gcash_created');
    window.location.href = 'checkout.html';
};

function showSuccess() {
    if (window.HOFDevice) {
        HOFDevice.updateStatus(orderId, 'IN-PROGRESS', true);
    }

    // REQ-054 B1: payment confirmed — the cart is spent, clear it + badge.
    // Keep lastOrderID/lastRefNumber for the tracker.
    clearCartAndBadge();
    // REQ-054 B4-A (#14): a paid order must never leave a stale cart badge,
    // and the successful payment path records the method for downstream pages.
    localStorage.removeItem('cart');
    localStorage.setItem('payment_method', 'GCASH');

    Swal.fire({
        icon: 'success',
        title: 'Payment Successful!',
        text: 'Your order is now being prepared in the kitchen.',
        confirmButtonColor: '#FFB800',
        timer: 4000,
        timerProgressBar: true,
        showConfirmButton: false
    }).then(() => {
        window.location.href = 'orderTracker.html?order_id=' + orderId;
    });

    setTimeout(() => {
        window.location.href = 'orderTracker.html?order_id=' + orderId;
    }, 4000);
}