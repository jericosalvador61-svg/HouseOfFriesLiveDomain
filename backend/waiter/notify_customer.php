<?php
/**
 * backend/waiter/notify_customer.php
 * REQ-055 #6 / REQ-062 #5 — Waiter "Notify Customer" + Stop.
 *
 * Broadcasts a `customer-notify` Pusher event on hof-orders for a given order.
 * The waiter pushes the bell once (type=notify); if the customer does not
 * acknowledge, a Stop button (type=stop) silences the alert. NEVER touches
 * payment fields.
 */
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../auth_middleware.php';
require_once __DIR__ . '/../pusher_helper.php';
require_once __DIR__ . '/../rate_limit.php';
require_once __DIR__ . '/../log_activity_helper.php';
header('Content-Type: application/json');

hof_rate_limit('waiter_notify', 20, 60);
$auth = authenticate(['Waiter', 'Admin', 'Supervisor']);

try {
    $data = json_decode(file_get_contents('php://input'), true);
    $orderId = (int)($data['order_id'] ?? 0);
    $ref = trim($data['ref'] ?? '');
    $type = ($data['type'] ?? 'notify') === 'stop' ? 'stop' : 'notify';

    if (!$orderId || $ref === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'order_id and ref are required.']);
        exit;
    }

    $stmt = $pdo->prepare('SELECT reference_number, status FROM orders WHERE order_id = ?');
    $stmt->execute([$orderId]);
    $order = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$order) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Order not found.']);
        exit;
    }
    if ($order['reference_number'] !== $ref) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Reference mismatch.']);
        exit;
    }

    broadcastCustomerNotify($orderId, $ref, $type);

    logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'], 'CUSTOMER_NOTIFY', "Order #{$ref} customer notify ({$type})", 'order', $orderId, $ref);

    echo json_encode(['success' => true, 'message' => 'Customer notified.']);
} catch (Throwable $e) {
    error_log('notify_customer error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Failed to notify customer.']);
}
