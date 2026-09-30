<?php
/**
 * ============================================================
 * HOF Waiter API - Create Order  [DEPRECATED SHIM]
 * ------------------------------------------------------------
 * NOT used by the UI (submit_order.php is the live endpoint). Kept only so an
 * older bookmark / integration does not 404. It now delegates to the single
 * shared implementation in order_service.php.
 *
 * Previously this file held its own copy of the pricing + table rules while
 * the live endpoint trusted client-sent prices - that duplication is exactly
 * what this shim removes.
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

$auth = authenticate(['Waiter', 'Admin', 'Supervisor']);

hof_rate_limit('waiter_create_order', 20, 60);

$data = json_decode(file_get_contents('php://input'), true);
if (!is_array($data)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Invalid order payload.']);
    exit;
}

$orderType = strtoupper(trim((string)($data['order_type'] ?? '')));
if (!in_array($orderType, ['DINE_IN', 'TAKE_OUT'], true)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Invalid order type.']);
    exit;
}

$items = [];
foreach (($data['items'] ?? []) as $item) {
    if (!is_array($item)) {
        continue;
    }
    $items[] = [
        'id'                   => (int)($item['menu_item_id'] ?? $item['id'] ?? 0),
        'quantity'             => (int)($item['quantity'] ?? 1),
        'special_instructions' => (string)($item['special_instructions'] ?? ''),
        'choices'              => $item['choices'] ?? [],
        'addons'               => $item['addons'] ?? [],
        'configured'           => !empty($item['configured']),
    ];
}

$result = hof_waiter_create_order($pdo, $auth, [
    'order_type'    => $orderType,
    'table_id'      => (int)($data['table_id'] ?? 0),
    'customer_name' => (string)($data['customer_name'] ?? ''),
    'items'         => $items,
]);

http_response_code((int)($result['http'] ?? 200));
echo json_encode([
    'success'          => (bool)$result['success'],
    'message'          => $result['message'],
    'order_id'         => $result['order_id'] ?? null,
    'reference_number' => $result['reference_number'] ?? null,
    'deprecated'       => 'Use backend/waiter/submit_order.php',
]);


