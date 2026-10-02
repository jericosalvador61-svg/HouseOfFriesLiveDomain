/**
 * customer/account.js
 * REQ-052 Batch 3 — Shared customer-account chip + auth modal.
 *
 * Loaded AFTER device.js on customer.html, orderHistory.html,
 * orderTracker.html, cart.html and checkout.html.
 *
 * Exposes:
 *   window.HOFCustomer = {
 *     isLoggedIn(), getName(), getPhone(), getToken(),
 *     logout(), authFetch(url, opts), renderChip()
 *   }
 *
 * Token storage: localStorage 'hof_customer_token' + a SameSite=Strict cookie
 * mirror (path=/) so backend helpers that read only the cookie stay consistent.
 * All server values rendered into HTML pass through escapeHtml.
 */
(function () {
    'use strict';

    var TOKEN_KEY = 'hof_customer_token';

    function escapeHtml(text) {
        if (text === null || text === undefined) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Pick the app root so /backend/... and customer/*.php resolve correctly
    // on localhost subfolders and the live root domain.
    function appRoot() {
        var m = window.location.pathname.match(/^(.*?)(?:\/public|\/customer|\/backend|\/admin|\/cashier|\/inventoryStaff|\/kitchenStaff|\/waiter|\/supervisor)(?:\/|$)/i);
        return (m && m[1]) ? m[1].replace(/\/$/, '') : '';
    }

    function root(url) {
        if (url.indexOf('/') === 0) return appRoot() + url;
        // Relative paths like 'register.php' from a customer/ page.
        var base = (window.location.pathname.split('/').slice(0, -1).join('/'));
        return base + '/' + url;
    }

    function readToken() {
        return localStorage.getItem(TOKEN_KEY) || '';
    }

    function writeToken(token, name, phone) {
        localStorage.setItem(TOKEN_KEY, token);
        if (name) localStorage.setItem(TOKEN_KEY + '_name', name);
        if (phone !== undefined && phone !== null) localStorage.setItem(TOKEN_KEY + '_phone', phone);
        // Cookie mirror (path=/, SameSite=Strict, 24h) for backend cookie readers.
        // Max-Age keeps the cookie alive across browser restarts so a logged-in
        // customer's next order still links via customer_account_id (AC10b).
        var secure = (location.protocol === 'https:') ? '; Secure' : '';
        document.cookie = TOKEN_KEY + '=' + encodeURIComponent(token) + '; path=/; Max-Age=86400; SameSite=Strict' + secure;
    }

    // Re-mirror the localStorage token into the cookie on page load (covers a
    // browser restart where the session cookie was dropped but the token lives on).
    function syncCookie() {
        var t = readToken();
        if (t && document.cookie.indexOf(TOKEN_KEY + '=') === -1) {
            writeToken(t, getName(), getPhone());
        }
        // REQ-054 B4-F: keep the ordering name in sync with the logged-in
        // account so a takeout/dine-in order auto-fills the customer's full name.
        syncCustomerName();
    }

    // REQ-054 B4-F: when a customer account is logged in, their full name
    // auto-fills the order (customerName). Guest orders keep whatever name
    // the customer typed.
    function syncCustomerName() {
        if (!isLoggedIn()) return;
        var n = (getName() || '').trim();
        if (n) localStorage.setItem('customerName', n);
    }

    function clearToken() {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(TOKEN_KEY + '_name');
        localStorage.removeItem(TOKEN_KEY + '_phone');
        document.cookie = TOKEN_KEY + '=; path=/; Max-Age=0; SameSite=Strict';
    }

    function getName() {
        var name = localStorage.getItem(TOKEN_KEY + '_name') || '';
        // Fallback: decode the JWT payload for the name.
        if (!name) {
            var t = readToken();
            if (t) {
                try {
                    var payload = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
                    name = payload.name || '';
                } catch (e) { name = ''; }
            }
        }
        return name;
    }

    function getPhone() {
        var p = localStorage.getItem(TOKEN_KEY + '_phone') || '';
        if (!p) {
            var t = readToken();
            if (t) {
                try {
                    var payload = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
                    p = payload.phone_number || '';
                } catch (e) { p = ''; }
            }
        }
        return p;
    }

    function isLoggedIn() {
        return !!readToken();
    }

    // Authenticated fetch — attaches Bearer token + app-root base.
    function authFetch(url, options) {
        options = options || {};
        options.headers = options.headers || {};
        var token = readToken();
        if (token) options.headers['Authorization'] = 'Bearer ' + token;
        return fetch(url.indexOf('/') === 0 ? root(url) : url, options);
    }

    function logout(onDone) {
        // Best-effort server logout (logs the event), then clear local state.
        try {
            authFetch('logout.php', { method: 'POST' }).catch(function () {});
        } catch (e) { /* ignore */ }
        clearToken();
        // REQ-054 B1: wipe the device order history on logout so a
        // different person using this device doesn't inherit the last
        // customer's orders. Server-side history reloads when logged in again.
        try {
            localStorage.removeItem('hof_orders');
        } catch (e) { /* ignore */ }
        // REQ-054 B4-F: a logged-out customer's ordering name resets to blank
        // so the next order asks for a name again instead of reusing the account's.
        localStorage.removeItem('customerName');
        if (typeof window.HOFCustomerOnLogout === 'function') {
            try { window.HOFCustomerOnLogout(); } catch (e) {}
        }
        renderChip();
        if (onDone) onDone();
    }

    // ── Account chip ──────────────────────────────────────────────
    function chipStyle() {
        return 'display:inline-flex;align-items:center;gap:6px;height:44px;padding:0 12px;' +
               'border-radius:14px;border:2px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.1);' +
               'color:#fff;font-size:12px;font-weight:700;cursor:pointer;';
    }

    function renderChip() {
        var host = document.getElementById('hofCustomerAccountChip');
        if (!host) return;
        var initial = '';
        if (isLoggedIn()) {
            var n = (getName() || '').trim();
            initial = n ? n.charAt(0).toUpperCase() : 'C';
            host.innerHTML =
                '<button type="button" id="hofAccountChipBtn" style="' + chipStyle() + '" title="' + escapeHtml(n || 'My Account') + '">' +
                    '<span style="width:26px;height:26px;border-radius:50%;background:#FFB800;color:#1e1e1e;' +
                    'display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;">' +
                        escapeHtml(initial) +
                    '</span>' +
                    '<span style="max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
                        escapeHtml(n || 'My Account') +
                    '</span>' +
                '</button>';
            var btn = document.getElementById('hofAccountChipBtn');
            if (btn) {
                btn.addEventListener('click', function () {
                    Swal.fire({
                        title: escapeHtml(n || 'My Account'),
                        html: '<div style="font-size:13px;color:#666;margin-bottom:8px;">' + escapeHtml(getPhone()) + '</div>' +
                              '<a href="orderHistory.html" style="display:block;padding:8px;font-size:13px;font-weight:700;color:#FFB800;text-decoration:none;">My Orders</a>' +
                              '<a href="reset_password.html" style="display:block;padding:8px;font-size:13px;font-weight:700;color:#FFB800;text-decoration:none;">Change Password / Forgot Password</a>',
                        showCancelButton: true,
                        confirmButtonText: 'Logout',
                        confirmButtonColor: '#dc3545',
                        cancelButtonColor: '#888',
                        cancelButtonText: 'Close'
                    }).then(function (result) {
                        if (result.isConfirmed) { window.HOFCustomer.logout(); }
                    });
                });
            }
        } else {
            host.innerHTML = '<button id="hofAccountLoginBtn" style="' + chipStyle() + '"><i class="fa-solid fa-user"></i> Log In</button>';
            var loginBtn = document.getElementById('hofAccountLoginBtn');
            if (loginBtn) loginBtn.addEventListener('click', openAuthModal);
        }
    }

    // ── Auth modal (SweetAlert2 — customer pages have no Bootstrap JS) ──
    var currentTab = 'login';

    function input(label, type, id, ph, extra) {
        return '<div style="text-align:left;margin-bottom:10px;">' +
            '<label style="font-size:12px;font-weight:700;color:#331A11;display:block;margin-bottom:4px;">' + label + '</label>' +
            '<input type="' + type + '" id="' + id + '" placeholder="' + ph + '" style="width:100%;padding:11px 12px;border:1px solid #E5E5EA;border-radius:10px;font-size:14px;box-sizing:border-box;outline:none;"' + (extra || '') + '>' +
            '</div>';
    }
    function showAuth(label, type, id, ph, extra) { return input(label, type, id, ph, extra); }

    function renderAuthModal() {
        var isLogin = currentTab === 'login';
        var tabs = '<div style="display:flex;gap:6px;margin-bottom:14px;">' +
            '<button type="button" data-tab="login" style="flex:1;padding:10px;border-radius:10px;border:none;cursor:pointer;font-weight:800;font-size:13px;' +
                (isLogin ? 'background:#FFB800;color:#1e1e1e;' : 'background:#f0f0f0;color:#666;') + '">Log In</button>' +
            '<button type="button" data-tab="register" style="flex:1;padding:10px;border-radius:10px;border:none;cursor:pointer;font-weight:800;font-size:13px;' +
                (!isLogin ? 'background:#FFB800;color:#1e1e1e;' : 'background:#f0f0f0;color:#666;') + '">Register</button>' +
            '</div>';

        var fields = '';
        if (isLogin) {
            fields = showAuth('Phone Number', 'tel', 'hofLoginPhone', '09171234567', '') +
                     showAuth('Password', 'password', 'hofLoginPassword', '••••••••', '') +
                     '<div style="text-align:right;margin-top:-4px;margin-bottom:8px;">' +
                       '<a href="reset_password.html" style="font-size:12px;color:#0056E3;font-weight:700;text-decoration:none;">Forgot password?</a>' +
                     '</div>' +
                     '<button id="hofSubmitAuth" style="width:100%;padding:13px;border:none;border-radius:12px;background:#FFB800;color:#1e1e1e;font-weight:800;font-size:14px;cursor:pointer;">Log In</button>';
        } else {
            fields = showAuth('Phone Number', 'tel', 'hofRegPhone', '09171234567', '') +
                     showAuth('Full Name', 'text', 'hofRegName', 'Juan Dela Cruz', '') +
                     showAuth('Password', 'password', 'hofRegPassword', 'Min 6 chars, 1 upper, 1 number, 1 special', '') +
                     showAuth('Confirm Password', 'password', 'hofRegConfirm', 'Retype password', '') +
                     '<button id="hofSubmitAuth" style="width:100%;padding:13px;border:none;border-radius:12px;background:#FFB800;color:#1e1e1e;font-weight:800;font-size:14px;cursor:pointer;">Create Account</button>';
        }

        Swal.fire({
            title: isLogin ? 'Welcome Back' : 'Create Account',
            html: tabs + fields +
                '<div style="font-size:11px;color:#999;margin-top:10px;line-height:1.4;">' +
                (isLogin
                    ? 'Log in to see your order history across devices.'
                    : 'Password must be at least 6 characters with an uppercase letter, a number, and a special character.') +
                '</div>',
            showConfirmButton: false,
            showCloseButton: true,
            background: '#fff',
            customClass: { popup: 'rounded-4' },
            didOpen: function () {
                document.querySelectorAll('[data-tab]').forEach(function (el) {
                    el.addEventListener('click', function () {
                        currentTab = this.getAttribute('data-tab');
                        renderAuthModal();
                    });
                });
                var submit = document.getElementById('hofSubmitAuth');
                if (submit) submit.addEventListener('click', function () { handleAuthSubmit(); });
                var phone = document.getElementById(isLogin ? 'hofLoginPhone' : 'hofRegPhone');
                if (phone) phone.focus();
            }
        });
    }

    function normalizePhone(p) {
        p = String(p || '').replace(/[^0-9]/g, '');
        if (p.length === 12 && p.slice(0, 2) === '63') p = '0' + p.slice(2);
        return p;
    }

    function handleAuthSubmit() {
        if (currentTab === 'login') {
            var phone = document.getElementById('hofLoginPhone') ? document.getElementById('hofLoginPhone').value : '';
            var password = document.getElementById('hofLoginPassword') ? document.getElementById('hofLoginPassword').value : '';
            if (!phone || !password) { Swal.fire('Missing Info', 'Please enter your phone number and password.', 'warning'); return; }
            fetch('login.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: normalizePhone(phone), password: password })
            })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) {
                    Swal.fire('Login Failed', data.message || 'Invalid credentials.', 'error');
                    return;
                }
                writeToken(data.token, data.name, data.phone);
                Swal.close();
                renderChip();
                syncCustomerName(); // REQ-054 B4-F: auto-fill the order name
                if (typeof window.HOFCustomerOnLogin === 'function') window.HOFCustomerOnLogin(data);
                Swal.fire({ icon: 'success', title: 'Welcome back, ' + escapeHtml(data.name || '') + '!', text: 'You are now logged in.', timer: 1800, showConfirmButton: false });
            })
            .catch(function () { Swal.fire('Error', 'Could not reach the server. Please try again.', 'error'); });
        } else {
            var phone = document.getElementById('hofRegPhone');
            var name = document.getElementById('hofRegName');
            var pass = document.getElementById('hofRegPassword');
            var conf = document.getElementById('hofRegConfirm');
            if (!phone || !name || !pass || !conf) { renderAuthModal(); return; }
            phone = phone.value.trim(); name = name.value.trim();
            pass = pass.value; conf = conf.value;
            if (!phone || !name || !pass || !conf) { Swal.fire('Missing Info', 'Please fill in all fields.', 'warning'); return; }
            fetch('register.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: normalizePhone(phone), name: name, password: pass, confirm_password: conf })
            })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success) {
                    Swal.fire('Registration Failed', data.message || 'Please check your details.', 'error');
                    return;
                }
                writeToken(data.token, data.name, data.phone);
                Swal.close();
                renderChip();
                syncCustomerName(); // REQ-054 B4-F: auto-fill the order name
                if (typeof window.HOFCustomerOnLogin === 'function') window.HOFCustomerOnLogin(data);
                Swal.fire({ icon: 'success', title: 'Account Created!', text: 'You are now logged in.', timer: 1800, showConfirmButton: false });
            })
            .catch(function () { Swal.fire('Error', 'Could not reach the server. Please try again.', 'error'); });
        }
    }

    function openAuthModal() {
        currentTab = 'login';
        renderAuthModal();
    }

    window.HOFCustomer = {
        isLoggedIn: isLoggedIn,
        getName: getName,
        getPhone: getPhone,
        getToken: readToken,
        set: writeToken,
        clear: clearToken,
        authFetch: authFetch,
        logout: logout,
        renderChip: renderChip,
        escapeHtml: escapeHtml,
        normalizePhone: normalizePhone,
        openAuthModal: openAuthModal
    };

    document.addEventListener('DOMContentLoaded', function () {
        syncCookie();
        renderChip();
    });
})();