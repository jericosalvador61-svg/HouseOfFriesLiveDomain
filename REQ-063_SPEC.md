# REQ-063 — Post-Deploy Sweep: implementer contract (OpenCode)

Repo worktree: `C:/Users/Jerico/orca/workspaces/HouseOfFriesLiveDomain/req-063-sweep` (branch req-063-sweep, from master e2175bc).
Vault brain: `C:\Users\Jerico\HOUSE_OF_FRIES_CAPSTONE` — read `17_REQUESTS_AND_CHANGES/INBOX/REQ-063_PostDeploy_Sweep.md` for full context + Decision Log (note: OpenCode auto-rejects external-directory reads, so the essential contract is copied below verbatim).

## Scope (implement ONLY this; #10 is PLANNING — no code)
1. **Order Again out of header → below list** — `customer/orderHistory.html:96` (`#orderAgainTopBtn` in topbar) → remove from header; render per-card footer button (each card gets its own Order Again at the bottom). NO refresh button anywhere (module is websocket-driven).
2. **Edit-order "expired" before 15 min** — `customer/update_existing_order.php:73-77` computes `time() - strtotime(ordered_at) > 900`. Root: ordered_at is being REWRITTEN (`:253 ordered_at = NOW()`) on edits, and client countdown anchors to ordered_at. Fix: measure the 15-min window from `created_at` (order creation) — e.g. `$windowStart = $order['created_at'] ?: $order['ordered_at']` and compare `time() - strtotime($windowStart) > 900`; DO NOT rewrite `ordered_at` on edit (remove/guard line 253). After a successful edit the order stays PENDING-unpaid so the customer can re-checkout. Also update the client countdown anchor (orderTracker.js:452-478) to use the same creation timestamp the server now uses (created_at if present, else ordered_at), so client and server agree.
3. **Cashier ↔ GCash (LOCKED model)** — `backend/cashier/get_pending_orders.php:27` returns ALL PENDING (incl GCASH-unpaid). Keep the unified list, but the CASHIER UI (cashier_dashboard.js) must:
   - CASH rows → full actions (pay/edit/void) as today.
   - GCASH-unpaid rows (payment_method=GCASH AND payment_status=PENDING) → SAME list, greyed + "Paying via GCash" badge, VIEW-ONLY: no pay/edit/void buttons.
   - When GCASH completes (server flips payment_status=COMPLETED) → order proceeds to kitchen automatically; cashier NEVER transacts GCASH (remove the get_pending_gcash_orders action path / the GCASH verify modal buttons that let the cashier mark GCash paid).
   - When customer switches GCASH→CASH (place_order/edit flow), the row becomes actionable.
   - get_pending_orders.php must still RETURN payment_method + payment_status so the JS can distinguish; do NOT filter them out server-side for the list (the UI needs both). Keep get_pending_gcash_orders.php endpoint but REMOVE its use as a cashier transaction path.
4. **qr_payment topbar parity** — `customer/qr_payment.html` has NO topbar (only `.top-bar h1` + back-link). Give it the SAME topbar component as cart/checkout/orderTracker/orderHistory: brand logo (`../images/Logo.png`), cart badge (`#cartBadgeCount`), My Orders badge (`#myOrdersBadge`), identical height/styling, no horizontal overflow on small screens (takeout chip + name clipped — use flex-wrap/ellipsis).
5. **Cart clears on payment confirmation, not only COMPLETED** — `customer/orderTracker.js:763` clears cart only at COMPLETED. Clear cart+badge the moment payment_status=COMPLETED (GCash verified / cashier marks paid), in every customer page path that observes the paid state (checkout.js markPaymentConfirmed already clears via REQ-054 B1 — ensure orderTracker + qr_payment also clear on the paid event, not at COMPLETION). Keep lastOrderID/lastRefNumber intact.
6. **Pusher + 30s polling parity audit** — all 5 customer pages (cart, checkout, qr_payment, orderTracker, orderHistory) must have Pusher for order status + a 30s fetch fallback. qr_payment currently polls at 3s (POLL_INTERVAL_MS=3000, qr_payment.js:20) — align to 30s (or document why 3s stays). Produce a per-page table (page · Pusher channel/event · poll interval · fallback) in the implementation record / code comments.
7. **Landing menu ONLY via modal** — verify `landing/index.html` has no inline scrollable `#menu` section left (only `#menuModal` + menu-modal.css/js). Remove any leftover inline menu markup if found.
8. **Takeout QR name gate** — exists (`customer/customer.js:599 showTakeoutNamePrompt`, non-skippable, auto-skips if name saved). Verify end-to-end; ensure the prompt can't be skipped (it's required on takeout). Live-verify only — code appears correct; fix only if you find a skip path.
9. **Kitchen Check-All-twice error** — `javascript/kitchenStaff/kitchenUI.js:688 handleCheckAll` + `backend/kitchenStaff/kitchenkds/check_all.php`. The 2nd-use Swal error is likely `hof_rate_limit` (429, 60/60s) or `checkAllItems` erroring when already all-checked. Make check_all idempotent (all-items-already-checked → return success, no error) and turn the rate-limit into a friendly message ("Please wait a moment…") instead of a raw error.

## Constraints / rules (binding)
- PDO prepared statements only; JSON out of every endpoint; status strings exact per enums (HYPHENS: IN-PROGRESS, COOKING — never underscores).
- `php -l` every changed .php; `node --check` every changed .js.
- Do NOT touch: sql/ (gitignored), backend/db.php, backend/secret.php, backend/config/paymongo_config.php, anything outside the 9 items above. No schema changes (#10 planning only).
- Preserve existing behavior for all non-listed flows. Smallest safe change. No unrelated refactors.
- Do NOT push/merge — commit on the req-063-sweep branch only.
- Do NOT auto-dispatch anything; you are the implementer.

## Acceptance criteria (each item must be verifiable)
1. orderHistory: no `#orderAgainTopBtn` in header; each card has Order Again at bottom; no refresh button.
2. update_existing_order: window measured from created_at (fallback ordered_at); ordered_at not rewritten on edit; after edit status stays PENDING-unpaid; client countdown anchor matches server.
3. cashier_dashboard: unified list; GCASH-unpaid greyed "Paying via GCash" view-only; no GCash txn buttons; GCASH-COMPLETED auto→kitchen; CASH full actions; switch-to-cash unlocks row.
4. qr_payment.html topbar identical to the other 4 customer pages (logo + badges, no overflow).
5. Cart+badge clear on payment confirm (all paths), keep lastOrderID/lastRef.
6. Per-page Pusher+30s parity table (code comment or impl record).
7. Landing has zero inline menu markup.
8. Takeout name gate non-skippable (verify, fix if skippable).
9. check_all idempotent + friendly rate-limit.

## Reporting
After implementing: report per item — files changed (exact paths), line-level summary of what changed, php -l / node --check results (paste), and the per-page Pusher/poll parity table. Commit to the branch. Then Hermes dispatches Cline review.

## Final
Commit your changes on `req-063-sweep` with a clear message. Do not merge or push to origin/master.
