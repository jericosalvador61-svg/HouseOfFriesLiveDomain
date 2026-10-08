// ====================================================================
// GLOBAL LOADING STATE UTILITIES — House of Fries
// ADVISOR REQUIREMENT: Every form submission across the system (CRUD)
// must display a loading feature indicating the request is processing.
//
// v2 — GLOBAL AUTO-COVERAGE:
//   1. GlobalRequestLoader patches window.fetch — ANY POST/PUT/DELETE
//      request anywhere shows a top progress bar + status pill,
//      with NO per-page wiring needed.
//   2. Submit buttons inside <form> elements automatically show a
//      spinner while their request is in flight (with safe fallback).
//   3. Original opt-in API preserved (LoadingManager, Toast,
//      submitWithLoading, ajaxWithLoading) — existing pages unaffected.
// ====================================================================

// --------------------------------------------------------------------
// 1) GLOBAL REQUEST LOADER (fetch interceptor)
// --------------------------------------------------------------------
const GlobalRequestLoader = {
    count: 0,
    _hideTimer: null,

    // Background/silent requests that must NOT trigger UI loading
    excludedPatterns: [
        /refresh_activity\.php/i,       // idle-timeout keepalive pings
        /check_session\.php/i,          // session verification on page load
        /get_notifications\.php/i,      // notification polling
        /\/search\.php/i,               // navbar live search
        /check_payment_status\.php/i    // payment polling loop
    ],

    _appRoot() {
        try {
            const m = window.location.pathname.match(/^(.*?)(?:\/public|\/customer|\/backend|\/admin|\/cashier|\/inventoryStaff|\/kitchenStaff|\/waiter|\/supervisor)(?:\/|$)/i);
            return (m && m[1]) ? m[1].replace(/\/$/, '') : '';
        } catch (_) { return ''; }
    },

    init() {
        if (window.__hofFetchPatched) return;
        this.injectUI();
        const originalFetch = window.fetch.bind(window);
        const self = this;

        // Option-D path shim: pages in /public/<role>/ are 3 levels deep,
        // but some modules call fetch("/backend/...") with a leading slash.
        // On localhost that resolves to http://localhost/backend/... (404)
        // instead of http://localhost/<app>/backend/... . Rewriting here
        // fixes ALL such calls in ONE place, no per-file edits needed.
        // InfinityFree serves from domain root, so APP_ROOT="" there.
        const APP_ROOT = this._appRoot();

        window.fetch = function (input, init = {}) {
            let url = '';
            let method = 'GET';
            try {
                if (typeof input === 'string') url = input;
                else if (input && typeof input.url === 'string') url = input.url;
                method = String(init.method || (input && input.method) || 'GET').toUpperCase();
            } catch (_) { /* never break a request over introspection */ }

            // Rewrite domain-root API calls to the detected app root.
            try {
                if (typeof input === 'string' && input.startsWith('/backend/') && APP_ROOT) {
                    input = APP_ROOT + input;
                } else if (input && typeof input.url === 'string' && input.url.startsWith('/backend/') && APP_ROOT) {
                    input = new Request(APP_ROOT + input.url, input);
                }
                if (typeof input === 'string') url = input;
                else if (input && typeof input.url === 'string') url = input.url;
            } catch (_) { /* never break a request over path rewrite */ }

            const tracked =
                (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') &&
                !self.excludedPatterns.some(rx => rx.test(url));

            if (tracked) self.start(method);

            // NOTE (Option-D fix): NEVER force init.redirect here.
            // Forcing 'manual' turns normal 302s into opaque-redirect
            // responses (status 0) whose body cannot be read, so every
            // caller doing res.json() throws and CRUD looks "broken".
            // Default 'follow' lets the browser resolve normally, and
            // 401 JSON from auth_middleware is still readable.

            return originalFetch(input, init).finally(() => {
                if (tracked) self.end();
            });
        };

        window.__hofFetchPatched = true;
    },

    injectUI() {
        if (document.getElementById('hof-global-loading-ui')) return;

        const style = document.createElement('style');
        style.textContent = `
            #hof-global-bar {
                position: fixed; top: 0; left: 0; height: 3px; width: 100%;
                z-index: 20000; pointer-events: none;
                background: rgba(26,21,18,.15);
                opacity: 0; transition: opacity .15s ease;
            }
            #hof-global-bar.active { opacity: 1; }
            #hof-global-bar::after {
                content: ''; display: block; height: 100%; width: 40%;
                border-radius: 3px;
                background: linear-gradient(90deg,#ffc107,#ff9800,#f44336);
                animation: hof-slide 1s ease-in-out infinite;
            }
            @keyframes hof-slide {
                0%   { transform: translateX(-100%); }
                100% { transform: translateX(350%); }
            }
            #hof-global-pill {
                position: fixed; right: 16px; bottom: 16px; z-index: 20000;
                display: flex; align-items: center; gap: 8px;
                background: #1a1512; color: #fff;
                padding: 8px 14px; border-radius: 24px;
                font: 500 13px/1 'Segoe UI', sans-serif;
                box-shadow: 0 4px 14px rgba(0,0,0,.25);
                opacity: 0; transform: translateY(8px); pointer-events: none;
                transition: opacity .18s ease, transform .18s ease;
            }
            #hof-global-pill.active { opacity: 1; transform: translateY(0); }
            #hof-global-pill .spinner-border {
                width: 14px; height: 14px; border-width: 2px; color: #ffc107;
            }
            #hof-logo-overlay {
                position: fixed; inset: 0; z-index: 20001;
                display: flex; align-items: center; justify-content: center;
                background: rgba(60,10,15,.45);
                backdrop-filter: blur(6px);
                -webkit-backdrop-filter: blur(6px);
                pointer-events: none;
                opacity: 0; visibility: hidden;
                transition: opacity .2s ease, visibility .2s ease;
            }
            #hof-logo-overlay.active {
                opacity: 1; visibility: visible;
            }
            #hof-logo-overlay .hof-logo-ring {
                position: absolute; width: 84px; height: 84px;
                border-radius: 50%;
                border: 4px solid rgba(255,193,7,.35);
                border-top-color: #ffc107;
                animation: hof-spin 1s linear infinite;
            }
            #hof-logo-overlay .hof-logo-img {
                position: relative; width: 64px; height: 64px;
                object-fit: contain; border-radius: 50%;
            }
            #hof-logo-overlay .hof-logo-fallback {
                position: relative; display: none;
                width: 64px; height: 64px; border-radius: 50%;
                background: #1a1512; color: #ffc107;
                font: 800 28px/1 'Segoe UI', sans-serif;
                align-items: center; justify-content: center;
            }
            @keyframes hof-spin {
                from { transform: rotate(0deg); }
                to   { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(style);

        const bar = document.createElement('div');
        bar.id = 'hof-global-bar';
        document.body.appendChild(bar);

        const pill = document.createElement('div');
        pill.id = 'hof-global-pill';
        pill.innerHTML =
            '<span class="spinner-border" role="status" aria-hidden="true"></span>' +
            '<span id="hof-global-pill-text">Processing…</span>';
        document.body.appendChild(pill);

        // REQ-054 B3-E: full-screen logo overlay with a circulating ring.
        // Hidden by default; shown/hidden in step with the top bar + pill.
        const overlay = document.createElement('div');
        overlay.id = 'hof-logo-overlay';
        overlay.innerHTML =
            '<div class="hof-logo-ring"></div>' +
            `<img class="hof-logo-img" src="${this._appRoot()}/images/Logo.png" alt="" onerror="this.style.display='none';var f=this.parentElement.querySelector('.hof-logo-fallback');if(f)f.style.display='flex';">` +
            '<div class="hof-logo-fallback">HF</div>';
        document.body.appendChild(overlay);
    },

    label(method) {
        switch (method) {
            case 'POST':   return 'Submitting…';
            case 'PUT':
            case 'PATCH':  return 'Updating…';
            case 'DELETE': return 'Deleting…';
            default:       return 'Processing…';
        }
    },

    start(method) {
        this.count++;
        clearTimeout(this._hideTimer);
        const bar = document.getElementById('hof-global-bar');
        const pill = document.getElementById('hof-global-pill');
        const overlay = document.getElementById('hof-logo-overlay');
        if (pill) {
            const txt = document.getElementById('hof-global-pill-text');
            if (txt) txt.textContent = this.label(method);
        }
        if (bar) bar.classList.add('active');
        if (pill) pill.classList.add('active');
        if (overlay) overlay.classList.add('active');
    },

    end() {
        this.count = Math.max(0, this.count - 1);
        if (this.count > 0) return;
        this._hideTimer = setTimeout(() => {
            const bar = document.getElementById('hof-global-bar');
            const pill = document.getElementById('hof-global-pill');
            const overlay = document.getElementById('hof-logo-overlay');
            if (bar) bar.classList.remove('active');
            if (pill) pill.classList.remove('active');
            if (overlay) overlay.classList.remove('active');
        }, 250);
    }
};

// --------------------------------------------------------------------
// 2) AUTO SPINNER FOR FORM SUBMIT BUTTONS
//    Shows instantly on submit; if no tracked request starts within
//    900ms (client-side validation failed / no-op), reverts safely.
// --------------------------------------------------------------------
const FormSubmitSpinner = {
    GRACE_MS: 900,
    MAX_MS: 20000,
    armed: false,

    init() {
        if (window.__hofFormSpinPatched) return;

        document.addEventListener('submit', (e) => {
            const form = e.target;
            if (!(form instanceof HTMLFormElement)) return;
            if (form.dataset.noAutoLoading === 'true') return;

            const btn = form.querySelector('button[type="submit"]:not([disabled])')
                     || form.querySelector('input[type="submit"]:not([disabled])');
            if (!btn || btn.dataset.hofBusy === '1') return;

            this.show(btn);
            const before = GlobalRequestLoader.count;

            setTimeout(() => {
                if (GlobalRequestLoader.count === before) this.hide(btn); // no request fired
            }, this.GRACE_MS);

            setTimeout(() => this.hide(btn), this.MAX_MS); // absolute safety cap
        }, true);

        window.__hofFormSpinPatched = true;
    },

    show(btn) {
        btn.dataset.hofBusy = '1';
        if (!btn.dataset.hofOriginalHtml) {
            btn.dataset.hofOriginalHtml = btn.tagName === 'INPUT'
                ? btn.value
                : btn.innerHTML;
        }
        btn.disabled = true;
        if (btn.tagName === 'INPUT') {
            btn.value = 'Processing…';
        } else {
            btn.innerHTML =
                '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Processing…';
        }
    },

    hide(btn) {
        if (btn.dataset.hofBusy !== '1') return;
        delete btn.dataset.hofBusy;
        btn.disabled = false;
        const orig = btn.dataset.hofOriginalHtml;
        if (orig !== undefined) {
            if (btn.tagName === 'INPUT') btn.value = orig;
            else btn.innerHTML = orig;
            delete btn.dataset.hofOriginalHtml;
        }
    }
};

// ====================================================================
// GLOBAL LOADING STATE MANAGER (original API — unchanged)
// ====================================================================
const LoadingManager = {
    activeLoaders: new Map(),

    show(buttonOrForm, options = {}) {
        const key = this.getKey(buttonOrForm);
        // FIX (REQ-063): if this exact element is already in loading state,
        // don't re-capture — otherwise a second show() would save the SPINNER
        // markup as the "original" and hide() could never restore the label.
        if (this.activeLoaders.has(key)) return;

        // FIX (REQ-063): capture the original markup BEFORE showButtonLoading()
        // swaps innerHTML for the spinner. Previously originalText was read
        // AFTER the swap, so hide() restored the spinner HTML and the button
        // stayed stuck on "Creating…"/"Processing…" forever (still clickable —
        // the reported QR-Tables "Creating..." bug, and every other module
        // that used LoadingManager.show/hide).
        const originalText = buttonOrForm.tagName === 'BUTTON' ? buttonOrForm.innerHTML : null;

        if (buttonOrForm.tagName === 'BUTTON') {
            this.showButtonLoading(buttonOrForm, options);
        } else if (buttonOrForm.tagName === 'FORM') {
            this.showFormLoading(buttonOrForm, options);
        }
        this.activeLoaders.set(key, {
            element: buttonOrForm,
            startTime: Date.now(),
            originalText: originalText
        });
    },

    hide(buttonOrForm) {
        const key = this.getKey(buttonOrForm);
        const loader = this.activeLoaders.get(key);
        if (!loader) return;
        if (buttonOrForm.tagName === 'BUTTON') {
            this.hideButtonLoading(buttonOrForm, loader.originalText);
        } else if (buttonOrForm.tagName === 'FORM') {
            this.hideFormLoading(buttonOrForm);
        }
        this.activeLoaders.delete(key);
    },

    showButtonLoading(button, options = {}) {
        const { text = 'Processing...', spinnerColor = '#1a1512' } = options;
        button.dataset.originalHtml = button.innerHTML;
        button.disabled = true;
        button.innerHTML = `
            <span class="spinner-border spinner-border-sm me-2" style="color: ${spinnerColor}; width: 1em; height: 1em;" role="status" aria-hidden="true"></span>
            ${text}
        `;
    },

    hideButtonLoading(button, originalHtml) {
        button.disabled = false;
        if (originalHtml) {
            button.innerHTML = originalHtml;
        } else if (button.dataset.originalHtml) {
            button.innerHTML = button.dataset.originalHtml;
            delete button.dataset.originalHtml;
        }
    },

    showFormLoading(form, options = {}) {
        const { overlayText = 'Submitting...' } = options;
        // Option-D fix: record disabled state BEFORE disabling, and only
        // disable the submit control. Disabling every input BEFORE the
        // caller builds FormData drops those fields (disabled controls are
        // excluded from FormData), making CRUD submit empty payloads.
        const btn = form.querySelector('button[type="submit"], input[type="submit"]');
        if (btn && !btn.disabled) {
            btn.dataset.hofKeptDisabled = '0';
            btn.disabled = true;
        } else if (btn) {
            btn.dataset.hofKeptDisabled = '1';
        }
        if (!form.querySelector('.loading-overlay')) {
            const overlay = document.createElement('div');
            overlay.className = 'loading-overlay position-absolute top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center';
            overlay.style.cssText = `
                background: rgba(255, 255, 255, 0.9);
                z-index: 1000;
                border-radius: inherit;
            `;
            overlay.innerHTML = `
                <div class="text-center">
                    <div class="spinner-border text-warning mb-2" role="status">
                        <span class="visually-hidden">Loading...</span>
                    </div>
                    <div class="fw-medium text-dark">${overlayText}</div>
                </div>
            `;
            if (getComputedStyle(form).position === 'static') {
                form.style.position = 'relative';
            }
            form.appendChild(overlay);
        }
    },

    hideFormLoading(form) {
        // Option-D fix: only re-enable a submit button we disabled ourselves.
        const btn = form.querySelector('button[type="submit"], input[type="submit"]');
        if (btn && btn.dataset.hofKeptDisabled === '0') {
            btn.disabled = false;
        }
        if (btn) delete btn.dataset.hofKeptDisabled;
        const overlay = form.querySelector('.loading-overlay');
        if (overlay) overlay.remove();
    },

    getKey(element) {
        return element.id || element.name || Array.from(document.forms).indexOf(element) + '_' + Array.from(element.querySelectorAll('button, input[type="submit"]')).indexOf(element);
    },

    setAutoHide(element, timeout = 30000) {
        setTimeout(() => {
            if (this.activeLoaders.has(this.getKey(element))) {
                this.hide(element);
                console.warn('Loading state auto-hidden after timeout');
            }
        }, timeout);
    }
};

// ====================================================================
// FORM SUBMISSION HELPER WITH LOADING (original API — unchanged)
// ====================================================================
async function submitWithLoading(form, submitHandler, options = {}) {
    const submitBtn = form.querySelector('button[type="submit"]') || form.querySelector('[data-submit-btn]');
    const { onSuccess, onError, loadingText = 'Submitting...' } = options;

    try {
        LoadingManager.show(submitBtn || form, { text: loadingText });
        const result = await submitHandler(form);
        if (onSuccess) await onSuccess(result);
        return result;
    } catch (error) {
        if (onError) await onError(error);
        throw error;
    } finally {
        LoadingManager.hide(submitBtn || form);
    }
}

// ====================================================================
// AJAX HELPER WITH LOADING (original API — unchanged)
// ====================================================================
async function ajaxWithLoading(url, options = {}, loadingOptions = {}) {
    const { btn, form, loadingText = 'Processing...' } = loadingOptions;

    try {
        LoadingManager.show(btn || form, { text: loadingText });
        const response = await fetch(url, options);
        const data = await response.json();

        if (!response.ok || data.success === false) {
            throw new Error(data.message || 'Request failed');
        }
        return data;
    } catch (error) {
        throw error;
    } finally {
        LoadingManager.hide(btn || form);
    }
}

// ====================================================================
// TOAST/NOTIFICATION HELPER (original API — unchanged)
// ====================================================================
const Toast = {
    success(message, title = 'Success') {
        Swal.fire({ icon: 'success', title, text: message, timer: 2000, showConfirmButton: false });
    },
    error(message, title = 'Error') {
        Swal.fire({ icon: 'error', title, text: message });
    },
    warning(message, title = 'Warning') {
        Swal.fire({ icon: 'warning', title, text: message });
    },
    info(message, title = 'Info') {
        Swal.fire({ icon: 'info', title, text: message, timer: 3000, showConfirmButton: false });
    },
    loading(message = 'Processing...') {
        Swal.fire({ title: message, allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    },
    close() {
        Swal.close();
    }
};

// ====================================================================
// BOOTSTRAP EVERYTHING
// ====================================================================
(function bootstrapGlobalLoading() {
    const boot = () => {
        GlobalRequestLoader.init();
        FormSubmitSpinner.init();
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot(); // script loaded late/deferred — DOM already there
    }
})();

// ====================================================================
// CSS FOR LOADING OVERLAY (injected dynamically — legacy opt-in forms)
// ====================================================================
const loadingStyles = `
    <style id="loading-styles">
        .loading-overlay {
            backdrop-filter: blur(2px);
        }
        .loading-overlay .spinner-border {
            width: 2.5rem;
            height: 2.5rem;
        }
        button:disabled {
            opacity: 0.8;
            cursor: not-allowed;
        }
        .form-control:disabled,
        .form-select:disabled {
            background-color: #f8f9fa;
            opacity: 0.7;
        }
    </style>
`;

if (!document.getElementById('loading-styles')) {
    document.head.insertAdjacentHTML('beforeend', loadingStyles);
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { LoadingManager, GlobalRequestLoader, FormSubmitSpinner, submitWithLoading, ajaxWithLoading, Toast };
}