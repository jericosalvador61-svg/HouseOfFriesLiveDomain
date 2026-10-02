/**
 * ============================================================
 * Kitchen Display System (KDS) - kitchen_dashboard.html
 * ------------------------------------------------------------
 * init() -> loadData() -> renderData() -> setupEvents()
 *
 * PREP-TIME MODEL (no new DB columns)
 * -----------------------------------
 * The server returns, per order:
 *   prep_estimate_total : SUM(menu_items.estimated_prep_time_minutes * qty)
 *   prep_remaining      : orders.total_estimated_prep_time, a ledger of
 *                         MINUTES STILL TO COOK
 *   prep_started        : cooking_started_epoch is not null
 *   items[].is_prepared : derived server-side from the ledger
 *
 * Countdown = (prep_remaining * 60) - seconds_since(cooking_started_epoch)
 *
 * Ticking an item calls toggle_item.php, which deducts that item's minutes
 * SERVER-SIDE (the client never sends a number), so the timer visibly jumps.
 * Because the tick state is derived from the ledger, a re-render or a page
 * refresh always restores the correct checkboxes - the old RAM-only
 * deduction map silently desynced from the UI.
 *
 * REFRESH BEHAVIOUR
 * -----------------
 * There is NO page reload and NO 15s full re-render poll. Updates arrive
 * over the Pusher WebSocket, plus a 60s reconcile as a safety net for a
 * dropped socket (a silently-stale kitchen board is worse than one query).
 * ============================================================
 */

// =======================================
// CONFIGURATION
// =======================================
// Relative on purpose: works at the domain root AND under a sub-folder.
const KITCHEN_API = {
    BASE: '../../backend/kitchenStaff/kitchenkds/',
    GET_ORDERS: 'get_orders.php',
    UPDATE_STATUS: 'update_status.php',
    TOGGLE_ITEM: 'toggle_item.php',
    CHECK_ALL: 'check_all.php'
};

const PUSHER_CONFIG = {
    appKey: 'a8860aca373dcc3400ce',
    cluster: 'ap1',
    channel: 'hof-orders'
};

// Colour thresholds as a fraction of the remaining budget.
const TIMER_WARN_RATIO = 0.5;    // yellow once half the budget is gone
const TIMER_URGENT_RATIO = 0.25; // red once three quarters is gone
// =======================================
// KITCHEN API CLASS
// =======================================
class KitchenAPI {
    constructor() {
        this.token = localStorage.getItem('hof_token');
    }

    getHeaders(withJson) {
        const headers = {};
        if (withJson) headers['Content-Type'] = 'application/json';
        if (this.token) headers['Authorization'] = 'Bearer ' + this.token;
        return headers;
    }

    url(endpoint) {
        return KITCHEN_API.BASE + endpoint;
    }

    async request(endpoint, options = {}) {
        const res = await fetch(this.url(endpoint), {
            method: options.method || 'GET',
            headers: this.getHeaders(!!options.body),
            body: options.body ? JSON.stringify(options.body) : undefined
        });

        let data = {};
        try {
            data = await res.json();
        } catch (e) {
            throw new Error('The server returned an unreadable response.');
        }

        if (!res.ok || data.status === 'error') {
            throw new Error(data.message || ('Request failed (HTTP ' + res.status + ').'));
        }
        return data;
    }

    async fetchOrders() {
        const data = await this.request(KITCHEN_API.GET_ORDERS);
        return data.data || [];
    }

    async updateStatus(orderId, newStatus) {
        return this.request(KITCHEN_API.UPDATE_STATUS, {
            method: 'POST',
            body: { order_id: orderId, status: newStatus }
        });
    }

    // Tick / untick one item. The minutes are decided by the server.
    async toggleItem(orderId, orderItemId, prepared) {
        return this.request(KITCHEN_API.TOGGLE_ITEM, {
            method: 'POST',
            body: { order_id: orderId, order_item_id: orderItemId, prepared: !!prepared }
        });
    }

    // Zero out the remaining prep time for the whole order.
    async checkAll(orderId) {
        return this.request(KITCHEN_API.CHECK_ALL, {
            method: 'POST',
            body: { order_id: orderId }
        });
    }
}

// =======================================
// KITCHEN TIMER
// =======================================
// All values come from the server. There is no local deduction map, so the
// displayed time can never drift away from what the customer sees.
class KitchenTimer {
    constructor() {
        this.interval = null;
        this.orders = new Map(); // orderId -> { el, labelEl, prepRemaining, startedEpoch }
    }

    start() {
        if (this.interval) return;
        this.interval = setInterval(() => this.tick(), 1000);
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }

    clearAll() {
        this.orders.clear();
    }

    register(order) {
        const el = document.getElementById('timer-' + order.order_id);
        if (!el) return;

        this.orders.set(order.order_id, {
            el: el,
            labelEl: document.getElementById('estimate-' + order.order_id),
            prepRemaining: Number(order.prep_remaining) || 0,
            startedEpoch: Number(order.cooking_started_epoch) || 0,
            total: Number(order.prep_estimate_total) || 0
        });

        this.update(order.order_id);
    }

    /** Server told us the ledger moved - apply it without a full re-render. */
    applyServerLedger(orderId, prepRemaining) {
        const entry = this.orders.get(orderId);
        if (!entry) return;
        entry.prepRemaining = Number(prepRemaining) || 0;
        this.update(orderId);
    }

    /** Seconds left, or null when the clock is not running. */
    remainingSeconds(entry, nowMs) {
        if (!entry.startedEpoch) return null;
        const budget = entry.prepRemaining * 60;
        const elapsed = Math.floor((nowMs - (entry.startedEpoch * 1000)) / 1000);
        return Math.max(0, budget - elapsed);
    }

    update(orderId, nowMs = Date.now()) {
        const entry = this.orders.get(orderId);
        if (!entry) return;

        const remaining = this.remainingSeconds(entry, nowMs);

        if (remaining === null) {
            entry.el.textContent = '--:--';
            if (entry.labelEl) entry.labelEl.textContent = '';
            return;
        }

        const mins = Math.floor(remaining / 60);
        const secs = remaining % 60;
        entry.el.textContent = mins + ':' + String(secs).padStart(2, '0');

        // Colour by progress against the ORIGINAL estimate, not the shrinking
        // budget. Using the current budget would flip the card back to white
        // every time an item is ticked, so a slow order would never look slow.
        const budget = entry.prepRemaining * 60;
        const originalBudget = entry.total * 60;
        const ratioBase = originalBudget > 0 ? originalBudget : budget;
        const ratio = ratioBase > 0 ? (remaining / ratioBase) : 0;

        entry.el.classList.remove('warning', 'urgent');
        if (ratio <= TIMER_URGENT_RATIO) {
            entry.el.classList.add('urgent');
        } else if (ratio <= TIMER_WARN_RATIO) {
            entry.el.classList.add('warning');
        }

        if (entry.labelEl) {
            if (entry.prepRemaining <= 0) {
                entry.labelEl.textContent = 'All items checked';
            } else if (entry.total > 0 && entry.prepRemaining < entry.total) {
                entry.labelEl.textContent =
                    '~' + entry.prepRemaining + ' min left of ' + entry.total + ' min';
            } else {
                entry.labelEl.textContent = '~' + entry.prepRemaining + ' min total';
            }
        }
    }

    tick() {
        const now = Date.now();
        this.orders.forEach((_, orderId) => this.update(orderId, now));
    }
}
// =======================================
// KITCHEN PUSHER CLASS
// =======================================
class KitchenPusher {
    constructor(onChange) {
        this.pusher = null;
        this.channel = null;
        this.onChange = onChange;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 8;
    }

    init() {
        if (typeof Pusher === 'undefined') {
            // The SDK script is loaded after this file, so give it a moment.
            setTimeout(() => this.init(), 300);
            return;
        }

        // Match the transport to the page: ws:// on local http, wss:// on the
        // live https site. A hardcoded forceTLS breaks one of the two.
        const useTls = window.location.protocol === 'https:';

        try {
            this.pusher = new Pusher(PUSHER_CONFIG.appKey, {
                cluster: PUSHER_CONFIG.cluster,
                forceTLS: useTls
            });
        } catch (e) {
            console.warn('Pusher could not initialise:', e);
            return;
        }

        this.channel = this.pusher.subscribe(PUSHER_CONFIG.channel);

        // Both events fire from backend/pusher_helper.php.
        this.channel.bind('new-order', () => {
            this.playNotificationSound();
            if (this.onChange) this.onChange('new-order');
        });

        this.channel.bind('order-status-changed', () => {
            if (this.onChange) this.onChange('order-status-changed');
        });

        this.pusher.connection.bind('connected', () => {
            this.reconnectAttempts = 0;
            // A reconnect may have missed events while offline: resync once.
            if (this.onChange) this.onChange('reconnected');
        });

        this.pusher.connection.bind('disconnected', () => this.attemptReconnect());
    }

    attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) return;
        this.reconnectAttempts++;
        setTimeout(() => {
            if (this.pusher) this.pusher.connect();
        }, 1000 * this.reconnectAttempts);
    }

    playNotificationSound() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.value = 880;
            gain.gain.value = 0.1;
            osc.start();
            setTimeout(() => { osc.stop(); ctx.close(); }, 400);
        } catch (e) {
            // Audio is a nicety; never let it break the board.
        }
    }
}

// =======================================
// MAIN KITCHEN UI CLASS
// =======================================
class KitchenUI {
    constructor() {
        this.api = new KitchenAPI();
        this.timer = new KitchenTimer();
        this.pusher = new KitchenPusher(() => this.loadOrders());
        this.orders = [];
        // Cosmetic UI state that must survive a data refresh.
        this.expanded = new Set();
    }

    async init() {
        this.setupEvents();
        this.pusher.init();
        await this.loadOrders();
        this.timer.start();
        this.startReconcile();
    }

    // ---------------------------------------------------------------
    // Data loading
    // ---------------------------------------------------------------
    async loadOrders() {
        try {
            this.orders = await this.api.fetchOrders();
            this.renderOrders();
        } catch (err) {
            console.error('Failed to load orders:', err);
            this.showErrorState(err.message);
        }
    }

    /**
     * Safety net only. The board is kept current by the WebSocket; this
     * exists so a silently dropped socket can never leave cooks looking at
     * stale tickets. 60s instead of the old 15s because this re-renders.
     */
    startReconcile() {
        this.reconcileTimer = setInterval(() => {
            if (document.visibilityState === 'visible') this.loadOrders();
        }, 60000);

        // Coming back to the tab is a good moment to resync.
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') this.loadOrders();
        });
        window.addEventListener('focus', () => this.loadOrders());

        // The 10-minute un-tick grace window can lapse while the board is open,
        // so re-evaluate it periodically instead of waiting for an action.
        this.lockWatcher = setInterval(() => {
            this.orders
                .filter(o => o.status === 'COOKING' && o.unlock_deadline_epoch)
                .forEach(o => this.refreshLockState(o.order_id));
        }, 30000);
    }
    // ---------------------------------------------------------------
    // Rendering
    // ---------------------------------------------------------------
    renderOrders() {
        const cooking = this.orders.filter(o => o.status === 'COOKING');
        const inProgress = this.orders.filter(o => o.status === 'IN-PROGRESS');

        this.renderSection('cookingOrders', cooking, 'cooking');
        this.renderSection('inProgressOrders', inProgress, 'inprogress');
        this.updateCounts(cooking.length, inProgress.length);

        this.timer.clearAll();
        cooking.forEach(o => {
            this.timer.register(o);
            this.refreshLockState(o.order_id);
        });
    }

    renderSection(containerId, orders, sectionType) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (orders.length === 0) {
            container.innerHTML = sectionType === 'cooking'
                ? '<div class="empty-state" style="min-width: 100%;"><i class="bi bi-check-circle-fill"></i><p>All caught up!</p><small>No orders currently cooking</small></div>'
                : '<div class="empty-state" style="min-width: 100%;"><i class="bi bi-check-circle-fill"></i><p>All caught up!</p><small>No in-progress orders</small></div>';
            return;
        }

        container.innerHTML = orders.map(o => this.createOrderCard(o, sectionType)).join('');

        // Restore the expand/collapse state the cook had set.
        orders.forEach(o => {
            if (this.expanded.has(o.order_id)) {
                const card = container.querySelector('.order-card[data-order-id="' + o.order_id + '"]');
                if (card) card.classList.add('expanded');
            }
        });

        this.bindSectionEvents(container);
    }

    createOrderCard(order, sectionType) {
        const isCooking = sectionType === 'cooking';
        const orderType = order.order_type || 'DINE_IN';
        const typeClass = orderType === 'TAKE_OUT' ? 'type-takeout' : 'type-dine-in';
        const typeLabel = orderType === 'TAKE_OUT' ? 'Take Out' : 'Dine In';

        const statusClass = isCooking ? 'status-cooking' : 'status-inprogress';
        const statusLabel = isCooking ? 'Cooking' : 'In Progress';

        const total = Number(order.prep_estimate_total) || 0;

        // IN-PROGRESS: the estimate only (no clock until cooking starts).
        // COOKING: the live countdown + the remaining-time ledger.
        let rightColumn = '';
        if (isCooking) {
            rightColumn =
                '<div class="timer-display" id="timer-' + order.order_id + '">--:--</div>' +
                '<div class="estimate-text" id="estimate-' + order.order_id + '" style="font-size:12px;color:#6c757d;text-align:right;"></div>';
        } else {
            rightColumn =
                '<div class="estimate-text" id="estimate-' + order.order_id + '" style="font-size:12px;color:#6c757d;text-align:right;">' +
                '~' + total + ' min total</div>';
        }

        let actionsHtml = '';
        if (isCooking) {
            actionsHtml =
                '<button class="btn-action btn-check-all" data-order-id="' + order.order_id + '" style="background:transparent;border:1px solid #6c757d;color:#6c757d;">' +
                '<i class="bi bi-check2-all"></i> Check All</button>' +
                '<button class="btn-action btn-mark-done" data-order-id="' + order.order_id + '">' +
                '<i class="bi bi-check-lg"></i> Mark Done</button>';
        } else {
            actionsHtml =
                '<button class="btn-action btn-check-all" data-order-id="' + order.order_id + '" style="background:transparent;border:1px solid #6c757d;color:#6c757d;">' +
                '<i class="bi bi-check2-all"></i> Check All</button>' +
                '<button class="btn-action btn-start-cooking" data-order-id="' + order.order_id + '">' +
                '<i class="bi bi-play-fill"></i> Start Cooking</button>';
        }

        const itemsByCategory = this.groupItemsByCategory(order.items || []);
        let expandedItemsHtml = '';
        for (const categoryName of Object.keys(itemsByCategory)) {
            expandedItemsHtml +=
                '<div class="category-group">' +
                '<div class="category-header"><span class="category-dot"></span>' + this.escapeHtml(categoryName) + '</div>' +
                '<div class="expanded-items">' +
                itemsByCategory[categoryName].map(item => this.createExpandedItem(item, order.order_id)).join('') +
                '</div></div>';
        }

        return '' +
        '<article class="order-card" data-order-id="' + order.order_id + '" role="listitem" tabindex="0" aria-label="Order ' + this.escapeHtml(order.reference_number || order.order_id) + '">' +
            '<div class="card-header-row">' +
                '<div class="order-info">' +
                    '<div class="order-id">#' + this.escapeHtml(order.reference_number || order.order_id) + '</div>' +
                    '<div class="order-meta">' +
                        '<span class="order-type-badge ' + typeClass + '">' + typeLabel + '</span>' +
                        (order.table_number ? '<span class="order-table">Table ' + this.escapeHtml(order.table_number) + '</span>' : '') +
                        (order.customer_name ? '<span class="order-table">' + this.escapeHtml(order.customer_name) + '</span>' : '') +
                    '</div>' +
                '</div>' +
                '<div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">' +
                    '<span class="status-badge ' + statusClass + '">' + statusLabel + '</span>' +
                    rightColumn +
                '</div>' +
            '</div>' +
            '<div class="card-actions">' + actionsHtml + '</div>' +
            '<div class="expanded-detail">' + expandedItemsHtml + '</div>' +
            '<div class="expand-indicator" style="text-align: center; padding: 8px; color: #adb5bd;">' +
                '<i class="bi bi-chevron-down"></i> Tap to expand' +
            '</div>' +
        '</article>';
    }
    createExpandedItem(item, orderId) {
        const qty = Number(item.quantity) || 1;
        let qtyClass = 'qty-1';
        if (qty === 2) qtyClass = 'qty-2';
        else if (qty === 3) qtyClass = 'qty-3';
        else if (qty >= 4) qtyClass = 'qty-4plus';

        const specialHtml = item.special_instructions
            ? '<span class="item-special"><i class="bi bi-exclamation-triangle"></i> ' + this.escapeHtml(item.special_instructions) + '</span>'
            : '';

        // Minutes for the WHOLE line (unit time x qty) - this is what gets
        // deducted when the tick goes on.
        const lineMinutes = Number(item.prep_minutes_total)
            || ((Number(item.estimated_prep_time) || 0) * qty);

        const prepHtml = lineMinutes > 0
            ? '<span class="item-prep-time"><i class="bi bi-hourglass-split"></i> ' + lineMinutes + ' min</span>'
            : '';

        const isPrepared = !!Number(item.is_prepared);

        return '' +
        '<div class="expanded-item" data-item-id="' + item.order_item_id + '" data-prep-minutes="' + lineMinutes + '"' +
            (isPrepared ? ' data-prepared="1" style="display: flex; align-items: center; gap: 12px; transition: opacity 0.2s ease; opacity: 0.4;"' : ' style="display: flex; align-items: center; gap: 12px; transition: opacity 0.2s ease;"') + '>' +
            '<input type="checkbox" class="item-checkbox" data-order-id="' + orderId + '" data-item-id="' + item.order_item_id + '"' + (isPrepared ? ' checked' : '') + ' style="width: 18px; height: 18px; cursor: pointer;">' +
            '<div class="item-qty ' + qtyClass + '">' + qty + '</div>' +
            '<div class="item-details" style="flex: 1;">' +
                '<div class="item-name"' + (isPrepared ? ' style="text-decoration: line-through;"' : '') + '>' + this.escapeHtml(item.item_name) + '</div>' +
                specialHtml + prepHtml +
            '</div>' +
        '</div>';
    }

    groupItemsByCategory(items) {
        const grouped = {};
        items.forEach(item => {
            const category = item.category_name || 'Other';
            if (!grouped[category]) grouped[category] = [];
            grouped[category].push(item);
        });
        return grouped;
    }

    updateCounts(cookingCount, inProgressCount) {
        const cookingEl = document.getElementById('cookingCount');
        const inProgressEl = document.getElementById('inProgressCount');
        if (cookingEl) cookingEl.textContent = cookingCount;
        if (inProgressEl) inProgressEl.textContent = inProgressCount;
    }

    // ---------------------------------------------------------------
    // Event wiring
    // ---------------------------------------------------------------
    setupEvents() {
        const refreshBtn = document.querySelector('[onclick="kitchenUI.refreshOrders()"]');
        if (refreshBtn) refreshBtn.addEventListener('click', () => this.loadOrders());
    }

    bindSectionEvents(container) {
        // Expand / collapse
        container.querySelectorAll('.order-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('.btn-action') || e.target.closest('.item-checkbox')) return;
                const orderId = parseInt(card.getAttribute('data-order-id'), 10);
                card.classList.toggle('expanded');
                if (card.classList.contains('expanded')) this.expanded.add(orderId);
                else this.expanded.delete(orderId);
            });
        });

        // Item ticks
        container.querySelectorAll('.item-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => this.handleItemToggle(e.target));
        });

        // Check All
        container.querySelectorAll('.btn-check-all').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.handleCheckAll(parseInt(btn.getAttribute('data-order-id'), 10), btn);
            });
        });

        // Start cooking
        container.querySelectorAll('.btn-start-cooking').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.handleStartCooking(parseInt(btn.getAttribute('data-order-id'), 10));
            });
        });

        // Mark done
        container.querySelectorAll('.btn-mark-done').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.handleMarkDone(parseInt(btn.getAttribute('data-order-id'), 10), btn);
            });
        });
    }
    // ---------------------------------------------------------------
    // Actions
    // ---------------------------------------------------------------

    /**
     * Tick / untick one item. The server decides how many minutes that is
     * worth, then we patch the timer in place - no full board re-render,
     * so nothing else on the screen flickers.
     */
    async handleItemToggle(checkbox) {
        const row = checkbox.closest('.expanded-item');
        if (!row) return;

        const orderId = parseInt(checkbox.getAttribute('data-order-id'), 10);
        const itemId = parseInt(checkbox.getAttribute('data-item-id'), 10);
        const prepared = checkbox.checked;

        // Optimistic paint so the tap feels instant.
        this.paintItemRow(row, prepared);
        checkbox.disabled = true;

        try {
            const res = await this.api.toggleItem(orderId, itemId, prepared);
            const remaining = res.data ? res.data.prep_remaining : null;
            if (remaining !== null) this.timer.applyServerLedger(orderId, remaining);

            // Past the grace window the server keeps the deduction, so undo the
            // local un-tick instead of showing a tick that will snap back.
            if (res.data && res.data.locked) {
                checkbox.checked = true;
                this.paintItemRow(row, true);
                this.toast(res.message || 'Too late to undo - that time is already deducted.');
            }
        } catch (err) {
            // Roll the tick back - the timer must never lie.
            checkbox.checked = !prepared;
            this.paintItemRow(row, !prepared);
            Swal.fire({ icon: 'error', title: 'Could not update', text: err.message, confirmButtonColor: '#dc3545' });
        } finally {
            checkbox.disabled = false;
            this.refreshLockState(orderId);
            // REQ-054 B4-D: after ANY item toggle (including un-checking one
            // item), recompute the "Check All" button state so it becomes
            // selectable again once not every item is ticked.
            this.refreshCheckAllButton(orderId);
        }
    }

    /**
     * REQ-054 B4-D: recompute the Check All button's enabled state from the
     * actual checkbox state on the card. After "check all" then un-checking a
     * single item, the button must be selectable again.
     */
    refreshCheckAllButton(orderId) {
        const card = document.querySelector('.order-card[data-order-id="' + orderId + '"]');
        if (!card) return;
        const boxes = card.querySelectorAll('.item-checkbox');
        if (boxes.length === 0) return;
        const allChecked = Array.prototype.every.call(boxes, cb => cb.checked);
        card.querySelectorAll('.btn-check-all').forEach(btn => {
            btn.disabled = allChecked;
            btn.style.opacity = allChecked ? '0.5' : '';
            btn.style.cursor = allChecked ? 'default' : 'pointer';
        });
    }

    /**
     * After the 10-minute grace window an un-tick gives no time back, so the
     * boxes become read-only rather than offering a switch that does nothing.
     */
    refreshLockState(orderId) {
        const order = this.orders.find(o => o.order_id === orderId);
        if (!order || !order.unlock_deadline_epoch) return;

        const nowSec = Math.floor(Date.now() / 1000);
        const locked = nowSec > Number(order.unlock_deadline_epoch);

        const card = document.querySelector('.order-card[data-order-id="' + orderId + '"]');
        if (!card) return;

        card.querySelectorAll('.item-checkbox').forEach(cb => {
            // Ticking a NEW dish stays allowed forever; only un-ticking is gated.
            if (!cb.checked) {
                cb.disabled = locked;
                cb.style.opacity = locked ? '0.35' : '';
                cb.style.cursor = locked ? 'not-allowed' : 'pointer';
            }
        });

        if (locked) {
            card.setAttribute('data-locked', '1');
        } else {
            card.removeAttribute('data-locked');
        }
    }

    toast(message) {
        if (typeof Swal !== 'undefined' && typeof Swal.fire === 'function') {
            Swal.fire({ icon: 'info', title: 'Heads up', text: message, timer: 2200, showConfirmButton: false });
        }
    }

    paintItemRow(row, prepared) {
        row.style.opacity = prepared ? '0.4' : '1';
        const nameEl = row.querySelector('.item-name');
        if (nameEl) nameEl.style.textDecoration = prepared ? 'line-through' : 'none';
    }

    async handleCheckAll(orderId, btn) {
        try {
            Swal.showLoading();
            const res = await this.api.checkAll(orderId);
            Swal.close();

            // Snap the timer to 0 and tick every box on the card.
            this.timer.applyServerLedger(orderId, 0);
            const card = btn.closest('.order-card');
            if (card) {
                card.querySelectorAll('.item-checkbox').forEach(cb => {
                    if (!cb.checked) {
                        cb.checked = true;
                        this.paintItemRow(cb.closest('.expanded-item'), true);
                    }
                });
            }
            // REQ-054 B4-D: now that every box is checked, disable the button
            // (it becomes re-selectable as soon as any item is un-checked).
            this.refreshCheckAllButton(orderId);
        } catch (err) {
            Swal.close();
            Swal.fire({ icon: 'error', title: 'Error', text: err.message, confirmButtonColor: '#dc3545' });
        }
    }

    async handleStartCooking(orderId) {
        try {
            Swal.showLoading();
            await this.api.updateStatus(orderId, 'COOKING');
            Swal.close();
            // The order moves to the cooking column; pull the fresh state.
            await this.loadOrders();
        } catch (err) {
            Swal.close();
            Swal.fire({ icon: 'error', title: 'Error', text: err.message, confirmButtonColor: '#dc3545' });
        }
    }

    async handleMarkDone(orderId, btnElement) {
        const orderCard = btnElement.closest('.order-card');
        if (orderCard) {
            const all = orderCard.querySelectorAll('.item-checkbox');
            const pending = orderCard.querySelectorAll('.item-checkbox:not(:checked)');
            if (all.length > 0 && pending.length > 0) {
                await Swal.fire({
                    icon: 'warning',
                    title: 'Incomplete Items',
                    text: 'Some items are not yet checked off as prepared. Press "Check All" or tick the rest before marking the order as done.',
                    confirmButtonColor: '#f0ad4e'
                });
                return;
            }
        }

        const result = await Swal.fire({
            title: 'Mark Order as Done?',
            text: 'The waiter will be notified to serve it.',
            icon: 'question',
            showCancelButton: true,
            confirmButtonColor: '#28a745',
            cancelButtonColor: '#6c757d',
            confirmButtonText: 'Yes, mark done!'
        });
        if (!result.isConfirmed) return;

        try {
            Swal.showLoading();
            await this.api.updateStatus(orderId, 'COMPLETED');
            Swal.close();
            await this.loadOrders();
        } catch (err) {
            Swal.close();
            Swal.fire({ icon: 'error', title: 'Error', text: err.message, confirmButtonColor: '#dc3545' });
        }
    }

    showErrorState(message) {
        ['cookingOrders', 'inProgressOrders'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.innerHTML = '<div class="empty-state" style="min-width: 100%;"><i class="bi bi-exclamation-triangle-fill text-danger"></i><p>Failed to load</p><small>' + this.escapeHtml(message) + '</small></div>';
            }
        });
    }

    /**
     * HTML-escape. The previous implementation replaced &, <, > and " with
     * THEMSELVES, so it escaped nothing and every card was injectable via
     * item names / special instructions.
     */
    escapeHtml(text) {
        if (text === null || text === undefined) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    async refreshOrders() {
        await this.loadOrders();
    }
}

// =======================================
// INITIALIZATION
// =======================================
let kitchenUI;

document.addEventListener('DOMContentLoaded', () => {
    kitchenUI = new KitchenUI();
    kitchenUI.init();
    window.kitchenUI = kitchenUI;
});