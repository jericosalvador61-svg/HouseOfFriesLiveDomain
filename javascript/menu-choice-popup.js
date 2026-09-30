/**
 * HOFChoicePopup — reusable choice / add-on popup (REQ-040)
 *
 * One bottom-sheet-style overlay component shared by customer, waiter,
 * and cashier screens. Pure vanilla JS (no framework dependency), with a
 * small self-contained <style> block so it works without a separate CSS
 * link being present. Deterministic and testable: the DOM is built with
 * string templates and all injected text is HTML-escaped before insertion.
 *
 * Public API:
 *   window.HOFChoicePopup.open({
 *     item,                // { menu_item_id, item_name, description, image_url,
 *                          //   price, choices:[{group_name, options:[{menu_choice_id, choice_name}]}],
 *                          //   addons:[{menu_addon_id, addon_name, price}] }
 *                          //   (choices / addons may be [])
 *     initial,             // (optional) { menu_item_id, quantity,
 *                          //   special_instructions, choices:[menu_choice_id,...],
 *                          //   addons:[{menu_addon_id, quantity}] }
 *     title,               // (optional) header text, defaults to item.item_name
 *     onConfirm,           // fn(line) -> line = { menu_item_id, quantity, price,
 *                          //   special_instructions, choices:[menu_choice_id,...],
 *                          //   addons:[{menu_addon_id, quantity}] }
 *     onCancel,            // fn() called on dismiss without confirming
 *     hideInstructions     // (optional) if true, omit the special-instructions textarea
 *   })
 *
 *   window.HOFChoicePopup.close()   // force-close (also calls onCancel)
 *
 * onConfirm's `price` = item.price (base) + sum(addon.price * qty),
 * rounded to 2 decimals, NOT multiplied by item quantity.
 * special_instructions is auto-composed from selected choices + add-ons
 * with qty > 0. If the user typed free text and it is non-empty, the free
 * text comes FIRST, then the composed part, joined by '; '.
 */

(function () {
    'use strict';

    var STYLE_ID = 'hof-choice-popup-style';
    var ANIM_MS = 240;

    function ensureStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = [
            '.hof-choice-popup-overlay{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;justify-content:center;opacity:0;visibility:hidden;transition:opacity ' + ANIM_MS + 'ms ease,visibility ' + ANIM_MS + 'ms ease;}',
            '.hof-choice-popup-overlay.hof-open{opacity:1;visibility:visible;}',
            '.hof-choice-popup-sheet{position:relative;width:100%;max-width:560px;max-height:92vh;overflow-y:auto;background:#fff;color:#212529;border-radius:18px 18px 0 0;box-shadow:0 -8px 32px rgba(0,0,0,.25);transform:translateY(100%);transition:transform ' + ANIM_MS + 'ms ease;padding:16px 20px 24px;}',
            '.hof-choice-popup-overlay.hof-open .hof-choice-popup-sheet{transform:translateY(0);}',
            '.hof-choice-popup-header{display:flex;align-items:flex-start;gap:14px;padding-bottom:14px;border-bottom:1px solid #eee;}',
            '.hof-choice-popup-header-img{display:flex;align-items:center;justify-content:center;width:74px;height:74px;border-radius:12px;background:#f1f1f1;color:#9a9a9a;font-size:12px;text-align:center;flex-shrink:0;}',
            '.hof-choice-popup-header img{width:74px;height:74px;object-fit:cover;border-radius:12px;background:#f1f1f1;flex-shrink:0;}',
            '.hof-choice-popup-title{font-size:17px;font-weight:700;line-height:1.3;margin:0 0 4px;}',
            '.hof-choice-popup-desc{font-size:13px;color:#6c757d;line-height:1.4;margin:0 0 6px;}',
            '.hof-choice-popup-base-price{font-size:15px;font-weight:700;color:#c53030;}',
            '.hof-choice-popup-close{position:absolute;top:10px;right:12px;border:0;background:transparent;font-size:22px;line-height:1;color:#6c757d;cursor:pointer;padding:4px 8px;}',
            '.hof-choice-popup-close:hover{color:#212529;}',
            '.hof-choice-popup-section{margin-top:18px;}',
            '.hof-choice-popup-section-label{font-size:14px;font-weight:700;margin:0 0 10px;}',
            '.hof-choice-popup-opt{display:flex;align-items:flex-start;gap:8px;padding:9px 10px;border:1px solid #e5e5e5;border-radius:10px;margin-bottom:8px;cursor:pointer;}',
            '.hof-choice-popup-opt input{margin:3px 0 0;}',
            '.hof-choice-popup-opt span{font-size:14px;}',
            '.hof-choice-popup-addon{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 10px;border:1px solid #e5e5e5;border-radius:10px;margin-bottom:8px;}',
            '.hof-choice-popup-addon-info{font-size:14px;}',
            '.hof-choice-popup-addon-price{font-size:12px;color:#6c757d;margin-left:6px;}',
            '.hof-choice-popup-stepper{display:inline-flex;align-items:center;gap:10px;}',
            '.hof-choice-popup-stepper button{width:30px;height:30px;border-radius:8px;border:1px solid #d0d0d0;background:#fff;font-size:16px;font-weight:700;line-height:1;cursor:pointer;color:#212529;}',
            '.hof-choice-popup-stepper button:hover:not(:disabled){background:#f6f6f6;}',
            '.hof-choice-popup-stepper button:disabled{opacity:.35;cursor:not-allowed;}',
            '.hof-choice-popup-stepper .hof-choice-popup-count{min-width:30px;text-align:center;font-size:14px;font-weight:700;}',
            '.hof-choice-popup-instr{width:100%;min-height:64px;border:1px solid #ced4da;border-radius:10px;padding:10px 12px;font-size:14px;resize:vertical;}',
            '.hof-choice-popup-footer{margin-top:20px;padding-top:14px;border-top:1px solid #eee;}',
            '.hof-choice-popup-subtotal{display:flex;justify-content:space-between;align-items:center;font-size:16px;font-weight:700;margin-bottom:12px;}',
            '.hof-choice-popup-ok{width:100%;border:0;border-radius:12px;background:#c53030;color:#fff;font-size:16px;font-weight:700;padding:14px;cursor:pointer;transition:background .15s ease;}',
            '.hof-choice-popup-ok:hover:not(:disabled){background:#a42828;}',
            '.hof-choice-popup-ok:disabled{background:#e2a1a1;cursor:not-allowed;}',
            '.hof-choice-popup-hint{font-size:12px;color:#a42828;margin:6px 0 0;text-align:center;}'
        ].join('');
        (document.head || document.documentElement).appendChild(style);
    }

    function escapeHtml(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function toNumber(value, fallback) {
        var n = parseFloat(value);
        return isNaN(n) ? fallback : n;
    }

    function round2(value) {
        return Math.round((value + Number.EPSILON) * 100) / 100;
    }

    function formatPeso(value) {
        return '₱' + round2(value).toFixed(2);
    }

    function resolveImageUrl(url) {
        if (!url) return '/images/placeholder.png';
        if (/^(https?:)?\/\//i.test(url)) return url;
        if (url.charAt(0) === '/') return url;
        return '/' + url;
    }

    // ---- State of the currently open popup ----
    var state = null;
    var root = null;

    function buildDOM(cfg) {
        var item = cfg.item || {};
        var itemName = cfg.title || item.item_name || 'Menu Item';
        var basePrice = toNumber(item.price, 0);
        var imageUrl = resolveImageUrl(item.image_url);

        var html = '';
        html += '<div class="hof-choice-popup-overlay">';
        html += '<div class="hof-choice-popup-sheet" role="dialog" aria-modal="true" aria-label="' + escapeHtml(itemName) + '">';
        html += '<button type="button" class="hof-choice-popup-close" data-action="cancel" aria-label="Close">×</button>';

        // 1. Item header.
        html += '<div class="hof-choice-popup-header">';
        html += '<img src="' + escapeHtml(imageUrl) + '" alt="' + escapeHtml(itemName) + '" onerror="this.style.display=\'none\';var p=this.nextElementSibling;if(p)p.style.display=\'flex\';">';
        html += '<div class="hof-choice-popup-header-img" style="display:none;">' + escapeHtml((item.item_name || 'Item').charAt(0)) + '</div>';
        html += '<div>';
        html += '<h2 class="hof-choice-popup-title">' + escapeHtml(itemName) + '</h2>';
        if (item.description) html += '<p class="hof-choice-popup-desc">' + escapeHtml(item.description) + '</p>';
        html += '<div class="hof-choice-popup-base-price">' + formatPeso(basePrice) + '</div>';
        html += '</div>';
        html += '</div>';

        // 2. Choice groups (exactly one radio per group, unique radio names).
        (item.choices || []).forEach(function (group, groupIndex) {
            html += '<div class="hof-choice-popup-section" data-choice-group="' + escapeHtml(group.group_name) + '">';
            html += '<h3 class="hof-choice-popup-section-label">' + escapeHtml(group.group_name) + '</h3>';
            (group.options || []).forEach(function (opt) {
                html += '<label class="hof-choice-popup-opt">';
                html += '<input type="radio" name="hof-choice-group-' + groupIndex + '" value="' + escapeHtml(opt.menu_choice_id) + '">';
                html += '<span>' + escapeHtml(opt.choice_name) + '</span>';
                html += '</label>';
            });
            html += '</div>';
        });

        // 3. Add-ons with quantity steppers.
        var addons = item.addons || [];
        if (addons.length) {
            html += '<div class="hof-choice-popup-section">';
            html += '<h3 class="hof-choice-popup-section-label">Add-ons</h3>';
            addons.forEach(function (addon) {
                html += '<div class="hof-choice-popup-addon" data-addon-id="' + escapeHtml(addon.menu_addon_id) + '">';
                html += '<div class="hof-choice-popup-addon-info">' + escapeHtml(addon.addon_name);
                html += '<span class="hof-choice-popup-addon-price">' + formatPeso(toNumber(addon.price, 0)) + ' each</span>';
                html += '</div>';
                html += '<span class="hof-choice-popup-stepper">';
                html += '<button type="button" class="hof-choice-popup-minus" aria-label="Decrease ' + escapeHtml(addon.addon_name) + '">−</button>';
                html += '<span class="hof-choice-popup-count">0</span>';
                html += '<button type="button" class="hof-choice-popup-plus" aria-label="Increase ' + escapeHtml(addon.addon_name) + '">+</button>';
                html += '</span>';
                html += '</div>';
            });
            html += '</div>';
        }

        // 4. Special instructions (unless hidden).
        if (!cfg.hideInstructions) {
            html += '<div class="hof-choice-popup-section">';
            html += '<h3 class="hof-choice-popup-section-label">Special instructions</h3>';
            html += '<textarea class="hof-choice-popup-instr" placeholder="e.g., less spicy, no sauce, extra cheese"></textarea>';
            html += '</div>';
        }

        // 5. Item quantity stepper.
        html += '<div class="hof-choice-popup-section">';
        html += '<h3 class="hof-choice-popup-section-label">Quantity</h3>';
        html += '<div class="hof-choice-popup-addon" style="justify-content:space-between;">';
        html += '<span class="hof-choice-popup-addon-info">' + escapeHtml(itemName) + '</span>';
        html += '<span class="hof-choice-popup-stepper">';
        html += '<button type="button" class="hof-choice-popup-qty-minus" aria-label="Decrease quantity">−</button>';
        html += '<span class="hof-choice-popup-count hof-choice-popup-qty-count">1</span>';
        html += '<button type="button" class="hof-choice-popup-qty-plus" aria-label="Increase quantity">+</button>';
        html += '</span>';
        html += '</div>';
        html += '</div>';

        // 6 + 7. Subtotal + actions.
        html += '<div class="hof-choice-popup-footer">';
        html += '<div class="hof-choice-popup-subtotal">';
        html += '<span>Subtotal</span>';
        html += '<span class="hof-choice-popup-subtotal-value">' + formatPeso(basePrice) + '</span>';
        html += '</div>';
        html += '<button type="button" class="hof-choice-popup-ok" data-action="confirm">OK — Add to Cart</button>';
        html += '<div class="hof-choice-popup-hint" style="display:none;">Please select one option for each choice group above.</div>';
        html += '</div>';

        html += '</div>';
        html += '</div>';
        return html;
    }

    function populate(cfg) {
        var initial = cfg.initial || {};
        var item = cfg.item || {};

        // Pre-fill choice groups.
        var initialChoices = {};
        (initial.choices || []).forEach(function (id) {
            initialChoices[String(id)] = true;
        });
        root.querySelectorAll('input[type="radio"]').forEach(function (input) {
            if (initialChoices[input.value]) input.checked = true;
        });

        // Pre-fill add-on quantities.
        var initialAddons = {};
        (initial.addons || []).forEach(function (a) {
            if (a && a.menu_addon_id !== undefined) {
                initialAddons[String(a.menu_addon_id)] = toNumber(a.quantity, 0);
            }
        });
        root.querySelectorAll('.hof-choice-popup-addon[data-addon-id]').forEach(function (row) {
            var id = row.getAttribute('data-addon-id');
            var qty = Math.max(0, Math.floor(initialAddons[id] || 0));
            row.querySelector('.hof-choice-popup-count').textContent = String(qty);
        });

        // Pre-fill instructions. Popup-produced REQ-040 lines keep free text in
        // `special_instructions` + the display string in `composed_instructions`.
        // DB-rebuilt (configured) lines carry the server snapshot in
        // `special_instructions`: show it read-only so the structured
        // "Group: Choice; Nx Addon" text is never re-edited into the free-text
        // box (and never truncated at the first ';').
        if (!cfg.hideInstructions) {
            var instrEl = root.querySelector('.hof-choice-popup-instr');
            if (instrEl) {
                var raw = (initial.special_instructions || '').trim();
                if (initial.configured && raw) {
                    instrEl.value = raw;
                    instrEl.readOnly = true;
                    instrEl.title = 'This line was saved from an existing order. Remove it and re-add if you need to change the options.';
                } else if (initial.composed_instructions) {
                    instrEl.value = raw;
                } else {
                    instrEl.value = raw.split(';')[0].trim();
                }
            }
        }

        // Pre-fill item quantity.
        var qtyEl = root.querySelector('.hof-choice-popup-qty-count');
        if (qtyEl) {
            var initQty = toNumber(initial.quantity, 1);
            qtyEl.textContent = String(Math.max(1, Math.floor(initQty)));
        }
    }

    function groupSections() {
        return Array.prototype.slice.call(root.querySelectorAll('[data-choice-group]'));
    }

    function allGroupsSelected() {
        var groups = groupSections();
        for (var i = 0; i < groups.length; i++) {
            if (!groups[i].querySelector('input[type="radio"]:checked')) return false;
        }
        return true;
    }

    function updateOK() {
        var ok = root.querySelector('.hof-choice-popup-ok');
        var hint = root.querySelector('.hof-choice-popup-hint');
        var enabled = groupSections().length === 0 || allGroupsSelected();
        if (ok) ok.disabled = !enabled;
        if (hint) hint.style.display = enabled ? 'none' : 'block';
    }

    function getSelectedChoices() {
        var ids = [];
        root.querySelectorAll('input[type="radio"]:checked').forEach(function (input) {
            ids.push(Number(input.value));
        });
        return ids;
    }

    function getAddonQuantities() {
        var list = [];
        root.querySelectorAll('.hof-choice-popup-addon[data-addon-id]').forEach(function (row) {
            var id = Number(row.getAttribute('data-addon-id'));
            var qty = parseInt(row.querySelector('.hof-choice-popup-count').textContent, 10) || 0;
            if (qty > 0) list.push({ menu_addon_id: id, quantity: qty });
        });
        return list;
    }

    function getAddonTotal() {
        var item = state ? state.item : {};
        var total = 0;
        root.querySelectorAll('.hof-choice-popup-addon[data-addon-id]').forEach(function (row) {
            var id = row.getAttribute('data-addon-id');
            var qty = parseInt(row.querySelector('.hof-choice-popup-count').textContent, 10) || 0;
            var addon = (item.addons || []).find(function (a) { return String(a.menu_addon_id) === String(id); });
            total += toNumber(addon && addon.price, 0) * qty;
        });
        return total;
    }

    function getItemQuantity() {
        var el = root.querySelector('.hof-choice-popup-qty-count');
        return Math.max(1, parseInt(el && el.textContent, 10) || 1);
    }

    function getFreeText() {
        var el = root.querySelector('.hof-choice-popup-instr');
        return el ? el.value.trim() : '';
    }

    // Auto-compose instructions: free text first, then structured part.
    function composeInstructions() {
        var item = state ? state.item : {};
        var parts = [];
        var free = getFreeText();
        if (free) parts.push(free);

        var groupsByName = {};
        (item.choices || []).forEach(function (group) {
            groupsByName[group.group_name] = group;
        });

        groupSections().forEach(function (section) {
            var checked = section.querySelector('input[type="radio"]:checked');
            if (!checked) return;
            var groupName = section.getAttribute('data-choice-group');
            var group = groupsByName[groupName] || { options: [] };
            var opt = (group.options || []).find(function (o) { return String(o.menu_choice_id) === checked.value; });
            parts.push(groupName + ': ' + (opt ? opt.choice_name : checked.value));
        });

        var addons = item.addons || [];
        getAddonQuantities().forEach(function (a) {
            var addon = addons.find(function (ad) { return String(ad.menu_addon_id) === String(a.menu_addon_id); });
            parts.push(a.quantity + 'x ' + (addon ? addon.addon_name : a.menu_addon_id));
        });

        return parts.join('; ');
    }

    function updateSubtotal() {
        var item = state ? state.item : {};
        var base = toNumber(item.price, 0);
        var linePrice = round2(base + getAddonTotal());
        var subtotal = round2(linePrice * getItemQuantity());
        var el = root.querySelector('.hof-choice-popup-subtotal-value');
        if (el) el.textContent = formatPeso(subtotal);
        return linePrice;
    }

    function buildLine() {
        var item = state ? state.item : {};
        var initial = (state && state.initial) || {};
        var isConfigured = !!(initial.configured && (initial.special_instructions || '').trim());
        var line = {
            menu_item_id: Number(item.menu_item_id),
            quantity: getItemQuantity(),
            price: updateSubtotal(),
            // For a configured (DB-rebuilt) line the server snapshot is
            // authoritative and read-only; send it verbatim so the stored
            // "Group: Choice; Nx Addon" text survives re-submit untouched.
            special_instructions: isConfigured ? (initial.special_instructions || '').trim() : getFreeText(),
            // display-only composed string for cart/checkout/kitchen rendering
            composed_instructions: isConfigured ? (initial.special_instructions || '').trim() : composeInstructions(),
            choices: getSelectedChoices(),
            addons: getAddonQuantities(),
            // REQ-050 C2: carry the DB line id so configured (resume/edit)
            // lines keep their authoritative stored price on re-submit.
            order_item_id: initial.order_item_id || 0,
            configured: !!initial.configured
        };
        return line;
    }

    function stepCount(btn, delta) {
        var row = btn.closest('.hof-choice-popup-addon');
        var countEl = row && row.querySelector('.hof-choice-popup-count');
        if (!countEl) return;
        var qty = parseInt(countEl.textContent, 10) || 0;
        qty = Math.max(0, qty + delta);
        countEl.textContent = String(qty);
        updateSubtotal();
    }

    function stepQty(delta) {
        var el = root.querySelector('.hof-choice-popup-qty-count');
        if (!el) return;
        var qty = getItemQuantity();
        qty = Math.max(1, qty + delta);
        el.textContent = String(qty);
        updateSubtotal();
    }

    function bindEvents(cfg) {
        root.addEventListener('input', function () { updateSubtotal(); });
        root.addEventListener('change', function () { updateOK(); updateSubtotal(); });

        root.addEventListener('click', function (e) {
            var btn = e.target.closest('button');
            if (!btn) return;

            var action = btn.getAttribute('data-action');
            if (action === 'cancel') {
                closeAndNotify('cancel');
                return;
            }
            if (action === 'confirm') {
                if (!allGroupsSelected()) {
                    var hint = root.querySelector('.hof-choice-popup-hint');
                    if (hint) hint.style.display = 'block';
                    return;
                }
                closeAndNotify('confirm');
                return;
            }

            // Steppers (delegated).
            var cls = btn.className || '';
            if (cls.indexOf('hof-choice-popup-qty-plus') !== -1) {
                stepQty(1);
            } else if (cls.indexOf('hof-choice-popup-qty-minus') !== -1) {
                stepQty(-1);
            } else if (cls.indexOf('hof-choice-popup-plus') !== -1) {
                stepCount(btn, 1);
            } else if (cls.indexOf('hof-choice-popup-minus') !== -1) {
                stepCount(btn, -1);
            }
        });
    }

    function destroy() {
        if (!root) return;
        var overlay = root;
        overlay.classList.remove('hof-open');
        setTimeout(function () {
            if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        }, ANIM_MS);
        root = null;
        state = null;
        document.removeEventListener('keydown', onKeydown);
    }

    function onKeydown(e) {
        if (e.key === 'Escape' && state) closeAndNotify('cancel');
    }

    function closeAndNotify(reason) {
        var cfg = state;
        if (!cfg || !root) return;
        var line = null;
        if (reason === 'confirm') line = buildLine();
        destroy();
        if (reason === 'confirm' && cfg.onConfirm) {
            cfg.onConfirm(line);
        } else if (reason === 'cancel' && cfg.onCancel) {
            cfg.onCancel();
        }
    }

    function open(cfg) {
        cfg = cfg || {};
        if (!cfg.item) throw new Error('HOFChoicePopup.open: `item` is required');
        if (typeof cfg.onConfirm !== 'function') throw new Error('HOFChoicePopup.open: `onConfirm` is required');

        if (state) closeAndNotify('cancel');

        ensureStyles();

        state = cfg;
        var holder = document.createElement('div');
        holder.innerHTML = buildDOM(cfg);
        root = holder.firstElementChild;

        (document.body || document.documentElement).appendChild(root);
        document.addEventListener('keydown', onKeydown);

        populate(cfg);
        bindEvents(cfg);
        updateOK();
        updateSubtotal();

        // Next frame so the CSS transition fires.
        requestAnimationFrame(function () {
            if (root) root.classList.add('hof-open');
        });
    }

    function close() {
        closeAndNotify('cancel');
    }

    window.HOFChoicePopup = {
        open: open,
        close: close
    };
})();
