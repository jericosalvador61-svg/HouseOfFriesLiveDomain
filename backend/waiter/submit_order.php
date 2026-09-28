<?php
/**
 * ============================================================
 * HOF Waiter API - Submit Order (from the waiter Create Order page)
 * ------------------------------------------------------------
 * This is the LIVE endpoint used by javascript/waiter/waiterCreateOrder.js.
 * All validation / pricing / table rules live in order_service.php so this
 * file stays a thin, auditable adapter.
 *
 * Accepts: { token, orderType: "Dine In"|"Take Out", tableId, customerName,
 *            items: [{id, name, price, quantity}] }
 *
 * NOTE: `name` and `price` sent by the client are IGNORED on purpose.
 * Prices are always re-read from the `menu_items` table server-side.
 * ============================================================
 */

header('Content-Type: application/json');

require_once __DIR__ . '/../auth_middleware.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../pusher_helper.php';
require_once __DIR__ . '/../notifications/notification_helper.php';
require_once __DIR__ . '/../log_activity_helper.php';
require_once __DIR__ . '/../rate_limit.php';
require_once __DIR__ . '/order_service.php';

// Authenticate FIRST so an unauthenticated caller cannot burn the quota.
$auth_user = authenticate(['Waiter', 'Admin', 'Supervisor']);

// Rate limit: 20 order creations per 60 seconds per IP
hof_rate_limit('waiter_submit_order', 20, 60);

$data = json_decode(file_get_contents('php://input'), true);
if (!is_array($data)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Invalid order payload.']);
    exit;
}

// Map the UI's orderType to the database enum.
$rawOrderType = $data['orderType'] ?? 'Dine In';
$orderType    = (strcasecmp((string)$rawOrderType, 'Dine In') === 0) ? 'DINE_IN' : 'TAKE_OUT';

// Normalise line items (id + quantity only; name/price are re-derived).
$items = [];
foreach (($data['items'] ?? []) as $item) {
    if (!is_array($item)) {
        continue;
    }
    $items[] = [
        'id'                   => (int)($item['id'] ?? $item['menu_item_id'] ?? 0),
        'quantity'             => (int)($item['quantity'] ?? 1),
        'special_instructions' => (string)($item['special_instructions'] ?? ''),
    ];
}

$result = hof_waiter_create_order($pdo, $auth_user, [
    'order_type'    => $orderType,
    'table_id'      => $orderType === 'DINE_IN' ? (int)($data['tableId'] ?? 0) : 0,
    'customer_name' => (string)($data['customerName'] ?? ''),
    'items'         => $items,
]);

http_response_code((int)($result['http'] ?? 200));
echo json_encode([
    'success'          => (bool)$result['success'],
    'message'          => $result['message'],
    'order_id'         => $result['order_id'] ?? null,
    'reference_number' => $result['reference_number'] ?? null,
]);

