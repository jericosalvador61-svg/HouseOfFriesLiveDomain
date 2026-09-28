<?php
/**
 * backend/kitchenStaff/kitchenkds/get_order_details.php
 * Single order for the detail modal. Delegates to the model so the
 * prep-time ledger fields stay consistent with the dashboard.
 */

header('Content-Type: application/json');

require_once __DIR__ . '/../../auth_middleware.php';
require_once __DIR__ . '/Kitchen.php';

authenticate(['Kitchen Staff', 'Admin', 'Supervisor']);

$orderId = (int)($_GET['order_id'] ?? 0);

if (!$orderId) {
    http_response_code(400);
    echo json_encode(['status' => 'error', 'message' => 'Missing order_id']);
    exit;
}

try {
    $kitchen = new Kitchen();
    $order   = $kitchen->getOrderDetails($orderId);

    if (!$order) {
        http_response_code(404);
        echo json_encode(['status' => 'error', 'message' => 'Order not found']);
        exit;
    }

    echo json_encode([
        'status'  => 'success',
        'message' => 'Order details retrieved',
        'data'    => $order
    ]);
} catch (PDOException $e) {
    error_log('get_order_details error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => 'Could not load order details.']);
}
