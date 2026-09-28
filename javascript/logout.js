/**
 * House of Fries - Unified Logout
 * Works on ANY deployment layout (domain root or subfolder):
 * detects the app root from the current path, calls the backend,
 * clears the token and ALWAYS lands on index.html smoothly.
 *
 * Advisor requirement: "Logging out must smoothly redirect the user
 * straight to landing page or login (index.html)" — implemented via a
 * brief full-screen "Signing you out…" fade overlay before redirect.
 */
(function () {
    'use strict';

    // Same root-detection used by check_session.js
    const APP_ROOT = (() => {
        const path = window.location.pathname;
        const match = path.match(/^(.*?)(?:\/public|\/customer|\/backend|\/admin|\/cashier|\/inventoryStaff|\/kitchenStaff|\/waiter|\/supervisor)(?:\/|$)/i);
        return match && match[1] ? match[1] : '';
    })();

    let isLoggingOut = false; // guard against double-fire

    function injectOverlay() {
        if (document.getElementById('hof-logout-overlay')) return;
        const style = document.createElement('style');
        style.textContent = `
            #hof-logout-overlay {
                position: fixed; inset: 0; z-index: 30000;
                background: #140c08;
                display: flex; align-items: center; justify-content: center;
                flex-direction: column; gap: 20px;
                opacity: 0; transition: opacity .4s ease;
                font-family: 'Segoe UI', system-ui, sans-serif;
            }
            #hof-logout-overlay.visible { opacity: 1; }
            #hof-logout-overlay img {
                width: 88px; height: 88px; border-radius: 22px;
                box-shadow: 0 18px 50px -16px rgba(224,43,32,.55);
                animation: hofLogoutPulse 1.4s ease-in-out infinite;
            }
            @keyframes hofLogoutPulse { 50% { transform: scale(1.06); } }
            #hof-logout-overlay .brand-name {
                font-family: Georgia, 'Times New Roman', serif;
                font-style: italic; font-size: 14px;
                letter-spacing: .34em; text-transform: uppercase;
                color: #c7ab8e;
            }
            #hof-logout-overlay .msg {
                color: #f5efe6; font-size: 13px;
                font-weight: 500; letter-spacing: .5px;
            }
            #hof-logout-bar {
                width: min(220px, 55vw); height: 2px;
                background: rgba(255,244,228,.12);
                border-radius: 99px; overflow: hidden;
            }
            #hof-logout-bar i {
                display: block; height: 100%; width: 0;
                background: linear-gradient(90deg, #e02b20, #ffc61c);
                transition: width .3s;
            }
        `;
        document.head.appendChild(style);

        const overlay = document.createElement('div');
        overlay.id = 'hof-logout-overlay';
        overlay.innerHTML =
            '<img src="' + APP_ROOT + '/images/Logo.png" alt="House of Fries">' +
            '<div class="brand-name">House of Fries · Tagoloan</div>' +
            '<div class="msg">Signing you out…</div>' +
            '<div id="hof-logout-bar"><i></i></div>';
        document.body.appendChild(overlay);
        // force reflow so the fade-in transition plays
        void overlay.offsetWidth;
        overlay.classList.add('visible');
        // Animate the progress bar
        var bar = overlay.querySelector('#hof-logout-bar i');
        if (bar) {
            requestAnimationFrame(function () { bar.style.width = '100%'; });
        }
    }

    function doLogout() {
        if (isLoggingOut) return;
        isLoggingOut = true;

        const token = localStorage.getItem('hof_token');

        try {
            // keepalive so the request survives the page navigation
            fetch(APP_ROOT + '/backend/logout.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token }),
                keepalive: true
            }).catch(function () { /* server logout is stateless - ignore errors */ });
        } catch (err) { /* ignore */ }

        localStorage.removeItem('hof_token');
        localStorage.removeItem('lastRefNumber');
        localStorage.removeItem('lastOrderID');
        document.cookie = 'hof_token=; path=/; Max-Age=0; SameSite=Strict';

        // Smooth transition: show overlay, then redirect
        const target = APP_ROOT + '/index.html';
        if (document.readyState === 'loading') {
            // head-loaded edge case: redirect as soon as body is ready
            document.addEventListener('DOMContentLoaded', function () {
                injectOverlay();
                setTimeout(function () { window.location.href = target; }, 450);
            });
        } else {
            injectOverlay();
            setTimeout(function () { window.location.href = target; }, 450);
        }

        // Absolute failsafe: even if something above throws, still land on login
        setTimeout(function () {
            if (!window.location.pathname.endsWith('/index.html')) {
                window.location.href = target;
            }
        }, 2500);
    }

    // Global hooks so any page can call logout() / hofLogout()
    window.hofLogout = doLogout;
    if (typeof window.logout !== 'function') {
        window.logout = doLogout;
    }

    document.addEventListener('DOMContentLoaded', function () {
        document.querySelectorAll('#logoutBtn, [data-logout]').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                doLogout();
            });
        });
    });
})();