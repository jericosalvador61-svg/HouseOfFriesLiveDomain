# REQ-067 F5 — Guest Track-by-Order-Number on orderTracker

## Objective
Let a GUEST (not logged in, any device) light the order tracker by typing the HOF reference number. The tracker ALREADY has the color/icon step lighting (PENDING yellow/hourglass → IN-PROGRESS blue/fire → COOKING orange/utensils → READY/COMPLETED green/check → CANCELLED red) — it just never renders a card for an order the current device doesn't know about.

## Files to change
1. `customer/orderTracker.html` — add a "Track by Order Number" input + Go button above the tracker container (guest-friendly, styled like the existing page).
2. `customer/orderTracker.js` — on Go: read ref → resolve to order_id → obtain track+items sigs → push into trackedOrders → fetchAndRenderOrder → Pusher + 30s poll then light it live.
3. NEW `customer/lookup_order_by_ref.php` — public, rate-limited endpoint: POST { ref } → { success, order_id, status } (NO customer PII, NO items, NO phone; only order existence + id + status so the signed tracker can render). Reuse hof_rate_limit (backend/rate_limit.php) pattern (e.g. 20/min/IP). Validate ref format /^HOF\d{9,}$/i.

## Constraints
- Do NOT change the color/icon logic (it already matches the yellow→blue→orange→green→red spec).
- Do NOT touch get_my_orders.php (login-only stays).
- Keep guest privacy: lookup returns ONLY order_id + status. No name/phone/items/total.
- Signed sigs still gate items (get-payment-link track purpose binds order_id+purpose only — compatible).
- PHP: use PDO prepared statements, return JSON, set JSON content-type, no HTML.
- Lint: `C:/xampp/php/php.exe -l` on the new php file; `node --check` on orderTracker.js.
- Commit on branch req-067-f5-tracker-guest. Report changed files + line numbers + lint results.
