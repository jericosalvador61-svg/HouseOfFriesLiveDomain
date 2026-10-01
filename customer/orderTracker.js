const APP_ROOT = (() => {
    try {
        const m = window.location.pathname.match(/^(.*?)(?:\/public|\/customer|\/backend|\/admin|\/cashier|\/inventoryStaff|\/kitchenStaff|\/waiter|\/supervisor)(?:\/|$)/i);
        return (m && m[1]) ? m[1].replace(/\/$/, '') : '';
    } catch (_) { return ''; }
})();
const audioNotification = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
let hasPlayedReadySound = false;
let trackedOrders = [];
let pusherChannel = null;
let pollingFallbackInterval = null;
const trackSigs = {};
const itemsSigs = {};

function escapeHtml(text) {
  if (!text) return '';
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

function formatCountdown(seconds) {
    var m = Math.floor(seconds / 60);
    var s = seconds % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

// ============================================================
// PREP COUNTDOWN (mirrors the kitchen ledger)
// ------------------------------------------------------------
// The kitchen stores MINUTES STILL TO COOK in
// orders.total_estimated_prep_time and stamps cooking_started_at once.
// The customer reproduces the same arithmetic locally, so a 30s poll still
// gives a smooth per-second display and the number always matches the KDS.
// ============================================================
const prepTimers = {};

function clearPrepTimer(orderId) {
    if (prepTimers[orderId]) {
        clearInterval(prepTimers[orderId]);
        delete prepTimers[orderId];
    }
}

function startPrepCountdown(orderId, prepRemaining, startedEpoch, prepTotal) {
    clearPrepTimer(orderId);
    if (!startedEpoch) return;

    var totalSeconds = Math.max(0, (parseInt(prepRemaining, 10) || 0) * 60);
    var startedMs = parseInt(startedEpoch, 10) * 1000;

    function paint() {
        var el = document.getElementById('prepTimer-' + orderId);
        if (!el) { clearPrepTimer(orderId); return; }

        var elapsed = Math.floor((Date.now() - startedMs) / 1000);
        var remaining = Math.max(0, totalSeconds - elapsed);

        el.textContent = formatCountdown(remaining);

        // Colour against the ORIGINAL estimate so urgency only ever increases.
        var original = Math.max(1, (parseInt(prepTotal, 10) || 0) * 60);
        var ratio = remaining / original;
        el.style.color = ratio <= 0.25 ? '#dc3545' : (ratio <= 0.5 ? '#f0ad4e' : '#28a745');

        var label = document.getElementById('prepTimerLabel-' + orderId);
        if (label) {
            label.textContent = (parseInt(prepRemaining, 10) || 0) <= 0
                ? 'All your dishes are done - almost ready!'
                : 'Estimated time left';
        }
    }

    paint();
    prepTimers[orderId] = setInterval(paint, 1000);
}

function handleOrderCancelled(orderId) {
    clearCountdownTimer(orderId);
    window.clearMyTable();
    Swal.fire({
        icon: 'warning',
        title: 'Order Expired',
        text: 'Your order was cancelled because payment wasn\'t completed in time.',
        confirmButtonText: 'Order Again',
        showCancelButton: true,
        cancelButtonText: 'Close',
        confirmButtonColor: '#FFB800'
    }).then(function(result) {
        if (result.isConfirmed) {
            localStorage.removeItem('cart');
            window.location.href = 'customer.html';
        }
    });
}

function clearCountdownTimer(orderId) {
    if (window._countdownTimers && window._countdownTimers[orderId]) {
        clearInterval(window._countdownTimers[orderId]);
        delete window._countdownTimers[orderId];
    }
}

window.clearMyTable = function() {
    localStorage.removeItem('hof_my_table');
    localStorage.removeItem('hof_my_table_verified_at');
};

document.addEventListener('DOMContentLoaded', () => {
    initTracker();
    setupMobileAudioUnlock();
});

function setupMobileAudioUnlock() {
    const unlockAudio = () => {
        audioNotification.play()
            .then(() => {
                audioNotification.pause();
                audioNotification.currentTime = 0;
                document.removeEventListener('click', unlockAudio);
                document.removeEventListener('touchstart', unlockAudio);
            })
            .catch(() => {});
    };
    document.addEventListener('click', unlockAudio);
    document.addEventListener('touchstart', unlockAudio);
}

function initTracker() {
    const urlParams = new URLSearchParams(window.location.search);
    const singleOrderId = urlParams.get('order_id');

    if (singleOrderId) {
        trackedOrders = [parseInt(singleOrderId)];
    } else {
        window.location.href = 'orderHistory.html';
        return;
    }

    // Also add from HOFDevice as backup
    if (window.HOFDevice) {
        var deviceOrders = HOFDevice.orders();
        deviceOrders.forEach(function(o) {
            var oid = parseInt(o.order_id);
            if (!trackedOrders.includes(oid)) {
                trackedOrders.push(oid);
            }
        });
    }

    if (trackedOrders.length === 0) {
        const container = document.getElementById('trackerContainer');
        container.innerHTML = '<div class="text-center py-5 text-muted"><p>No orders to track. Place an order first.</p><button id="emptyTrackerBtn" class="btn btn-warning mt-3">Start Ordering</button></div>';
        setTimeout(() => {
          const btn = document.getElementById('emptyTrackerBtn');
          if (btn) btn.addEventListener('click', function () { location.href = 'customer.html'; });
        }, 0);
        return;
    }

    // Multi-order dropdown: if HOFDevice has >1 order, show a selector
    if (window.HOFDevice) {
        const deviceOrders = HOFDevice.orders();
        if (deviceOrders.length > 1) {
            renderOrderSelector(deviceOrders, singleOrderId);
        }
    }

    // Fetch all orders + render
    if (singleOrderId) {
        Promise.all([
            obtainTrackSig(singleOrderId),
            obtainItemsSig(singleOrderId)
        ]).then(([track, items]) => {
            trackSigs[singleOrderId] = track;
            itemsSigs[singleOrderId] = items;
            trackedOrders.forEach(id => fetchAndRenderOrder(id));
        }).catch(() => {
            trackedOrders.forEach(id => fetchAndRenderOrder(id));
        });
    } else {
        trackedOrders.forEach(id => fetchAndRenderOrder(id));
    }

    // Pusher bind for any tracked order
    if (typeof Pusher !== 'undefined') {
        const pusher = new Pusher('a8860aca373dcc3400ce', { cluster: 'ap1' });
        pusherChannel = pusher.subscribe('hof-orders');

        pusherChannel.bind('new-order', function (data) {
            let payload = typeof data === 'string' ? JSON.parse(data) : data;
            if (typeof payload.data === 'string') payload = JSON.parse(payload.data);
            if (payload.order_id && trackedOrders.includes(parseInt(payload.order_id))) {
                fetchAndRenderOrder(payload.order_id);
            }
        });

        pusherChannel.bind('order-status-changed', function (data) {
            let payload = typeof data === 'string' ? JSON.parse(data) : data;
            if (typeof payload.data === 'string') payload = JSON.parse(payload.data);
            if (payload.order_id && trackedOrders.includes(parseInt(payload.order_id))) {
                if (payload.status === 'CANCELLED') {
                    handleOrderCancelled(payload.order_id);
                } else {
                    updateSingleCard(payload.order_id, payload.status);
                }
            }
        });
    }

    // Polling fallback (REQ-016 + REQ-042): always re-fetch every 30s as belt-and-suspenders
    if (pollingFallbackInterval) clearInterval(pollingFallbackInterval);
    pollingFallbackInterval = setInterval(() => {
        trackedOrders.forEach(id => fetchAndRenderOrder(id));
    }, 30000);
}

async function fetchAndRenderOrder(orderId) {
    try {
        let statusUrl = 'get_order_status.php?order_id=' + orderId;
        const trackSig = trackSigs[orderId];
        if (trackSig) {
            statusUrl += '&sig=' + encodeURIComponent(trackSig);
        }
        let itemsUrl = 'get_order_items.php?order_id=' + orderId;
        const itemsSig = itemsSigs[orderId];
        if (itemsSig) {
            let ref = orderId;
            if (window.HOFDevice) {
                const o = HOFDevice.orders().find(x => x.order_id == orderId);
                if (o && o.ref) ref = o.ref;
            }
            itemsUrl += '&ref=' + encodeURIComponent(String(ref)) + '&sig=' + encodeURIComponent(itemsSig);
        }
        const [statusResp, itemsResp] = await Promise.all([
            fetch(statusUrl),
            fetch(itemsUrl)
        ]);

        let status = 'PENDING';
        let itemsData = null;
        let prepMinutes = 0;
        let prep = null;
        let paid = false;

        if (statusResp.ok) {
            const data = await statusResp.json();
            status = data && data.status ? data.status : 'PENDING';
            if (data) {
                paid = !!data.paid;
                prep = {
                    remaining: data.prep_remaining,
                    total: data.prep_estimate_total,
                    startedEpoch: data.cooking_started_epoch,
                    started: !!data.prep_started,
                    orderedAt: data.ordered_at || null
                };
            }
        }

        if (itemsResp.ok) {
            itemsData = await itemsResp.json();
            if (itemsData && itemsData.total_prep_minutes) {
                prepMinutes = itemsData.total_prep_minutes;
            }
            // L2: prefer the server's authoritative ordered_at for the 15-min
            // auto-cancel countdown anchor over any localStorage value.
            if (itemsData && itemsData.ordered_at) {
                window._orderedAtAnchor = itemsData.ordered_at;
            }
        }

        renderOrderCard(orderId, status, itemsData, prepMinutes, prep, paid);
    } catch (error) {
        console.error("Error fetching order", orderId, error);
        renderOrderCard(orderId, 'PENDING', null, 0);
    }
}

function renderOrderCard(orderId, status, itemsData, prepMinutes, prep, paid) {
    const container = document.getElementById('orderCardsContainer');
    if (!container) return;

    // Get order from device registry
    let ref = orderId;
    let tableLabel = '';
    // paid comes from the server payload (B1-1). Fall back to the local
    // device registry only if the server didn't tell us.
    let paidLocal = false;
    if (paid === undefined) {
        if (window.HOFDevice) {
            const order = HOFDevice.orders().find(o => o.order_id == orderId);
            if (order) paidLocal = order.paid;
        }
        paid = paidLocal;
    }
    if (window.HOFDevice) {
        const order = HOFDevice.orders().find(o => o.order_id == orderId);
        if (order) {
            ref = order.ref || orderId;
            tableLabel = order.table_number ? 'Table ' + order.table_number : 'Takeout';
        }
    }

    // Check if card already exists
    let card = document.getElementById('trackerCard-' + orderId);
    if (!card) {
        // Build items list HTML
        let itemsHtml = '';
        let itemsCollapsed = true;
        let totalAmount = 0;
        if (itemsData && itemsData.items && itemsData.items.length > 0) {
            const grouped = {};
            itemsData.items.forEach(item => {
                const key = item.menu_item_id;
                if (!grouped[key]) {
                    grouped[key] = { ...item, qty: 1 };
                } else {
                    grouped[key].qty += 1;
                }
            });
            itemsHtml = Object.values(grouped).map(item => {
                const name = escapeHtml(item.item_name);
                const instructions = escapeHtml(item.special_instructions);
                const lineTotal = (parseFloat(item.price) * item.qty).toFixed(2);
                totalAmount += parseFloat(lineTotal);
                // Kitchen has already ticked this dish off.
                const done = !!item.is_prepared;
                return `<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--border-color);font-size:13px;${done ? 'opacity:.55;' : ''}">
                  <div style="flex:1;">${done ? '<i class="fa-solid fa-circle-check" style="color:#28a745;margin-right:6px;"></i>' : ''}<strong style="${done ? 'text-decoration:line-through;' : ''}">${name} <span style="color:var(--text-muted);">× ${item.qty}</span></strong>
                  ${instructions ? `<br><span style="font-size:11px;color:var(--text-muted);font-style:italic;">"${instructions}"</span>` : ''}
                  </div>
                  <span style="font-weight:600;white-space:nowrap;margin-left:12px;">₱${lineTotal}</span>
                </div>`;
            }).join('');
            totalAmount = totalAmount.toFixed(2);
        }

        // (the prep block below replaces the old static "prepLine" text)

        // Prep-time block: live countdown once the kitchen is cooking,
        // otherwise the static estimate from the menu.
        const isCookingNow = status === 'COOKING';
        const ledgerTotal = (prep && prep.total) ? prep.total : prepMinutes;
        const ledgerRemaining = prep ? prep.remaining : null;

        let prepBlock = '';
        if (isCookingNow && prep && prep.startedEpoch) {
            prepBlock =
                '<div style="margin:14px 0 6px 0;padding:12px;border:1px solid var(--border-color);border-radius:12px;text-align:center;">' +
                    '<div style="font-size:11px;letter-spacing:.5px;text-transform:uppercase;color:var(--text-muted);" id="prepTimerLabel-' + orderId + '">Estimated time left</div>' +
                    '<div id="prepTimer-' + orderId + '" style="font-size:2rem;font-weight:700;font-variant-numeric:tabular-nums;line-height:1.2;">--:--</div>' +
                    '<div style="font-size:11px;color:var(--text-muted);">of ~' + ledgerTotal + ' min kitchen estimate</div>' +
                '</div>';
        } else if (prepMinutes > 0) {
            prepBlock =
                '<p style="font-size:12px;color:var(--text-muted);margin:4px 0 0 0;font-style:italic;">' +
                     '<i class="fa-solid fa-clock"></i> Estimated ready in about ~' + prepMinutes + ' minute' + (prepMinutes !== 1 ? 's' : '') + ' — starts counting once the kitchen begins cooking.' +
                 '</p>';
        }

        const cardHtml = `
            <div class="tracker-card mb-4" id="trackerCard-${orderId}" data-order-id="${orderId}">
                <div class="order-id-badge" id="trackRefNum-${orderId}">Order ID: #${ref}</div>
                ${tableLabel ? '<div class="text-muted small mb-2">' + tableLabel + '</div>' : ''}
                ${status === 'PENDING' && !paid ? '<div class="countdown-bar" id="countdown-' + orderId + '"><span class="countdown-label">Auto-cancels in:</span> <span class="countdown-timer" id="timer-' + orderId + '">15:00</span></div>' : ''}
                ${status === 'PENDING' && paid ? '<div class="countdown-bar" style="background:rgba(40,167,69,0.12);border-color:#28a745;color:#28a745;" id="countdown-' + orderId + '"><span class="countdown-label">Payment received</span> — order queued for kitchen</div>' : ''}
                <div class="status-visual status-pending" id="statusVisualRing-${orderId}">
                    <i class="fa-solid fa-hourglass-half" id="statusMainIcon-${orderId}"></i>
                </div>
                <h2 id="statusHeadline-${orderId}">Order Pending</h2>
                <p class="desc" id="statusMessage-${orderId}">Loading...</p>
                ${prepBlock}
                <hr style="border:0;border-top:1px solid var(--border-color);margin:20px 0;">
                <div class="steps-wrapper">
                    <div class="step-row" id="stepPending-${orderId}">
                        <div class="step-icon"><i class="fa-solid fa-circle-dot" id="iconPending-${orderId}"></i></div>
                        <div class="step-text"><h4>Awaiting Payment</h4><p>Present order token to cashier</p></div>
                    </div>
                    <div class="step-row" id="stepPreparing-${orderId}">
                        <div class="step-icon"><i class="fa-solid fa-fire-burner" id="iconPreparing-${orderId}"></i></div>
                        <div class="step-text"><h4>Payment Confirmed</h4><p>Order queued for kitchen</p></div>
                    </div>
                    <div class="step-row" id="stepCooking-${orderId}">
                        <div class="step-icon"><i class="fa-solid fa-utensils" id="iconCooking-${orderId}"></i></div>
                        <div class="step-text"><h4>Cooking</h4><p>Kitchen is preparing your order</p></div>
                    </div>
                    <div class="step-row" id="stepReady-${orderId}">
                        <div class="step-icon"><i class="fa-solid fa-check" id="iconReady-${orderId}"></i></div>
                        <div class="step-text"><h4>Order Complete</h4><p>Ready for collection</p></div>
                    </div>
                </div>
                ${itemsHtml ? `<div class="items-block" id="itemsBlock-${orderId}">
                  <button class="btn-view-order" id="btnViewOrder-${orderId}" onclick="toggleViewOrder(${orderId})" type="button">
                    <span><i class="fa-regular fa-rectangle-list"></i> View My Order</span>
                    <span id="viewOrderIcon-${orderId}"><i class="fa-solid fa-chevron-down"></i></span>
                  </button>
                  <div id="viewOrderBody-${orderId}" class="view-order-body" style="display:none;">
                    ${itemsHtml}
                    <div class="view-order-total">
                      <span>Total</span>
                      <span>₱${totalAmount}</span>
                    </div>
                  </div>
                </div>` : ''}
                <div class="actions-stack" id="trackerActions-${orderId}"></div>
            </div>`;
        container.insertAdjacentHTML('beforeend', cardHtml);

        // Start the prep countdown for this order (kitchen is cooking).
        if (isCookingNow && prep && prep.startedEpoch) {
            startPrepCountdown(orderId, ledgerRemaining, prep.startedEpoch, ledgerTotal);
        } else {
            clearPrepTimer(orderId);
        }

        // Start countdown for PENDING unpaid orders
        if (status === 'PENDING' && !paid) {
            var created = new Date();
            // Use ordered_at if available (L2): anchor to the server's
            // authoritative order timestamp, not local device time.
            if (prep && prep.orderedAt) {
                created = new Date(prep.orderedAt);
            } else if (itemsData && itemsData.ordered_at) {
                created = new Date(itemsData.ordered_at);
            }
            var expires = new Date(created.getTime() + 15 * 60 * 1000);
            var now = new Date();
            var remaining = Math.max(0, Math.floor((expires - now) / 1000));

            if (remaining > 0 && !window._countdownTimers) window._countdownTimers = {};
            if (!window._countdownTimers[orderId]) {
                window._countdownTimers[orderId] = setInterval(function() {
                    var rem = Math.max(0, Math.floor((expires - new Date()) / 1000));
                    var el = document.getElementById('timer-' + orderId);
                    if (el) el.textContent = formatCountdown(rem);
                    if (rem <= 0) {
                        clearInterval(window._countdownTimers[orderId]);
                        delete window._countdownTimers[orderId];
                        handleOrderCancelled(orderId);
                    }
                }, 1000);
            }
        }
    }

    // Store items data on card for later access
    const cardEl = document.getElementById('trackerCard-' + orderId);
    if (cardEl) {
        cardEl._itemsData = itemsData;
        cardEl._prepMinutes = prepMinutes;
    }

    // The card is only built once, so on later polls we must refresh the
    // running countdown in place: the anchor never moves, but the kitchen may
    // have ticked dishes off and shortened the remaining budget.
    if (isCookingNow && prep && prep.startedEpoch) {
        if (!document.getElementById('prepTimer-' + orderId)) {
            const holder = cardEl || document.getElementById('orderCardsContainer');
            if (holder) {
                holder.insertAdjacentHTML('afterbegin',
                    '<div style="margin:14px 0 6px 0;padding:12px;border:1px solid var(--border-color);border-radius:12px;text-align:center;">' +
                        '<div style="font-size:11px;letter-spacing:.5px;text-transform:uppercase;color:var(--text-muted);" id="prepTimerLabel-' + orderId + '">Estimated time left</div>' +
                        '<div id="prepTimer-' + orderId + '" style="font-size:2rem;font-weight:700;font-variant-numeric:tabular-nums;line-height:1.2;">--:--</div>' +
                        '<div style="font-size:11px;color:var(--text-muted);">of ~' + ledgerTotal + ' min kitchen estimate</div>' +
                    '</div>');
            }
        }
        startPrepCountdown(orderId, ledgerRemaining, prep.startedEpoch, ledgerTotal);
    } else {
        clearPrepTimer(orderId);
    }

    updateTrackerUI(orderId, status, paid);
}

function updateSingleCard(orderId, status) {
    let paid = false;
    if (window.HOFDevice) {
        const order = HOFDevice.orders().find(o => o.order_id == orderId);
        paid = order ? order.paid : false;
    }
    updateTrackerUI(orderId, status, paid);
}

function updateTrackerUI(orderId, status, paid) {
    const visualRing = document.getElementById('statusVisualRing-' + orderId);
    const mainIcon = document.getElementById('statusMainIcon-' + orderId);
    const headline = document.getElementById('statusHeadline-' + orderId);
    const message = document.getElementById('statusMessage-' + orderId);
    const actionsContainer = document.getElementById('trackerActions-' + orderId);
    if (!headline) return;

    const stepPending = document.getElementById('stepPending-' + orderId);
    const stepPreparing = document.getElementById('stepPreparing-' + orderId);
    const stepCooking = document.getElementById('stepCooking-' + orderId);
    const stepReady = document.getElementById('stepReady-' + orderId);
    const iconPending = document.getElementById('iconPending-' + orderId);
    const iconPreparing = document.getElementById('iconPreparing-' + orderId);
    const iconCooking = document.getElementById('iconCooking-' + orderId);
    const iconReady = document.getElementById('iconReady-' + orderId);

    if (visualRing) visualRing.className = 'status-visual';
    if (headline) headline.style.color = '';

    const currentStatus = status.toUpperCase();

    // Clear countdown timer if order is no longer PENDING unpaid
    if (currentStatus !== 'PENDING' || paid) {
        clearCountdownTimer(orderId);
    }

    if (currentStatus !== 'READY' && currentStatus !== 'COMPLETED' && currentStatus !== 'CANCELLED') {
        hasPlayedReadySound = false;
    }

    function resetSteps() {
        if (stepPending) { stepPending.className = 'step-row'; iconPending.className = 'fa-solid fa-circle-dot'; }
        if (stepPreparing) { stepPreparing.className = 'step-row'; iconPreparing.className = 'fa-solid fa-fire-burner'; }
        if (stepCooking) { stepCooking.className = 'step-row'; iconCooking.className = 'fa-solid fa-utensils'; }
        if (stepReady) { stepReady.className = 'step-row'; iconReady.className = 'fa-solid fa-check'; }
    }

    // Build actions
    let actionsHtml = '';
    const isLocked = paid || ['IN-PROGRESS','PREPARING','COOKING','COMPLETED','READY','SERVED'].includes(currentStatus);

    if (currentStatus === 'CANCELLED') {
        window.clearMyTable();
        if (visualRing) visualRing.className = 'status-visual';
        if (visualRing) visualRing.style.background = 'rgba(255,59,48,0.1)';
        if (mainIcon) mainIcon.className = 'fa-solid fa-circle-xmark';
        if (mainIcon) mainIcon.style.color = '#FF3B30';
        if (headline) { headline.textContent = 'Order Cancelled'; headline.style.color = '#FF3B30'; }
        if (message) message.textContent = 'Cancelled — not paid within 15 minutes. Please place a new order.';
        resetSteps();
        actionsHtml = '<button class="btn-action-large btn-action-yellow" onclick="location.href=\'customer.html\'"><i class="fa-solid fa-plus"></i> Order Again</button>';
    } else if (currentStatus === 'PENDING') {
        if (visualRing) { visualRing.className = 'status-visual status-pending'; if (mainIcon) mainIcon.className = 'fa-solid fa-hourglass-half'; }
        if (headline) headline.textContent = 'Order Pending';
        if (message) message.textContent = paid ? 'Payment received! Waiting for kitchen to start.' : 'Your order has been logged! Please head to the counter cashier to settle your payment so processing can begin.';
        resetSteps();
        if (paid) {
            if (stepPending) { stepPending.className = 'step-row completed'; iconPending.className = 'fa-solid fa-circle-check'; }
            if (stepPreparing) { stepPreparing.className = 'step-row active'; iconPreparing.className = 'fa-solid fa-fire-burner'; }
        } else {
            if (stepPending) { stepPending.className = 'step-row active'; iconPending.className = 'fa-solid fa-circle-dot'; }
        }
        if (!paid) {
                actionsHtml = '<button class="btn-action-large btn-action-yellow" onclick="resumeGcashPayment(' + orderId + ')"><i class="fa-solid fa-qrcode"></i> Pay with GCash</button>';
        } else {
            actionsHtml = '<button class="btn-action-large btn-action-outline" onclick="location.href=\'orderTracker.html\'"><i class="fa-solid fa-rotate"></i> Refresh</button>';
        }
    } else if (currentStatus === 'IN-PROGRESS' || currentStatus === 'PREPARING') {
        if (visualRing) { visualRing.className = 'status-visual status-preparing'; if (mainIcon) mainIcon.className = 'fa-solid fa-fire-burner fa-spin'; }
        if (headline) { headline.textContent = 'In Progress'; headline.style.color = '#FFB800'; }
        if (message) message.textContent = 'Payment Confirmed! Your order is being prepared.';
        resetSteps();
        if (stepPending) { stepPending.className = 'step-row completed'; iconPending.className = 'fa-solid fa-circle-check'; }
        if (stepPreparing) { stepPreparing.className = 'step-row active'; iconPreparing.className = 'fa-solid fa-fire-burner fa-bounce'; }
        actionsHtml = '<div style="display:flex;flex-direction:column;gap:8px;"><button class="btn-action-large btn-action-outline" disabled style="opacity:0.6;"><i class="fa-solid fa-lock"></i> Locked — cannot edit</button><button class="btn-action-large btn-action-yellow" onclick="localStorage.removeItem(\'cart\');localStorage.removeItem(\'lastOrderID\');localStorage.removeItem(\'lastRefNumber\');location.href=\'customer.html\';"><i class="fa-solid fa-plus"></i> Order Again</button><button class="btn-action-large btn-action-outline" onclick="window.viewReceipt(' + orderId + ')"><i class="fa-solid fa-receipt"></i> View Receipt</button></div>';
    } else if (currentStatus === 'COOKING') {
        if (visualRing) { visualRing.className = 'status-visual'; if (mainIcon) mainIcon.className = 'fa-solid fa-utensils fa-spin'; visualRing.style.background = 'rgba(255,184,0,0.15)'; }
        if (headline) { headline.textContent = 'Cooking'; headline.style.color = '#FFB800'; }
        if (message) message.textContent = 'The kitchen is actively preparing your order!';
        resetSteps();
        if (stepPending) { stepPending.className = 'step-row completed'; iconPending.className = 'fa-solid fa-circle-check'; }
        if (stepPreparing) { stepPreparing.className = 'step-row completed'; iconPreparing.className = 'fa-solid fa-circle-check'; }
        if (stepCooking) { stepCooking.className = 'step-row active'; iconCooking.className = 'fa-solid fa-utensils fa-bounce'; }
        actionsHtml = '<div style="display:flex;flex-direction:column;gap:8px;"><button class="btn-action-large btn-action-outline" disabled style="opacity:0.6;"><i class="fa-solid fa-lock"></i> Locked — cannot edit</button><button class="btn-action-large btn-action-yellow" onclick="localStorage.removeItem(\'cart\');localStorage.removeItem(\'lastOrderID\');localStorage.removeItem(\'lastRefNumber\');location.href=\'customer.html\';"><i class="fa-solid fa-plus"></i> Order Again</button><button class="btn-action-large btn-action-outline" onclick="window.viewReceipt(' + orderId + ')"><i class="fa-solid fa-receipt"></i> View Receipt</button></div>';
    } else if (currentStatus === 'READY' || currentStatus === 'COMPLETED' || currentStatus === 'SERVED') {
        window.clearMyTable();
        if (visualRing) { visualRing.className = 'status-visual status-ready'; if (mainIcon) mainIcon.className = 'fa-solid fa-circle-check'; }
        if (headline) { headline.textContent = currentStatus === 'SERVED' ? 'Served! 🎉' : 'Order Complete! 🎉'; headline.style.color = '#008444'; }
        if (message) message.innerHTML = '<strong>Your food is ready!</strong> Please proceed to the pickup counter.';
        resetSteps();
        if (stepPending) { stepPending.className = 'step-row completed'; iconPending.className = 'fa-solid fa-circle-check'; }
        if (stepPreparing) { stepPreparing.className = 'step-row completed'; iconPreparing.className = 'fa-solid fa-circle-check'; }
        if (stepCooking) { stepCooking.className = 'step-row completed'; iconCooking.className = 'fa-solid fa-circle-check'; }
        if (stepReady) { stepReady.className = 'step-row active completed'; iconReady.className = 'fa-solid fa-circle-check'; }

        if (!hasPlayedReadySound) {
            audioNotification.play().catch(() => {});
            hasPlayedReadySound = true;
        }
        actionsHtml = '<button class="btn-action-large btn-action-yellow" onclick="localStorage.removeItem(\'cart\');localStorage.removeItem(\'lastOrderID\');localStorage.removeItem(\'lastRefNumber\');location.href=\'customer.html\';"><i class="fa-solid fa-plus"></i> Order Again</button><button class="btn-action-large btn-action-outline" onclick="window.viewReceipt(' + orderId + ')"><i class="fa-solid fa-receipt"></i> View Receipt</button>';
    }

    if (actionsContainer) actionsContainer.innerHTML = actionsHtml;
}

// ── Multi-order dropdown selector ──
function renderOrderSelector(deviceOrders, activeOrderId) {
    const container = document.getElementById('orderCardsContainer');
    if (!container) return;

    const options = deviceOrders.map(o => {
        const selected = o.order_id == activeOrderId ? ' selected' : '';
        const ref = o.ref || o.order_id;
        const label = '#' + escapeHtml(String(ref));
        return `<option value="${o.order_id}"${selected}>${label}</option>`;
    }).join('');

    const selectorHtml = `<div class="order-selector">
        <select id="orderSelector" onchange="switchTrackedOrder(this.value)">
            ${options}
        </select>
    </div>`;
    container.insertAdjacentHTML('afterbegin', selectorHtml);
}

window.switchTrackedOrder = function(orderId) {
    // Fetch and render the selected order
    fetchAndRenderOrder(parseInt(orderId));
    // Scroll to the card
    const card = document.getElementById('trackerCard-' + orderId);
    if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
};

// ── Collapsible "View My Order" toggle ──
window.toggleViewOrder = function (orderId) {
  const body = document.getElementById('viewOrderBody-' + orderId);
  const icon = document.getElementById('viewOrderIcon-' + orderId);
  if (!body) return;
  const isHidden = body.style.display === 'none' || !body.style.display;
  body.style.display = isHidden ? 'block' : 'none';
  if (icon) icon.innerHTML = isHidden ? '<i class="fa-solid fa-chevron-up"></i>' : '<i class="fa-solid fa-chevron-down"></i>';
};

window.goBackFromTracker = function () {
    history.length > 1 ? history.back() : location.href = 'customer.html';
};

window.resumeGcashPayment = async function (orderId) {
    let ref = orderId;
    if (window.HOFDevice) {
        const order = HOFDevice.orders().find(o => o.order_id == orderId);
        if (order && order.ref) ref = order.ref;
    }
    try {
        const resp = await fetch(`${APP_ROOT}/backend/payments/get-payment-link.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order_id: orderId, ref: String(ref), purpose: 'pay' })
        });
        const data = await resp.json();
        if (data.success && data.signed_url) {
            window.location.href = data.signed_url;
        } else {
            Swal.fire({ icon: 'error', title: 'Error', text: data.message || 'Could not get payment link', confirmButtonColor: '#FFB800' });
        }
    } catch (err) {
        Swal.fire({ icon: 'error', title: 'Connection Error', text: 'Please try again.', confirmButtonColor: '#FFB800' });
    }
};

async function obtainTrackSig(orderId) {
    let ref = orderId;
    if (window.HOFDevice) {
        const order = HOFDevice.orders().find(o => o.order_id == orderId);
        if (order && order.ref) ref = order.ref;
    }
    const resp = await fetch(`${APP_ROOT}/backend/payments/get-payment-link.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: orderId, ref: String(ref), purpose: 'track', device_id: (window.HOFDevice ? HOFDevice.id() : '') })
    });
    const data = await resp.json();
    if (data.success && data.sig) {
        return data.sig;
    }
    return null;
}

async function obtainItemsSig(orderId) {
    let ref = orderId;
    if (window.HOFDevice) {
        const order = HOFDevice.orders().find(o => o.order_id == orderId);
        if (order && order.ref) ref = order.ref;
    }
    const resp = await fetch(`${APP_ROOT}/backend/payments/get-payment-link.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: orderId, ref: String(ref), purpose: 'items', device_id: (window.HOFDevice ? HOFDevice.id() : '') })
    });
    const data = await resp.json();
    if (data.success && data.sig) {
        return data.sig;
    }
    return null;
}

async function obtainCancelSig(orderId) {
    let ref = orderId;
    if (window.HOFDevice) {
        const order = HOFDevice.orders().find(o => o.order_id == orderId);
        if (order && order.ref) ref = order.ref;
    }
    const resp = await fetch(`${APP_ROOT}/backend/payments/get-payment-link.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: orderId, ref: String(ref), purpose: 'cancel' })
    });
    const data = await resp.json();
    return data.success && data.sig ? data.sig : null;
}

async function obtainReceiptSig(orderId) {
    let ref = orderId;
    if (window.HOFDevice) {
        const order = HOFDevice.orders().find(o => o.order_id == orderId);
        if (order && order.ref) ref = order.ref;
    }
    try {
        const deviceId = (window.HOFDevice ? HOFDevice.id() : '');
        const resp = await fetch(`${APP_ROOT}/backend/payments/get-payment-link.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order_id: orderId, ref: String(ref), purpose: 'receipt', device_id: deviceId })
        });
        const data = await resp.json();
        return data.success && data.sig ? data.sig : null;
    } catch (e) {
        return null;
    }
}

// ── Customer Receipt Functions (E1) ──
window.viewReceipt = async function(orderId) {
    try {
        const sig = await obtainReceiptSig(orderId);
        const deviceId = window.HOFDevice ? HOFDevice.id() : '';
        let url = '/backend/customer/get_receipt.php?order_id=' + encodeURIComponent(orderId) + '&device_id=' + encodeURIComponent(deviceId);
        if (sig) {
            let ref = orderId;
            if (window.HOFDevice) {
                const order = HOFDevice.orders().find(o => o.order_id == orderId);
                if (order && order.ref) ref = order.ref;
            }
            url += '&ref=' + encodeURIComponent(String(ref)) + '&sig=' + encodeURIComponent(sig);
        }
        const resp = await fetch(url);
        const data = await resp.json();
        if (!data.success) throw new Error(data.message);
        showReceiptModal(data);
    } catch (err) {
        Swal.fire({ icon: 'error', title: 'Error', text: err.message || 'Could not load receipt' });
    }
};

function showReceiptModal(data) {
    window._receiptRef = data.reference_number || 'order';
    var html = '<div class="receipt-print" id="receiptContent">';
    html += '<div class="receipt-header text-center">';
    html += '  <h3>' + escapeHtml(data.restaurant_name || 'House of Fries') + '</h3>';
    html += '  <p>' + escapeHtml(data.address || 'Tagoloan Branch') + '</p>';
    html += '</div>';
    html += '<hr>';
    html += '<p><strong>Receipt #:</strong> ' + escapeHtml(data.reference_number) + '</p>';
    html += '<p><strong>Date:</strong> ' + (data.created_at || '') + '</p>';
    html += '<p><strong>Cashier:</strong> ' + escapeHtml(data.cashier || '--') + '</p>';
    html += '<p><strong>Customer:</strong> ' + escapeHtml(data.customer_name || 'Walk-in') + '</p>';
    html += '<p><strong>Table:</strong> ' + (data.table_number ? 'Table #' + data.table_number : 'Takeout') + '</p>';
    html += '<p><strong>Payment:</strong> ' + escapeHtml(data.payment_method || '--') + '</p>';
    html += '<hr>';
    html += '<table style="width:100%;border-collapse:collapse;">';
    html += '<thead><tr><th style="text-align:left;">Item</th><th style="text-align:center;">Qty</th><th style="text-align:right;">Price</th><th style="text-align:right;">Subtotal</th></tr></thead>';
    html += '<tbody>';
    (data.items || []).forEach(function(item) {
        html += '<tr>';
        html += '  <td>' + escapeHtml(item.item_name) + '</td>';
        html += '  <td style="text-align:center;">x' + item.quantity + '</td>';
        html += '  <td style="text-align:right;">₱' + parseFloat(item.price).toFixed(2) + '</td>';
        html += '  <td style="text-align:right;">₱' + parseFloat(item.subtotal || item.price * item.quantity).toFixed(2) + '</td>';
        html += '</tr>';
    });
    html += '</tbody></table>';
    html += '<hr>';
    html += '<div style="text-align:right;font-size:1.2em;">';
    if (data.discount_amount && parseFloat(data.discount_amount) > 0) {
        html += '  <p>Subtotal: ₱' + parseFloat(data.subtotal_amount || data.total_amount).toFixed(2) + '</p>';
        html += '  <p>Discount: -₱' + parseFloat(data.discount_amount).toFixed(2) + '</p>';
    }
    html += '  <strong>Total: ₱' + parseFloat(data.total_amount).toFixed(2) + '</strong>';
    html += '</div>';
    if (data.payment_method === 'CASH' && data.change_amount) {
        html += '<div style="text-align:right;">';
        html += '  <p>Amount Paid: ₱' + parseFloat(data.amount_paid || 0).toFixed(2) + '</p>';
        html += '  <p>Change: ₱' + parseFloat(data.change_amount).toFixed(2) + '</p>';
        html += '</div>';
    }
    html += '<hr>';
    html += '<p class="text-center text-muted small">Thank you for dining with us!</p>';
    html += '</div>';
    html += '<div class="receipt-actions text-center mt-3" style="display:flex;gap:10px;justify-content:center;">';
    html += '  <button class="btn-hof primary" onclick="printReceipt()"><i class="fa-solid fa-print"></i> Print</button>';
    html += '  <button class="btn-hof" onclick="downloadReceipt()"><i class="fa-solid fa-download"></i> Download PDF</button>';
    html += '  <button class="btn-hof secondary" onclick="Swal.close()">Close</button>';
    html += '</div>';

    Swal.fire({
        title: 'Receipt',
        html: html,
        showConfirmButton: false,
        width: '450px',
        customClass: { popup: 'receipt-swal' }
    });
}

window.printReceipt = function() {
    var content = document.getElementById('receiptContent');
    if (!content) return;
    var win = window.open('', '', 'width=400,height=600');
    win.document.write('<html><head><title>Receipt</title>');
    win.document.write('<style>body{font-family:monospace;font-size:12px;width:80mm;margin:0 auto;padding:10px;}');
    win.document.write('table{width:100%;border-collapse:collapse;} th,td{padding:4px 2px;}');
    win.document.write('hr{border-top:1px dashed #000;} .text-center{text-align:center;} .text-muted{color:#666;}');
    win.document.write('@media print{body{width:80mm;}}');
    win.document.write('</style></head><body>');
    win.document.write(content.innerHTML);
    win.document.write('<script>window.print();window.close();<' + '/script>');
    win.document.write('</body></html>');
    win.document.close();
};

window.downloadReceipt = function() {
    var content = document.getElementById('receiptContent');
    if (!content) return;
    var html = '<html><head><title>Receipt</title>';
    html += '<style>body{font-family:monospace;font-size:12px;width:80mm;margin:0 auto;} table{width:100%;border-collapse:collapse;}';
    html += '</style></head><body>';
    html += content.innerHTML;
    html += '</body></html>';

    var blob = new Blob([html], {type: 'text/html'});
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'receipt-' + (window._receiptRef || 'order') + '.html';
    a.click();
    URL.revokeObjectURL(a.href);
};