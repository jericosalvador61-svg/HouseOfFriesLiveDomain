// ==========================================
// House of Fries - Session Monitor & RBAC
// ==========================================

let warningTimer;
let logoutTimer;

// Configurations:
// 55 minutes of inactivity before warning pops up,
// followed by a 5-minute countdown window (total 60 mins before logout)
const INACTIVITY_LIMIT = 55 * 60 * 1000; // 55 minutes
const WARNING_DURATION = 5 * 60 * 1000;  // 5 minutes

function startInactivityTimer(logoutRedirect) {
    clearTimeout(warningTimer);
    clearTimeout(logoutTimer);

    warningTimer = setTimeout(() => showInactivityWarning(logoutRedirect), INACTIVITY_LIMIT);
}

function showInactivityWarning(logoutRedirect) {
    Swal.fire({
        title: 'Are you still there?',
        text: 'You have been inactive for a while. You will be automatically logged out in 5 minutes due to inactivity.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Stay Logged In',
        cancelButtonText: 'Log Out Now',
        confirmButtonColor: '#ffc107',
        cancelButtonColor: '#dc3545',
        allowOutsideClick: false,
        allowEscapeKey: false,
        timer: WARNING_DURATION,
        timerProgressBar: true
    }).then((result) => {
        if (result.isConfirmed) {
            // User chose to stay, restart the timer
            startInactivityTimer(logoutRedirect);
        } else {
            // User clicked 'Log Out Now' or the 5-minute countdown expired
            executeLogout(logoutRedirect);
        }
    });
}

function executeLogout(logoutRedirect) {
    localStorage.removeItem("hof_token");
    // Clear the cookie mirror used by backend/page_gate.php
    document.cookie = "hof_token=; path=/; Max-Age=0; SameSite=Strict";
    window.location.href = logoutRedirect;
}

document.addEventListener("DOMContentLoaded", async () => {
    const APP_ROOT = (() => {
        const path = window.location.pathname;
        const match = path.match(/^(.*?)(?:\/public|\/customer|\/backend|\/admin|\/cashier|\/inventoryStaff|\/kitchenStaff|\/waiter|\/supervisor)(?:\/|$)/i);
        return match && match[1] ? match[1] : '';
    })();

    const rootPath = (path) => `${APP_ROOT}${path}`;
    const logoutRedirect = rootPath("/index.html");

    const token = localStorage.getItem("hof_token");

    if (!token) {
        window.location.href = logoutRedirect;
        return;
    }

    try {
        const res = await fetch(rootPath("/backend/check_session.php"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token })
        });

        const data = await res.json();

        if (!data.loggedIn) {
            executeLogout(logoutRedirect);
            return;
        }

        // Dynamically populates profile layouts
        const nameEl = document.querySelector(".user-name");
        const roleEl = document.querySelector(".user-role");
        const avatarEl = document.querySelector(".user-avatar");

        if (nameEl) nameEl.textContent = `${data.first_name} ${data.last_name}`;
        if (roleEl) roleEl.textContent = data.role;
        // REQ-052 B2-2: sidebar avatar shows the user's initial
        if (avatarEl) avatarEl.textContent = (data.first_name || 'U')[0].toUpperCase();

        // ==========================================
        // 🔥 AUTOMATIC FOLDER-BASED RBAC SECURITY 🔥
        // ==========================================
        const currentPath = window.location.pathname.toLowerCase();
        const userRole = data.role.toLowerCase();

        const folderRules = {
            '/admin/': 'admin',
            '/cashier/': 'cashier',
            '/inventorystaff/': 'inventory staff',
            '/kitchenstaff/': 'kitchen staff',
            '/supervisor/': 'supervisor',
            '/waiter/': 'waiter'
        };

        for (const [folderPath, requiredRole] of Object.entries(folderRules)) {
            if (currentPath.includes(folderPath)) {
                if (userRole !== requiredRole && userRole !== 'admin') {
                    const redirectMap = {
                        'admin': rootPath('/public/admin/admin_dashboard.html'),
                        'cashier': rootPath('/public/cashier/cashier_dashboard.html'),
                        'inventory staff': rootPath('/public/inventoryStaff/inventoryStaff_dashboard.html'),
                        'kitchen staff': rootPath('/public/kitchenStaff/kitchen_dashboard.html'),
                        'supervisor': rootPath('/public/supervisor/supervisor_dashboard.html'),
                        'waiter': rootPath('/public/waiter/waiter_dashboard.html')
                    };

                    const correctPage = redirectMap[userRole] || logoutRedirect;
                    window.location.replace(correctPage);
                    return; 
                }
            }
        }

        // ==========================================
        // 🕒 INITIALIZE INACTIVITY TIMERS ON SUCCESS
        // ==========================================
        startInactivityTimer(logoutRedirect);

        // Debounced server-side idle refresh (fixes B1): re-issue the JWT's
        // last_activity so auth_middleware.php's idle check tracks real activity,
        // not login time. Throttled to one call per 30s (mousemove/scroll fire constantly).
        let lastActivityRefresh = 0;
        const ACTIVITY_REFRESH_MS = 30000;
        async function refreshActivityPing() {
            const now = Date.now();
            if (now - lastActivityRefresh < ACTIVITY_REFRESH_MS) return;
            lastActivityRefresh = now;
            const tkn = localStorage.getItem('hof_token');
            if (!tkn) return;
            try {
                const res = await fetch(rootPath('/backend/auth/refresh_activity.php'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tkn}` },
                    body: JSON.stringify({ token: tkn })
                });
                const data = await res.json();
                // refresh_activity.php returns {exempt:true} with NO token for customers;
                // it only runs on staff pages here, but defensively skip if no token came back.
                if (data && data.success && data.token) {
                    // Must update BOTH stores — page_gate.php reads the cookie.
                    localStorage.setItem('hof_token', data.token);
                    document.cookie = 'hof_token=' + data.token + '; path=/; SameSite=Strict';
                }
            } catch (e) { /* ignore — next activity retries */ }
        }

        const activityEvents = ['mousemove', 'mousedown', 'keypress', 'scroll', 'touchstart'];
        activityEvents.forEach(event => {
            window.addEventListener(event, () => {
                // Only reset timers if the SweetAlert modal is not currently showing up
                if (!Swal.isVisible()) {
                    startInactivityTimer(logoutRedirect);
                    refreshActivityPing();
                }
            }, { passive: true });
        });

    } catch (err) {
        // Navigation aborted fetch — do NOT clear token.
        // The session check will run again on the next page load.
        console.warn("Session check aborted (likely page navigation):", err);
    }
});