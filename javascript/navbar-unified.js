/**
 * UNIFIED NAVBAR COMPONENT - House of Fries
 * Works across all roles with consistent design and role-specific features
 * 
 * Features:
 * - Consistent top navbar across all roles
 * - Role-specific search (context-aware)
 * - Role-specific notifications
 * - Real-time notification badge
 * - Session management via navbar.js
 */

(function() {
    'use strict';

    // ========================================
    // ROLE CONFIGURATION
    // ========================================
    const ROLE_CONFIG = {
        admin: {
            searchPlaceholder: 'Search orders, inventory, users...',
            searchEndpoint: '/backend/admin/search.php',
            searchType: 'global',
            notifications: {
                endpoint: '/backend/admin/get_notifications.php',
                types: ['low_stock', 'pending_approvals', 'system_alerts'],
                title: 'System Alerts'
            },
            sidebarMenu: 'admin'
        },
        cashier: {
            searchPlaceholder: 'Search orders, products...',
            searchEndpoint: '/backend/cashier/search.php',
            searchType: 'orders_products',
            notifications: {
                endpoint: '/backend/cashier/get_notifications.php',
                types: ['pending_orders', 'payment_issues'],
                title: 'Order Alerts'
            },
            sidebarMenu: 'cashier'
        },
        kitchen: {
            searchPlaceholder: 'Search orders...',
            searchEndpoint: '/backend/kitchenStaff/search.php',
            searchType: 'orders',
            notifications: {
                endpoint: '/backend/kitchenStaff/get_notifications.php',
                types: ['new_orders', 'priority_orders'],
                title: 'Order Alerts'
            },
            sidebarMenu: 'kitchen'
        },
        waiter: {
            searchPlaceholder: 'Search tables, orders...',
            searchEndpoint: '/backend/waiter/search.php',
            searchType: 'tables_orders',
            notifications: {
                endpoint: '/backend/waiter/get_notifications.php',
                types: ['table_requests', 'order_updates'],
                title: 'Floor Alerts'
            },
            sidebarMenu: 'waiter'
        },
        supervisor: {
            searchPlaceholder: 'Search orders, staff, inventory...',
            // The legacy backend/supervisor/ tree was removed. Supervisor now runs
            // the Admin UI, so it reuses the Admin search + notification endpoints.
            searchEndpoint: '/backend/admin/search.php',
            searchType: 'global',
            notifications: {
                endpoint: '/backend/admin/get_notifications.php',
                types: ['low_stock', 'pending_approvals', 'staff_alerts'],
                title: 'Branch Alerts'
            },
            sidebarMenu: 'supervisor'
        },
        inventory: {
            searchPlaceholder: 'Search materials, suppliers...',
            searchEndpoint: '/backend/inventoryStaff/search.php',
            searchType: 'materials_suppliers',
            notifications: {
                endpoint: '/backend/admin/get_notifications.php',
                types: ['low_stock', 'out_of_stock', 'spoilage'],
                title: 'Stock Alerts'
            },
            sidebarMenu: 'inventory'
        },
        customer: {
            searchPlaceholder: 'Search menu...',
            searchEndpoint: '/backend/customer/search.php',
            searchType: 'menu',
            notifications: {
                endpoint: '/backend/customer/get_notifications.php',
                types: ['order_status', 'promotions'],
                title: 'Updates'
            },
            sidebarMenu: 'customer'
        }
    };

    // ========================================
    // STATE
    // ========================================
    let currentRole = null;
    let notificationPollingInterval = null;

    // ========================================
    // INITIALIZATION
    // ========================================
    function initNavbar() {
        // Determine role from current page path
        currentRole = detectRole();
        if (!currentRole) {
            console.warn('[Navbar] Could not detect role, defaulting to admin');
            currentRole = 'admin';
        }

        const appRoot = (() => {
            try {
                const m = window.location.pathname.match(/^(.*?)(?:\/public|\/customer|\/backend|\/admin|\/cashier|\/inventoryStaff|\/kitchenStaff|\/waiter|\/supervisor)(?:\/|$)/i);
                return (m && m[1]) ? m[1].replace(/\/$/, '') : '';
            } catch (_) { return ''; }
        })();

        function apiUrl(path) {
            return appRoot + path;
        }

        const config = ROLE_CONFIG[currentRole];
        if (!config) {
            console.warn('[Navbar] Unknown role:', currentRole);
            config = ROLE_CONFIG.admin;
        }

        // Build navbar HTML
        buildNavbar(config);

        // REQ-066 C: restore the persisted sidebar state (mini-rail). The toggle
        // writes hof_sidebar_collapsed, but nothing ever READ it back, so every
        // page load re-expanded the sidebar ("it expands on its own"). Apply the
        // saved state once, before the user interacts, on desktop only.
        try {
            const savedCollapsed = localStorage.getItem('hof_sidebar_collapsed');
            const sidebar = document.getElementById('sidebar');
            if (sidebar && !isMobileViewport() && savedCollapsed === 'true') {
                sidebar.classList.add('collapsed', 'active');
            }
        } catch (e) {
            /* localStorage unavailable — ignore */
        }

        // Setup event listeners
        setupNotifications(config);
        setupSidebarToggle();
        setupLogout();
        setupSessionCheck();

        // Start notification polling
        startNotificationPolling(config);
    }

    function detectRole() {
        const path = window.location.pathname;
        if (path.includes('/public/admin/') || path.includes('/admin/')) return 'admin';
        if (path.includes('/public/cashier/') || path.includes('/cashier/')) return 'cashier';
        if (path.includes('/public/kitchenStaff/') || path.includes('/kitchen/')) return 'kitchen';
        if (path.includes('/public/waiter/') || path.includes('/waiter/')) return 'waiter';
        if (path.includes('/public/supervisor/') || path.includes('/supervisor/')) return 'supervisor';
        if (path.includes('/public/inventoryStaff/') || path.includes('/inventory/')) return 'inventory';
        if (path.includes('/customer/')) return 'customer';
        return null;
    }

    // ========================================
    // NAVBAR HTML BUILDER
    // ========================================
    function buildNavbar(config) {
            const navbar = document.querySelector('.top-navbar, .topbar, nav.navbar');
            if (!navbar) return;

            // Check if already built
            if (navbar.querySelector('#unifiedNavbar')) return;

            // If static HTML already has sidebar controls, skip full injection.
            // Just add a hidden #unifiedNavbar marker div so subsequent calls skip too.
            if (navbar.querySelector('#sidebarCollapse')) {
                const marker = document.createElement('div');
                marker.id = 'unifiedNavbar';
                marker.style.display = 'none';
                navbar.appendChild(marker);
                return;
            }

            // Remove any old sidebarCollapse button in the navbar (page-level)
            // so we don't get duplicates — our unified version takes over
            const oldBtn = navbar.querySelector('#sidebarCollapse');
            if (oldBtn && !oldBtn.closest('#unifiedNavbar')) {
                oldBtn.remove();
            }

            const navbarHTML = `
                <div id="unifiedNavbar" class="d-flex align-items-center w-100">
                    <!-- Sidebar Toggle -->
                    <button type="button" id="sidebarCollapse" class="btn btn-light border me-3 sidebar-toggle" aria-label="Toggle sidebar">
                        <i class="bi bi-list fs-5"></i>
                    </button>

                    <!-- Page Title -->
                    <span class="fw-bold fs-5 flex-grow-1" id="navbarPageTitle">${currentRole.charAt(0).toUpperCase() + currentRole.slice(1)} Panel</span>

                    <!-- Notifications -->
                    <div class="dropdown me-2">
                        <a href="#" class="text-dark position-relative link-dark notification-trigger" 
                           id="notificationDropdown" data-bs-toggle="dropdown" aria-expanded="false">
                            <i class="bi bi-bell fs-5"></i>
                            <span id="notificationBadge" class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger d-none" style="font-size: 0.65rem;">0</span>
                        </a>
                        <ul class="dropdown-menu dropdown-menu-end shadow border mt-2" 
                            aria-labelledby="notificationDropdown" id="notificationMenu" 
                            style="width: 340px; max-height: 420px; overflow-y: auto;">
                            <li class="dropdown-header border-bottom fw-bold text-dark d-flex justify-content-between align-items-center">
                                <span>${config.notifications.title}</span>
                                <small class="text-muted" id="notificationUpdated">Just now</small>
                            </li>
                            <li id="emptyNotificationItem"><span class="dropdown-item text-muted text-center py-3">All clear!</span></li>
                        </ul>
                    </div>

                    <!-- User Profile Dropdown -->
                    <div class="dropdown ms-2">
                        <a href="#" class="d-flex align-items-center text-dark text-decoration-none" id="userDropdown" data-bs-toggle="dropdown" aria-expanded="false">
                            <div class="user-avatar-sm bg-warning text-dark rounded-circle d-flex align-items-center justify-content-center me-2" style="width: 32px; height: 32px; font-weight: 600; font-size: 0.85rem;" id="navbarUserAvatar">U</div>
                            <span class="d-none d-md-inline fw-medium" id="navbarUserName">User</span>
                        </a>
                        <ul class="dropdown-menu dropdown-menu-end shadow border mt-2" aria-labelledby="userDropdown" style="min-width: 200px;">
                            <li><h6 class="dropdown-header">Account</h6></li>
                            <li><a class="dropdown-item" href="#"><i class="bi bi-person me-2"></i>Profile</a></li>
                            <li><a class="dropdown-item" href="#"><i class="bi bi-gear me-2"></i>Settings</a></li>
                            <li><hr class="dropdown-divider"></li>
                            <li><a class="dropdown-item text-danger" href="#" id="logoutBtn"><i class="bi bi-box-arrow-right me-2"></i>Logout</a></li>
                        </ul>
                    </div>
                </div>
            `;

            // Insert unified navbar at the start, preserving any existing page content
            // (search inputs, page titles, filters) that the page placed in .topbar
            navbar.insertAdjacentHTML('afterbegin', navbarHTML);
        
            // Update user info from session
            updateUserInfo();
        }

    async function updateUserInfo() {
        const token = localStorage.getItem('hof_token');
        if (!token) return;

        try {
            const res = await fetch('/backend/check_session.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token })
            });
            const data = await res.json();
            if (data.loggedIn) {
                const avatar = document.getElementById('navbarUserAvatar');
                const name = document.getElementById('navbarUserName');
                if (avatar) avatar.textContent = (data.first_name || 'U')[0].toUpperCase();
                if (name) name.textContent = `${data.first_name || ''} ${data.last_name || ''}`.trim();
            }
        } catch (e) {
            console.warn('[Navbar] Failed to update user info:', e);
        }
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ========================================
    // NOTIFICATIONS
    // ========================================
    function setupNotifications(config) {
        // Mark as read on click
        const menu = document.getElementById('notificationMenu');
        if (menu) {
            menu.addEventListener('click', (e) => {
                const item = e.target.closest('[data-notification-id]');
                if (item) {
                    markNotificationRead(item.dataset.notificationId);
                }
            });
        }
    }

    async function fetchNotifications(config) {
        try {
            const token = localStorage.getItem('hof_token');
            if (!token) return { success: false };

            const res = await fetch(config.notifications.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ token })
            });

            return await res.json();
        } catch (err) {
            console.error('[Navbar] Notification fetch error:', err);
            return { success: false };
        }
    }

    async function renderNotifications(config) {
        const badge = document.getElementById('notificationBadge');
        const menu = document.getElementById('notificationMenu');
        const emptyItem = document.getElementById('emptyNotificationItem');
        const updatedEl = document.getElementById('notificationUpdated');

        if (!badge || !menu) return;

        const data = await fetchNotifications(config);
        
        if (data.success && data.items && data.items.length > 0) {
            // Prefer the server's unread count (role-scoped) over the visible row count
            const count = (typeof data.unread_count === 'number') ? data.unread_count : data.items.length;
            badge.textContent = count > 99 ? '99+' : count;
            badge.classList.toggle('d-none', count === 0);

            menu.innerHTML = `
                <li class="dropdown-header border-bottom fw-bold text-dark d-flex justify-content-between align-items-center">
                    <span>${config.notifications.title}</span>
                    <small class="text-muted" id="notificationUpdated">${formatTimeAgo(new Date())}</small>
                </li>
                ${data.items.map(item => `
                    <li>
                        <a href="${item.url || '#'}" class="dropdown-item d-flex align-items-start py-2 ${item.read ? '' : 'fw-bold'}" 
                           data-notification-id="${item.id || ''}">
                            <i class="bi ${getNotificationIcon(item.type)} me-2 mt-1 text-${getNotificationColor(item.type)}"></i>
                            <div class="flex-grow-1">
                                <div class="small">${escapeHtml(item.message || item.item_name || 'Notification')}</div>
                                <div class="text-muted" style="font-size: 0.7rem;">${formatTimeAgo(new Date(item.created_at || Date.now()))}</div>
                            </div>
                            ${!item.read ? '<span class="badge bg-warning rounded-pill">New</span>' : ''}
                        </a>
                    </li>
                `).join('')}
            `;

            if (emptyItem) emptyItem.remove();
        } else {
            badge.classList.add('d-none');
            badge.textContent = '0';
            if (emptyItem) {
                emptyItem.innerHTML = '<span class="dropdown-item text-muted text-center py-3">All clear!</span>';
            } else {
                menu.innerHTML = `
                    <li class="dropdown-header border-bottom fw-bold text-dark">${config.notifications.title}</li>
                    <li id="emptyNotificationItem"><span class="dropdown-item text-muted text-center py-3">All clear!</span></li>
                `;
            }
        }

        if (updatedEl) updatedEl.textContent = formatTimeAgo(new Date());
    }

    function getNotificationIcon(type) {
        const icons = {
            low_stock: 'bi-exclamation-triangle',
            out_of_stock: 'bi-x-circle',
            spoilage: 'bi-trash3',
            new_orders: 'bi-bag-plus',
            priority_orders: 'bi-lightning',
            table_requests: 'bi-person-raised-hand',
            order_updates: 'bi-arrow-repeat',
            pending_approvals: 'bi-check2-square',
            staff_alerts: 'bi-people',
            system_alerts: 'bi-shield-exclamation',
            payment_issues: 'bi-credit-card',
            order_status: 'bi-truck',
            promotions: 'bi-gift'
        };
        return icons[type] || 'bi-bell';
    }

    function getNotificationColor(type) {
        const colors = {
            low_stock: 'warning',
            out_of_stock: 'danger',
            spoilage: 'danger',
            new_orders: 'primary',
            priority_orders: 'warning',
            table_requests: 'info',
            order_updates: 'success',
            pending_approvals: 'warning',
            staff_alerts: 'info',
            system_alerts: 'danger',
            payment_issues: 'danger',
            order_status: 'primary',
            promotions: 'success'
        };
        return colors[type] || 'secondary';
    }

    function formatTimeAgo(date) {
        const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
        if (seconds < 60) return 'Just now';
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        return `${days}d ago`;
    }

    async function markNotificationRead(id) {
        if (!id) return;
        const token = localStorage.getItem('hof_token');
        try {
            const res = await fetch('/backend/notifications/mark_read.php', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                body: JSON.stringify({ id })
            });
            const data = await res.json();
            if (data && data.success) {
                // Optimistic UI update: drop unread emphasis + decrement the badge.
                const row = document.querySelector(`[data-notification-id="${id}"]`);
                if (row) {
                    row.classList.remove('fw-bold');
                    const badge = document.getElementById('notificationBadge');
                    if (badge) {
                        const n = parseInt(badge.textContent, 10) || 0;
                        const next = Math.max(0, n - 1);
                        badge.textContent = next > 99 ? '99+' : String(next);
                        if (next === 0) badge.classList.add('d-none');
                    }
                }
            }
        } catch (err) {
            console.warn('[Navbar] Mark notification read failed:', err);
        }
    }

    function startNotificationPolling(config) {
        // Initial fetch
        renderNotifications(config);
        
        // Poll every 30 seconds
        if (notificationPollingInterval) clearInterval(notificationPollingInterval);
        notificationPollingInterval = setInterval(() => {
            renderNotifications(config);
        }, 30000);
    }

    // ========================================
    // SIDEBAR TOGGLE
    // ========================================
    function isMobileViewport() {
        return window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
    }

    function setupSidebarToggle() {
        const toggle = document.getElementById('sidebarCollapse');
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebarOverlay');

        if (!sidebar) return;

        if (overlay) overlay.classList.remove('open', 'active');

        // Sidebar expands ONLY on toggle click (hover-expand removed per owner request).
        // Auto-collapse on small devices handled via CSS + isMobileViewport toggle.

        if (toggle) {
            toggle.addEventListener('click', () => {
                const mobile = isMobileViewport();

                if (mobile) {
                    // Mobile: toggle off-canvas drawer with .open class, keep .active for backward compat
                    sidebar.classList.toggle('open');
                    sidebar.classList.add('active');
                    if (overlay) overlay.classList.toggle('open', sidebar.classList.contains('open'));
                } else {
                    // Desktop: toggle mini-rail with .collapsed class, keep .active in sync
                    sidebar.classList.toggle('collapsed');
                    sidebar.classList.toggle('active', sidebar.classList.contains('collapsed'));
                    localStorage.setItem('hof_sidebar_collapsed', sidebar.classList.contains('collapsed'));
                }
            });
        }

        if (overlay) {
            overlay.addEventListener('click', () => {
                sidebar.classList.remove('open', 'collapsed', 'active');
                overlay.classList.remove('open', 'active');
                if (!isMobileViewport()) {
                    localStorage.setItem('hof_sidebar_collapsed', 'false');
                }
            });
        }

        // Close the mobile drawer (and drop a stale scrim) when resizing up
        window.addEventListener('resize', () => {
            if (!isMobileViewport() && overlay) {
                overlay.classList.remove('open', 'active');
            }
        });
    }

    // ========================================
    // SESSION CHECK (from navbar.js)
    // ========================================
    async function setupSessionCheck() {
        // Customers are anonymous (QR scan → no hof_token by design).
        // Running the staff session check here used to kick every
        // customer out to the login page — skip it for this role.
        if (currentRole === 'customer') {
            return;
        }

        const token = localStorage.getItem('hof_token');
        if (!token) {
            redirectToLogin();
            return;
        }

        try {
            const res = await fetch('/backend/check_session.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token })
            });
            const data = await res.json();

            if (!data.loggedIn) {
                localStorage.removeItem('hof_token');
                redirectToLogin();
            } else {
                // Update sidebar user info
                const nameEl = document.querySelector('.user-name');
                const roleEl = document.querySelector('.user-role');
                const avatarEl = document.querySelector('.user-avatar');
                if (nameEl) nameEl.textContent = `${data.first_name} ${data.last_name}`;
                if (roleEl) roleEl.textContent = data.role;
                // REQ-057: raw materials are READ-ONLY for Inventory Staff — hide manage controls.
                if (String(data.role).toLowerCase() === 'inventory staff') {
                    document.querySelectorAll('.js-material-edit-btn, .js-material-delete-btn, #inventoryActionBtn, .js-raw-add-btn').forEach(el => { if (el) el.classList.add('d-none'); });
                }
                // REQ-052 B2-2: sidebar avatar shows the user's initial
                if (avatarEl) avatarEl.textContent = (data.first_name || 'U')[0].toUpperCase();
                
                // Update navbar user info
                updateUserInfo();
            }
        } catch (err) {
            // Navigation aborted fetch — do NOT clear token.
            // The session check will run again on the next page load.
            console.warn('[Navbar] Session check aborted (likely navigation):', err);
        }
    }

    function redirectToLogin() {
        // Determine correct path back to login
        const path = window.location.pathname;
        const depth = path.split('/').filter(Boolean).length;
        const prefix = '../'.repeat(Math.max(0, depth - 1));
        window.location.href = `${prefix}index.html`;
    }

    // ========================================
    // LOGOUT
    // ========================================
    function setupLogout() {
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', (e) => {
                e.preventDefault();
                // Delegate to logout.js branded overlay if available
                if (typeof window.hofLogout === 'function') {
                    window.hofLogout();
                } else if (typeof window.logout === 'function') {
                    window.logout();
                } else {
                    // Fallback: plain redirect (logout.js not loaded)
                    localStorage.removeItem('hof_token');
                    redirectToLogin();
                }
            });
        }
    }

    // ========================================
    // PUBLIC API
    // ========================================
    window.HOFNavbar = {
        init: initNavbar,
        refreshNotifications: () => {
            if (currentRole && ROLE_CONFIG[currentRole]) {
                renderNotifications(ROLE_CONFIG[currentRole]);
            }
        },
        getRole: () => currentRole,
        showNotification: (message, type = 'info') => {
            // Show a temporary toast notification
            const toast = document.createElement('div');
            toast.className = `toast align-items-center text-white bg-${type} border-0 position-fixed bottom-0 end-0 m-3`;
            toast.setAttribute('role', 'alert');
            toast.innerHTML = `
                <div class="d-flex">
                    <div class="toast-body">${escapeHtml(message)}</div>
                    <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
                </div>
            `;
            document.body.appendChild(toast);
            const bsToast = new bootstrap.Toast(toast, { delay: 3000 });
            bsToast.show();
            toast.addEventListener('hidden.bs.toast', () => toast.remove());
        }
    };

    // ========================================
    // AUTO-INIT
    // ========================================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initNavbar);
    } else {
        initNavbar();
    }
})();