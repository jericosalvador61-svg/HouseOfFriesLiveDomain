// 1. Global State - NOW LOADS FROM LOCAL STORAGE ON REFRESH
const APP_ROOT = (() => {
    const m = window.location.pathname.match(/^(.*?)(?:\/public|\/customer|\/backend|\/admin|\/cashier|\/inventoryStaff|\/kitchenStaff|\/waiter|\/supervisor)(?:\/|$)/i);
    return m && m[1] ? m[1] : '';
})();

function escapeHtml(text) {
  if (!text) return '';
  var d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}
let allMenuItems = [];
let cart = JSON.parse(localStorage.getItem('cart')) || [];

// 2. Selectors
const menuGrid = document.getElementById('menuGrid');
const categoryDropdown = document.getElementById('categoryDropdown');
const cartBadge = document.getElementById('cartBadgeCount');
const totalItemsText = document.getElementById('totalItemsText');
const totalAmountText = document.getElementById('totalAmountText');
const searchInput = document.getElementById('searchInput');

// 3. Initialize — behind the geofence location gate (Advisor Feature #7)
document.addEventListener('DOMContentLoaded', () => {
    initGeofenceGate();
});

/* ============================================================
   GEOFENCE LOCATION GATE (US-SYS-013 — Advisor Feature #7)
   Anti-scam: QR ordering is allowed only when the device is
   physically near the restaurant. Fail-closed by design.
   ============================================================ */
const GEO_COORDS_KEY = 'hof_geo_coords';      // session-scoped verified coords
const GEO_CACHE_TTL_MS = 30 * 60 * 1000;      // re-verify after 30 minutes

async function initGeofenceGate() {
    // Fast path: already passed recently — check BOTH storages
    const disabled = localStorage.getItem('hof_geo_disabled') === 'true'
                  || sessionStorage.getItem('hof_geo_disabled') === 'true';
    if (disabled) {
        startOrderingFlow();
        return;
    }
    try {
        const cached = JSON.parse(sessionStorage.getItem(GEO_COORDS_KEY));
        if (cached && cached.allowed && (Date.now() - cached.at) < GEO_CACHE_TTL_MS) {
            window.hofCustomerCoords = { lat: cached.lat, lng: cached.lng, accuracy: cached.accuracy };
            startOrderingFlow();
            return;
        }
    } catch (e) {}

    // 1. Lightweight check: is geofence enabled at all?
    try {
        const modeRes = await fetch('check_geofence.php?mode_only=1');
        const modeData = await modeRes.json();
        if (modeData.success && modeData.enabled === false) {
                    sessionStorage.setItem('hof_geo_disabled', 'true');
                    localStorage.setItem('hof_geo_disabled', 'true');
                    startOrderingFlow();
                    return;
                }
    } catch (e) {
        // REQ-050 L3: geofence check failed → FAIL CLOSED. Never allow ordering
        // on an unverifiable location state; the backend re-validates anyway,
        // but we must not silently disable the gate.
        console.error('Geofence mode check failed:', e);
        showGeofenceBlocked({ reason: 'CHECK_FAILED' });
        return;
    }

    requestLocationAndVerify();
}

function requestLocationAndVerify() {
    if (!('geolocation' in navigator)) {
        submitGeofenceCheck(0, 0, 999, true);
        return;
    }

    // Permission pre-check: if previously denied, skip GPS and show settings dialog
    if (sessionStorage.getItem('hof_geo_permission_denied') === 'true') {
        showGeofenceBlocked({ reason: 'PERMISSION_DENIED' });
        return;
    }

    Swal.fire({
        title: 'Checking your location…',
        html:
            '<div style="text-align:left;font-size:0.95rem;line-height:1.6;">' +
                '<p class="mb-2">To place an order, please make sure:</p>' +
                '<ol style="padding-left:1.15rem;margin-bottom:8px;">' +
                    '<li>Location permission is <b>allowed</b> for this site.</li>' +
                    '<li>Your phone’s <b>Location / GPS</b> is turned on.</li>' +
                    '<li>You are <b>near House of Fries</b>.</li>' +
                    '<li>You are not in a fully enclosed area if possible.</li>' +
                '</ol>' +
                '<small class="text-muted">This can take a few seconds while your device gets an accurate fix.</small>' +
            '</div>',
        allowOutsideClick: false,
        allowEscapeKey: false,
        didOpen: () => Swal.showLoading()
    });

    // Timeout is deliberately generous (15s) because a cold GPS fix indoors
    // is slow, but it is finite so the customer is never stuck forever.
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            Swal.close();
            submitGeofenceCheck(
                pos.coords.latitude,
                pos.coords.longitude,
                pos.coords.accuracy || 0,
                false
            );
        },
        (err) => {
            Swal.close();
            console.warn('GPS error:', err.code, err.message);

            // Map the browser error onto our own reasons so the customer gets
            // a useful instruction instead of a raw code.
            const reasonByCode = {
                1: 'PERMISSION_DENIED',
                2: 'POSITION_UNAVAILABLE',
                3: 'GPS_TIMEOUT'
            };
            showGeofenceBlocked({ reason: reasonByCode[err.code] || 'POSITION_UNAVAILABLE' });
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
}

async function submitGeofenceCheck(lat, lng, accuracy, fallback) {
    try {
        const response = await fetch('check_geofence.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat: lat, lng: lng, accuracy: accuracy, fallback: !!fallback })
        });

        if (response.status === 429) {
            Swal.close();
            showGeofenceBlocked({ reason: 'RATE_LIMITED' });
            return;
        }

        const data = await response.json();
        Swal.close();

        if (data.success && data.allowed) {
                    sessionStorage.setItem(GEO_COORDS_KEY, JSON.stringify({
                        allowed: true, at: Date.now(), lat: lat, lng: lng, accuracy: accuracy
                    }));
                    // Also persist to localStorage as backup so cart.html can find coords
                    localStorage.setItem(GEO_COORDS_KEY, JSON.stringify({
                        allowed: true, at: Date.now(), lat: lat, lng: lng, accuracy: accuracy
                    }));
                    window.hofCustomerCoords = { lat: lat, lng: lng, accuracy: accuracy };

            const distTxt = (typeof data.distance_m === 'number')
                ? `You're about <b>${Math.round(data.distance_m)} m</b> from our counter.`
                : '';
            // Surface GPS accuracy so the customer understands tolerance.
            const accTxt = (accuracy && accuracy !== 999)
                ? `<br><small class="text-muted">Accuracy: ±${Math.round(accuracy)} m</small>`
                : '';
            await Swal.fire({
                icon: 'success',
                title: 'Welcome to House of Fries!',
                html: `${distTxt}${accTxt}<br><small>Browse the menu and order away.</small>`,
                timer: 2000,
                timerProgressBar: true,
                showConfirmButton: false
            });
            startOrderingFlow();
        } else {
            sessionStorage.removeItem(GEO_COORDS_KEY);
            showGeofenceBlocked(data && data.reason ? data : { reason: 'OUT_OF_RANGE' });
        }
    } catch (error) {
        console.error('Geofence check failed:', error);
        Swal.close();
        showGeofenceBlocked({ reason: 'CHECK_FAILED' });
    }
}

function showGeofenceBlocked(info) {
    const r = info && info.reason ? info.reason : 'OUT_OF_RANGE';
    const distLine = (info && typeof info.distance_m === 'number' && info.radius_m)
        ? `You are about <b>${Math.round(info.distance_m)} m</b> away — orders are only accepted within <b>${Math.round(info.radius_m)} m</b> of the shop.`
        : '';

    const messages = {
        OUT_OF_RANGE:
            `${distLine || 'Your device is outside our service area.'}<br><small>` +
            `To prevent fake orders, we only accept QR orders from customers who are physically ` +
            `at House of Fries Tagoloan. Walk in, scan again, and enjoy!</small>`,
        PERMISSION_DENIED:
            'Location access is blocked.<br><small>Your browser is remembering the denial. ' +
            'Open your browser or phone <b>Settings</b>, find <b>Location permissions</b> ' +
            'for this site, and set it to <b>Allow</b>. Then reload this page.</small>',
        POSITION_UNAVAILABLE:
            'We couldn’t get your location.<br><small>Make sure Location/GPS is turned on, then tap <b>Try Again</b>.</small>',
        GPS_TIMEOUT:
            'Getting your location took too long.<br><small>The first GPS fix indoors can be slow. Move near a window or step outside, then tap <b>Try Again</b>.</small>',
        NO_GEO_SUPPORT:
            'This browser doesn’t support location services.<br><small>Tap <b>Locate Restaurant & Directions</b> below to find us.</small>',
        UNRELIABLE_GPS:
            'Your location is not accurate enough yet.<br><small>Please move to a location with a clearer GPS signal and try again.</small>',
        RATE_LIMITED:
            'Too many location checks.<br><small>Please wait a few minutes and try again, or tap <b>Locate Restaurant & Directions</b>.</small>',
        CHECK_FAILED:
            'We couldn’t verify your location right now.<br><small>Check your internet connection and tap <b>Try Again</b>.</small>'
    };

    // PERMISSION_DENIED is sticky — remember so we skip GPS next time
    if (r === 'PERMISSION_DENIED') {
        sessionStorage.setItem('hof_geo_permission_denied', 'true');
        Swal.fire({
            icon: 'warning',
            title: 'Location Permission Denied',
            html: messages.PERMISSION_DENIED,
            confirmButtonText: 'Open Location Settings',
            confirmButtonColor: '#FFB800',
            showDenyButton: true,
            denyButtonText: 'Order at counter instead',
            showCancelButton: true,
            cancelButtonText: 'Close',
            allowOutsideClick: false,
            allowEscapeKey: false
        }).then((result) => {
            if (result.isConfirmed) {
                // Clear the flag so user gets a fresh prompt after changing settings
                sessionStorage.removeItem('hof_geo_permission_denied');
                requestLocationAndVerify();
            } else if (result.isDenied) {
                window.close();
                setTimeout(() => { window.location.href = 'about:blank'; }, 300);
            } else {
                window.close();
                setTimeout(() => { window.location.href = 'about:blank'; }, 300);
            }
        });
        return;
    }

    Swal.fire({
        icon: 'warning',
        title: 'Ordering Locked 🔒',
        html: messages[r] || messages.OUT_OF_RANGE,
        confirmButtonText: 'Try Again',
        confirmButtonColor: '#FFB800',
        showDenyButton: true,
        denyButtonText: 'Locate Restaurant & Directions',
        showCancelButton: true,
        cancelButtonText: 'Close',
        allowOutsideClick: false,
        allowEscapeKey: false
    }).then((result) => {
        if (result.isConfirmed) {
            requestLocationAndVerify();
        } else if (result.isDenied) {
            // Open a placeholder window synchronously (inside the click gesture)
            // so popup blockers don't kill it, then point it at Maps directions
            // once we have the restaurant location.
            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
            const fallback = { lat: 8.5372, lng: 124.8269 }; // Tagoloan default
            const mapsUrl = (lat, lng) => isIOS
                ? `https://maps.apple.com/?daddr=${lat},${lng}&saddr=Current+Location`
                : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&dir_action=navigate`;
            const w = window.open('about:blank', '_blank');
            fetch(APP_ROOT + '/backend/get_location_public.php')
                .then(response => response.json())
                .then(data => {
                    if (data.success && data.settings) {
                        const lat = parseFloat(data.settings.latitude);
                        const lng = parseFloat(data.settings.longitude);
                        if (isFinite(lat) && isFinite(lng)) {
                            w.location.href = mapsUrl(lat, lng);
                            return;
                        }
                    }
                    w.location.href = mapsUrl(fallback.lat, fallback.lng);
                })
                .catch(() => {
                    w.location.href = mapsUrl(fallback.lat, fallback.lng);
                });
            window.location.href = APP_ROOT + '/landing/';
        } else {
            window.close();
            setTimeout(() => { window.location.href = 'about:blank'; }, 300);
        }
    });
}

// Runs ONLY after the geofence says the customer is inside
function startOrderingFlow() {
    const returnToCart = new URLSearchParams(window.location.search).get('return') === 'cart';

    // ── EDIT-ORDER BANNER (F4) ──
    const editOrderId = localStorage.getItem('editOrderId');
    const editRefNumber = localStorage.getItem('editRefNumber');
    const cartData = JSON.parse(localStorage.getItem('cart')) || [];
    if (editOrderId && editRefNumber) {
        if (cartData.length === 0) {
            // Stale edit flags with empty cart — silently clear
            localStorage.removeItem('editOrderId');
            localStorage.removeItem('editRefNumber');
            localStorage.removeItem('editSig');
        } else {
            // Show dismissible banner
            const banner = document.createElement('div');
            banner.id = 'editOrderBanner';
            banner.style.cssText = 'background:rgba(255,184,0,0.15);border:1px solid rgba(255,184,0,0.3);border-radius:12px;padding:10px 16px;margin:12px auto;max-width:600px;display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:13px;font-weight:600;color:#331A11;';
            banner.innerHTML = '<span><i class="fa-solid fa-pen-to-square" style="color:#FFB800;"></i> Editing Order #' + escapeHtml(editRefNumber) + ' — you are updating this order at checkout</span>'
              + '<button onclick="document.getElementById(\'editOrderBanner\').remove();localStorage.removeItem(\'editOrderId\');localStorage.removeItem(\'editRefNumber\');localStorage.removeItem(\'editSig\');" style="background:none;border:none;font-size:18px;cursor:pointer;color:#666;padding:0 4px;">✕</button>';
            const header = document.querySelector('header');
            if (header) header.insertAdjacentElement('afterend', banner);
        }
    }

    handleTableID();
    loadCategories();
    loadMenu();
    setupEventListeners();
    updateCartUI(); // Update badges immediately on load

    if (returnToCart && (JSON.parse(localStorage.getItem('cart')) || []).length > 0) {
            // Loop-buster: if we already tried redirecting to cart once this session,
            // stop auto-redirecting — the cart page couldn't find coords, so stay on menu.
            const retryKey = 'hof_retry_cart_redirect';
            if (sessionStorage.getItem(retryKey) === '1') {
                sessionStorage.removeItem(retryKey);
                // Just show a message banner instead of looping
                const banner = document.createElement('div');
                banner.style.cssText = 'background:#FFF9E6;border:1px solid #FFB800;border-radius:12px;padding:12px 16px;margin:12px auto;max-width:600px;text-align:center;font-size:14px;font-weight:600;color:#331A11;';
                banner.innerHTML = 'Click <b>View Cart</b> below to continue to your cart.';
                const header = document.querySelector('header');
                if (header) header.insertAdjacentElement('afterend', banner);
            } else {
                sessionStorage.setItem(retryKey, '1');
                window.location.href = 'cart.html';
            }
        }

    // REQ-064: live order events — if any order tied to this device changes
    // status (cashier/kitchen/waiter move it forward), refresh the cart badge
    // immediately instead of waiting for a reload.
    if (typeof window.initStatusSocket === 'function') window.initStatusSocket();
    else if (typeof HOFDevice !== 'undefined') {
        try {
            const pusher = new Pusher('a8860aca373dcc3400ce', {
                cluster: 'ap1',
                forceTLS: (window.location.protocol === 'https:')
            });
            const channel = pusher.subscribe('hof-orders');
            const onOrderEvent = () => { if (window.updateBadge) window.updateBadge(); };
            channel.bind('new-order', onOrderEvent);
            channel.bind('order-status-changed', onOrderEvent);
        } catch (e) { console.warn('Pusher init error:', e); }
    }
}

/* ============================================================
   CUSTOMER ORDERING SESSION
   ------------------------------------------------------------
   A "session" is the boundary that decides whether the cart is
   allowed to survive. It is bound to the TABLE IDENTITY (table_id
   is canonical; table_number is only a display label).

   Rules
     • A NEW table/QR scan starts a NEW session -> cart starts empty.
     • Going Back or reloading the SAME table keeps the session
       -> the cart survives and no re-verification is needed.
     • A different customer/device always has its own storage.
   ============================================================ */
const ORDER_SESSION_KEY = 'hof_order_session';

function getOrderSession() {
    try {
        return JSON.parse(localStorage.getItem(ORDER_SESSION_KEY));
    } catch (e) {
        return null;
    }
}

function startOrderSession(info) {
    const session = {
        key: (info.table_id ? 'T' + info.table_id : 'TO') + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
        table_id: info.table_id ? String(info.table_id) : null,
        table_number: info.table_number || null,
        table_type: info.table_type || null,
        order_type: info.order_type || 'DINE_IN',
        verified: true,
        created_at: Date.now()
    };
    localStorage.setItem(ORDER_SESSION_KEY, JSON.stringify(session));
    return session;
}

function endOrderSession() {
    localStorage.removeItem(ORDER_SESSION_KEY);
}

/** Shared display label for customer.html AND cart.html. */
function formatTableLabel(tableNumber, orderType) {
    if (orderType === 'TAKE_OUT') {
        const name = localStorage.getItem('customerName');
        return name ? 'Takeout / ' + name : 'Takeout Order';
    }
    return tableNumber ? 'Table ' + tableNumber + ' / Dine In' : 'Ordering / Dine In';
}

// --- TABLE ID LOGIC ---
function handleTableID() {
    const urlParams = new URLSearchParams(window.location.search);
    const tableIdFromURL = urlParams.get('table_id');
    // Accept every takeout QR variant: ?takeout=1, ?type=takeout, ?order_type=takeout|take_out
    const rawType = (urlParams.get('type') || urlParams.get('order_type') || '').toLowerCase();
    const isTakeout = urlParams.get('takeout') === '1'
        || rawType === 'takeout' || rawType === 'take_out';
    const tableDisplay = document.getElementById('tableDisplay');

    // ── PATH A: QR carrying a table identity (dine-in OR takeout station) ──
    // The ONLY path allowed to start a new session. It always goes through
    // backend validation so a DELETED or MAINTENANCE QR can never open an
    // ordering session — including TAKE_OUT, which used to skip the check.
    if (tableIdFromURL) {
        verifyQrSession(tableIdFromURL, isTakeout);
        return;
    }

    // ── PATH B: pure takeout QR with no table row (?takeout=1) ──
    if (isTakeout) {
        const existing = getOrderSession();
        if (!existing || existing.order_type !== 'TAKE_OUT' || existing.table_id) {
            localStorage.removeItem('cart');          // new session = empty cart
            localStorage.removeItem('customerName');
            endOrderSession();
        }
        startOrderSession({ table_id: null, table_number: null, table_type: 'TAKEOUT', order_type: 'TAKE_OUT' });
        localStorage.removeItem('currentTableId');
        localStorage.removeItem('currentTableNumber');
        localStorage.setItem('orderType', 'TAKE_OUT');

        if (tableDisplay) tableDisplay.textContent = formatTableLabel(null, 'TAKE_OUT');
        showTakeoutNamePrompt();
        return;
    }

    // ── PATH C: no table_id in the URL — refresh or Back navigation ──
    // NEVER re-verify here. The session created by the QR scan is trusted for
    // the UI; the backend still re-validates on order submission.
    restoreExistingSession(tableDisplay);
}

/**
 * Restore the already-verified session for refresh / Back navigation.
 * This is what fixes the "Verifying your table…" that never resolved.
 */
function restoreExistingSession(tableDisplay) {
    const session = getOrderSession();

    if (session && session.verified) {
        // Keep the localStorage mirrors in sync so every page agrees.
        if (session.table_id) localStorage.setItem('currentTableId', session.table_id);
        if (session.table_number) localStorage.setItem('currentTableNumber', session.table_number);
        localStorage.setItem('orderType', session.order_type || 'DINE_IN');

        if (tableDisplay) {
            tableDisplay.textContent = formatTableLabel(session.table_number, session.order_type);
        }
        return;
    }

    // No session at all (someone opened customer.html directly — possibly
    // tampered URL or fresh tab). Clear cached geofence coords so the
    // location check runs fresh — stale coords shouldn't skip re-verification.
    localStorage.removeItem(GEO_COORDS_KEY);
    sessionStorage.removeItem(GEO_COORDS_KEY);
    delete window.hofCustomerCoords;

    const savedTableId = localStorage.getItem('currentTableId');
    const savedType = localStorage.getItem('orderType') === 'TAKE_OUT' ? 'TAKE_OUT' : 'DINE_IN';

    if (savedTableId) {
        // Identity without a session — re-verify once, cleanly.
        verifyQrSession(savedTableId, savedType === 'TAKE_OUT');
        return;
    }

    if (tableDisplay) {
        tableDisplay.textContent = formatTableLabel(null, savedType);
    }
}

/**
 * Validate a scanned QR against the backend, then establish the session.
 * @param {string}  tableId     raw table_id from the QR
 * @param {boolean} isTakeout   QR was a takeout-station variant
 */
async function verifyQrSession(tableId, isTakeout) {
    const tableDisplay = document.getElementById('tableDisplay');

    // ── SAME-TABLE REVISIT: reuse the existing verified session ──
    // Returning to the SAME table needs no extra round trip,
    // BUT still call occupy so the table status is marked OCCUPIED
    // even if admin freed it while the customer was ordering.
    const session = getOrderSession();
    if (session && session.verified && String(session.table_id) === String(tableId)) {
        if (tableDisplay) {
            tableDisplay.textContent = formatTableLabel(session.table_number, session.order_type);
        }
        // Re-occupy the table — admin may have freed it since last scan
        await updateTableStatusToOccupied(tableId, session.table_type || 'DINE_IN');
        return;
    }

    if (tableDisplay) tableDisplay.textContent = 'Verifying your table…';

    let info;
    try {
        const res = await fetch('validate_table.php?table_id=' + encodeURIComponent(tableId));
        info = await res.json();
    } catch (err) {
        console.error('Table validation failed:', err);
        showTableUnavailable({
            code: 'ERROR',
            message: "We couldn't verify this table right now. Please check your connection and scan again."
        });
        return;
    }

    if (!info || !info.valid) {
        showTableUnavailable(info || { code: 'ERROR', message: 'Table QR is no longer available.' });
        return;
    }

    // ── Backend confirmed the QR is live: establish a clean session ──
    const tableType = info.table_type || (isTakeout ? 'TAKEOUT' : 'DINE_IN');
    const orderType = (tableType === 'TAKEOUT' || isTakeout) ? 'TAKE_OUT' : 'DINE_IN';

    const sameTable = session && session.table_id && String(session.table_id) === String(info.table_id);

    if (!sameTable) {
        // NEW session boundary: a different table/customer must never inherit
        // someone else's cart or edit target.
        localStorage.removeItem('cart');
        localStorage.removeItem('customerName');
        localStorage.removeItem('editOrderId');
        localStorage.removeItem('editRefNumber');
        localStorage.removeItem('editSig');
    }

    startOrderSession({
        table_id: info.table_id,
        table_number: info.table_number,
        table_type: tableType,
        order_type: orderType
    });

    localStorage.setItem('currentTableId', String(info.table_id));
    localStorage.setItem('currentTableNumber', info.table_number || '');
    localStorage.setItem('orderType', orderType);
    localStorage.setItem('hof_my_table', String(info.table_id));
    localStorage.setItem('hof_my_table_verified_at', Date.now().toString());

    if (tableDisplay) {
        tableDisplay.textContent = formatTableLabel(info.table_number, orderType);
    }

    if (orderType === 'TAKE_OUT') {
        // Takeout station rows are never occupied as dine-in seats.
        showTakeoutNamePrompt();
        return;
    }

    // Occupy the dine-in table (server-authoritative, atomic).
    await updateTableStatusToOccupied(info.table_id, tableType);
}

/** One consistent "this QR cannot be used" dialog for every failure code. */
function showTableUnavailable(info) {
    const code = (info && info.code) || 'DELETED';
    const messages = {
        DELETED: (info && info.message) || 'This QR code is invalid or has been removed. Please ask restaurant staff for assistance.',
        MAINTENANCE: (info && info.message) || 'This table is currently under maintenance and cannot accept orders. Please choose another table or ask restaurant staff for assistance.',
        OCCUPIED: (info && info.message) || 'This table is currently occupied. Please choose another table or order at the counter.',
        ERROR: (info && info.message) || "We couldn't verify this table right now. Please try again."
    };

    // The session identity is dead — drop it so nothing stale lingers.
    endOrderSession();
    localStorage.removeItem('currentTableId');
    localStorage.removeItem('currentTableNumber');

    Swal.fire({
        icon: code === 'OCCUPIED' ? 'warning' : 'error',
        title: code === 'MAINTENANCE' ? 'Table Under Maintenance' : 'Table Unavailable',
        text: messages[code] || messages.DELETED,
        confirmButtonText: 'Understood',
        confirmButtonColor: '#FFB800',
        allowOutsideClick: false,
        allowEscapeKey: false
    }).then(() => {
        window.close();
        setTimeout(() => {
            window.location.href = 'about:blank';
        }, 300);
    });
}

// --- TAKEOUT NAME PROMPT ---
function showTakeoutNamePrompt() {
    // Check if already have a name saved
    const existingName = localStorage.getItem('customerName');
    if (existingName && existingName.trim() !== '') {
        return; // Already set
    }

    Swal.fire({
        title: 'Takeout Order',
        text: 'Please enter your name so we can prepare your order.',
        input: 'text',
        inputPlaceholder: 'Your name...',
        inputAttributes: {
            maxlength: 100,
            autocapitalize: 'words'
        },
        confirmButtonText: 'Start Ordering',
        confirmButtonColor: '#FFB800',
        allowOutsideClick: false,
        allowEscapeKey: false,
        inputValidator: (value) => {
            if (!value || value.trim() === '') {
                return 'Please enter your name!';
            }
        }
    }).then((result) => {
        if (result.isConfirmed && result.value) {
            localStorage.setItem('customerName', result.value.trim());
            Swal.fire({
                icon: 'success',
                title: `Welcome, ${result.value.trim()}!`,
                text: 'Browse the menu and add items to your cart.',
                confirmButtonColor: '#FFB800',
                timer: 2000,
                timerProgressBar: true
            });
        }
    });
}

// --- AUTOMATIC TABLE OCCUPY FUNCTION ---
async function updateTableStatusToOccupied(tableId, tableType) {
    try {
        const response = await fetch('occupy_table.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ table_id: tableId, type: tableType || 'DINE_IN' })
        });
        
        const data = await response.json();
        
        if (data.status === 'success') {
            console.log(`Table ${tableId} automatically marked as OCCUPIED.`);
            if (data.table_number) {
                localStorage.setItem('currentTableNumber', data.table_number);
                const tableDisplay = document.getElementById('tableDisplay');
                if (tableDisplay) {
                    tableDisplay.textContent = (data.table_type === 'TAKEOUT' ? '' : 'Table ') + data.table_number + ' / Dine In';
                }
            }
        } else if (data.status === 'occupied' || data.status === 'maintenance' || data.status === 'invalid') {
            // Check ownership flag: if this customer owns the table, allow silently on refresh
            var myTable = localStorage.getItem('hof_my_table');
            var isOwner = myTable && String(myTable) === String(tableId);
            if (data.status === 'occupied' && isOwner) {
                console.log('Table already OCCUPIED by this customer — allowing refresh');
                return;
            }
            // A race happened between validation and occupy (or the QR was
            // removed in between). Reuse the single shared dialog.
            showTableUnavailable({
                code: data.code || (data.status === 'maintenance' ? 'MAINTENANCE' : (data.status === 'invalid' ? 'DELETED' : 'OCCUPIED')),
                message: data.message
            });
        } else {
            showTableUnavailable({
                code: data.code || 'DELETED',
                message: data.message || 'This QR code is no longer valid. Please ask restaurant staff for assistance.'
            });
        }
    } catch (error) {
        console.error("Error communicating with backend to occupy table:", error);
    }
}

// --- FETCH FUNCTIONS ---
async function loadCategories() {
    try {
        const response = await fetch('get_categories.php');
        const categories = await response.json();
        categoryDropdown.innerHTML = '<option value="">All Categories</option>';
        categories.forEach(cat => {
            const option = document.createElement('option');
            option.value = cat.category_id;
            option.textContent = cat.category_name;
            categoryDropdown.appendChild(option);
        });
    } catch (error) {
        console.error("Error loading categories:", error);
    }
}

async function loadMenu() {
    try {
        const response = await fetch('get_menu.php');
        if (!response.ok) throw new Error('Network response was not ok');
        allMenuItems = await response.json();
        renderMenu(allMenuItems);
    } catch (error) {
        console.error("Error loading menu:", error);
        menuGrid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; padding: 20px;">Failed to load menu items.</p>';
    }
}

// --- RENDERING ---
function renderMenu(items) {
    menuGrid.innerHTML = '';
    if (items.length === 0) {
        menuGrid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; padding: 20px;">No items found.</p>';
        return;
    }

    items.forEach(item => {
        const isUnavailable = item.status === 'Unavailable';
        const cardStyle = isUnavailable ? 'style="filter: grayscale(1); opacity: 0.65;"' : '';

        // --- CLEAN PATH RESOLUTION ---
        let filename = item.image_url ? item.image_url.split('/').pop() : '';
        let imageSrc = filename ? `/images/menu/${filename}` : '/images/placeholder.png';

        // Count how many of this item are currently in the cart (grouped total quantity)
        const currentQty = getCartQtyForItem(item.menu_item_id);

        // REQ-040: single "+ Add" button; the card shows a small count badge
        // (over the top-right of the image) when the item is already in the cart.
        // Both the button and the badge reopen the choice/add-on popup.
        const qtyBadge = currentQty > 0
            ? `<div class="item-qty-badge" onclick="openItemPopup(${item.menu_item_id})">${currentQty}</div>`
            : '';

        let actionButtonHTML = '';
        if (isUnavailable) {
            actionButtonHTML = `
                <button class="item-action-bar" style="background-color: #6c757d; cursor: not-allowed;" disabled>
                    <span class="item-price">₱${parseFloat(item.price).toFixed(2)}</span>
                    <span style="font-size: 11px; text-transform: uppercase; font-weight: 800; letter-spacing: 0.5px;">Out of Stock</span>
                </button>
            `;
        } else {
            // Default Add Button — opens the choice/add-on popup
            actionButtonHTML = `
                <button class="item-action-bar" onclick="openItemPopup(${item.menu_item_id})">
                    <span class="item-price">₱${parseFloat(item.price).toFixed(2)}</span>
                    <i class="fa-solid fa-plus"></i>
                </button>
            `;
        }

        const card = `
            <div class="item-card" ${cardStyle}>
                <div class="item-card-image-wrap">
                    <img src="${imageSrc}" alt="${escapeHtml(item.item_name)}" onerror="if(this.src.endsWith('/images/placeholder.png')){this.style.display='none';this.insertAdjacentHTML('afterend','<div style=\'padding:20px;text-align:center;color:#999;\'><i class=\'fa-solid fa-image\' style=\'font-size:2rem;\'></i><br>No image</div>');}else{this.src='/images/placeholder.png';}">
                    ${qtyBadge}
                </div>
                <div class="item-info">
                    <h3 class="item-title-row">${escapeHtml(item.item_name)}</h3>
                    <p class="item-desc">${escapeHtml(item.description || '')}</p>
                    
                    ${actionButtonHTML}
                </div>
            </div>
        `;
        menuGrid.insertAdjacentHTML('beforeend', card);
    });
}

// --- CART LOGIC ---
// Total quantity currently in the cart for one menu item, summed across lines
// (each stored line carries a `quantity`, defaulting to 1 for legacy carts).
function getCartQtyForItem(menuItemId) {
    return cart.reduce((sum, line) => {
        if (String(line.menu_item_id) === String(menuItemId)) {
            const qty = parseInt(line.quantity, 10);
            return sum + (isNaN(qty) || qty < 1 ? 1 : qty);
        }
        return sum;
    }, 0);
}

// REQ-040: open the shared choice/add-on popup for an item.
// The stored cart line (first one found) is passed as `initial` so the
// popup pre-fills quantity / choices / add-ons for editing.
// A config-signature match is used so a second DIFFERENT configuration of the
// same item is appended (not overwritten) — MEDIUM-3 fix.
function cartLineSignature(line) {
    const choices = (line.choices || []).map(c => String(c)).slice().sort();
    const addons = (line.addons || []).slice().sort((a, b) => String(a.menu_addon_id).localeCompare(String(b.menu_addon_id)))
        .map(a => a.menu_addon_id + 'x' + (parseInt(a.quantity, 10) || 1));
    return String(line.menu_item_id) + '|' + choices.join(',') + '|' + addons.join(',');
}

window.openItemPopup = function (id) {
    const item = allMenuItems.find(p => String(p.menu_item_id) === String(id));

    if (!item) {
        alert("Sorry, we couldn't find that item in the menu.");
        return;
    }
    if (item.status === 'Unavailable') {
        alert("Sorry, this item is currently out of stock!");
        return;
    }

    // Find an EXISTING line with the same configuration to pre-fill + replace
    // in place. If none matches (or it's a different config), we append.
    const existingIndex = cart.findIndex(cartItem =>
        String(cartItem.menu_item_id) === String(id) &&
        cartItem.line_key === cartLineSignature(cartItem)
    );
    const initial = existingIndex !== -1 ? cart[existingIndex] : null;

    window.HOFChoicePopup.open({
        item: item,
        initial: initial || {},
        onConfirm: function (line) {
            // Enrich the structured line with display fields so the cart page
            // can render it without needing the full menu again. Preserve the
            // DB-rebuilt (configured) marker if editing an existing line so a
            // resume/edit line keeps skipping the required-group gate (HIGH-3).
            const enriched = Object.assign({}, line, {
                line_key: cartLineSignature(line),
                configured: !!(initial && initial.configured),
                item_name: item.item_name,
                description: item.description,
                image_url: item.image_url
            });
            if (initial && existingIndex !== -1) {
                // Replace the existing configured line in place, preserving other lines.
                cart.splice(existingIndex, 1, enriched);
            } else {
                // New line — append (distinct configuration of the same item).
                cart.push(enriched);
            }
            updateCartUI();
        }
    });
};

window.addToCart = function (id) {
    // Legacy alias kept so any stale inline handlers degrade gracefully to the popup.
    window.openItemPopup(id);
};

function updateCartUI() {
    // Count TOTAL quantity (sum of line quantities), not raw array length.
    const totalCount = cart.reduce((sum, item) => {
        const qty = parseInt(item.quantity, 10);
        return sum + (isNaN(qty) || qty < 1 ? 1 : qty);
    }, 0);
    // line.price already includes add-ons (REQ-040); legacy lines default to 1 per line.
    const totalPrice = cart.reduce((sum, item) => {
        const qty = parseInt(item.quantity, 10);
        const lineQty = isNaN(qty) || qty < 1 ? 1 : qty;
        return sum + (parseFloat(item.price) * lineQty);
    }, 0);

    if (cartBadge) cartBadge.textContent = totalCount;
    if (totalItemsText) totalItemsText.textContent = totalCount;
    if (totalAmountText) {
        totalAmountText.textContent = `₱ ${totalPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
    }

    localStorage.setItem('cart', JSON.stringify(cart));

    // Re-render the active menu grid to dynamically update card quantities/buttons live
    const activeCatId = categoryDropdown ? categoryDropdown.value : "";
    const searchTerm = searchInput ? searchInput.value.toLowerCase() : "";

    const filtered = allMenuItems.filter(item => {
        const matchesCategory = activeCatId === "" || item.category_id == activeCatId;
        const matchesSearch = item.item_name.toLowerCase().includes(searchTerm) || 
                              (item.description && item.description.toLowerCase().includes(searchTerm));
        return matchesCategory && matchesSearch;
    });

    renderMenu(filtered);
}

// --- FILTERS & NAVIGATION ---
function setupEventListeners() {
    categoryDropdown.addEventListener('change', (e) => {
        const catId = e.target.value;
        const filtered = catId === "" ? allMenuItems : allMenuItems.filter(item => item.category_id == catId);
        renderMenu(filtered);
    });

    searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const filtered = allMenuItems.filter(item =>
            item.item_name.toLowerCase().includes(term) ||
            item.description.toLowerCase().includes(term)
        );
        renderMenu(filtered);
    });

    const goToCart = () => {
        if (cart.length > 0) {
            window.location.href = 'cart.html';
        } else {
            alert("Your cart is empty!");
        }
    };

    const cartTrigger = document.getElementById('cartTrigger');
    const checkoutBtn = document.getElementById('checkoutBtn');

    if (cartTrigger) cartTrigger.addEventListener('click', goToCart);
    if (checkoutBtn) checkoutBtn.addEventListener('click', goToCart);

    // ── Pusher: listen for menu availability changes ──
    if (typeof Pusher !== 'undefined') {
        const pusher = new Pusher('a8860aca373dcc3400ce', { cluster: 'ap1', forceTLS: (window.location.protocol === 'https:') });
        const menuChannel = pusher.subscribe('hof-menu');
        menuChannel.bind('menu-availability-changed', function (data) {
            let payload = typeof data === 'string' ? JSON.parse(data) : data;
            if (typeof payload.data === 'string') payload = JSON.parse(payload.data);
            if (payload.menu_item_id && payload.status) {
                const item = allMenuItems.find(function (i) { return i.menu_item_id == payload.menu_item_id; });
                if (item) {
                    item.status = payload.status;
                    const activeCatId = categoryDropdown ? categoryDropdown.value : '';
                    const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';
                    const filtered = allMenuItems.filter(function (i) {
                        const matchesCategory = activeCatId === '' || i.category_id == activeCatId;
                        const matchesSearch = i.item_name.toLowerCase().includes(searchTerm) || (i.description && i.description.toLowerCase().includes(searchTerm));
                        return matchesCategory && matchesSearch;
                    });
                    renderMenu(filtered);
                }
            }
        });
    }
}